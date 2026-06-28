# Phase 3.3 AI 成本护栏与生产安全收口设计

## 目标

在不接入视频渲染 provider、不新增 D1 schema、不引入大型依赖的前提下，为现有 Workers AI Whisper 链路增加密钥治理、上传前配额、Queue 失败分类、重复计费防护和时长限制。

## 范围与非目标

- 保留现有歌词视频上传、编辑、读取和结果查看流程。
- 默认转录 provider 继续使用 `development-stub`，生产显式配置后才调用 Workers AI。
- 不接入 OpenAI、AssemblyAI、Replicate 或视频渲染 provider。
- 不修改首页、SEO、付费、积分、路由生成文件和数据库 schema。
- 不承诺严格原子的每日配额；现有 schema 无配额预留记录或唯一约束，并发请求可能短暂突破限制。

## 配置与密钥

`wrangler.jsonc` 保存以下非敏感配置，并提供保守默认值：

- `LYRIC_VIDEO_TRANSCRIPTION_PROVIDER=development-stub`
- `LYRIC_VIDEO_MAX_AUDIO_BYTES=26214400`
- `LYRIC_VIDEO_DAILY_TRANSCRIPTION_LIMIT=5`
- `LYRIC_VIDEO_MAX_DURATION_SECONDS=300`

音频大小、每日次数和最大时长统一通过一个轻量配置模块解析。缺失、非整数或非正数配置回退到上述默认值，避免无效配置意外解除护栏。

`BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_SECRET`、`POLAR_SECRET` 不再以空字符串放在 `vars` 中。当前 Wrangler 4.56.0 的本地 schema 不支持新版 `secrets.required`，因此用只声明变量名和字符串类型的最小 TypeScript 环境补充维持编译；真实值只通过 Cloudflare Dashboard 或 `wrangler secret put` 管理。

应用目录下的 `.env` 当前含非空 `CLOUDFLARE_API_TOKEN`，且应用运行时不读取其中三个 Cloudflare 管理项。删除该本地文件，避免管理 token 与应用环境混放；该 token 需要由用户在 Cloudflare 侧轮换。

## 上传前成本防护

上传入口依次执行：

1. 校验文件非空、扩展名和 MIME 类型。
2. 使用 `LYRIC_VIDEO_MAX_AUDIO_BYTES` 校验文件大小。
3. 解析本次配置的转录 provider。
4. 当 provider 为 `workers-ai-whisper` 时，统计该用户从 UTC 当日 00:00 起创建、且 `transcriptionProvider` 为 `workers-ai-whisper` 的记录。
5. 达到配置上限时抛出清晰错误；此时尚未写入 R2、创建 D1 记录或发送 Queue 消息。
6. 未超限时沿用现有 R2 → D1 → Queue 流程和失败清理逻辑。

统计所有为真实 provider 创建的记录，包括之后失败的记录。这是有意的保守策略：现有字段无法证明 Queue 是否已成功接收，少算会扩大被刷风险，多算最多让个别基础设施失败占用一次当日额度。

## Queue 与失败分类

Queue 消费采用成本优先的阶段边界：

- 首次 D1 查询失败：AI 尚未调用，向 Queue 抛错并允许重试。
- R2 读取发生暂时性异常：AI 尚未调用，作为基础设施异常重试。
- R2 对象不存在、provider 配置无效、AI binding 缺失、Workers AI 调用失败或响应不可用：写入 `failed`、`failureStage=transcription` 和安全错误消息，然后正常返回，由 consumer ack。
- AI 调用返回后，D1 状态更新使用 `id + userId + transcriptionJobId + status=transcribing` 条件，避免旧消息覆盖新状态。
- AI 调用开始之后的 D1 更新失败不再抛给 Queue，避免再次调用 AI 重复计费；记录安全日志并 ack。
- stale job、old job 和已完成 job 在 AI 调用前跳过并 ack。

这套设计明确偏向成本安全。极端情况下，AI 已成功但 D1 持续不可用，记录可能停留在 `transcribing`。在没有 provider 幂等键或持久化调用检查点的当前 schema 下，无法同时保证“绝不重复计费”和“结果必定落库”。

日志只记录失败类别、jobId 和 lyricVideoId，不记录音频内容、secret、上游完整响应或可能携带敏感信息的原始错误对象。落库错误消息对已知错误使用固定文案，对未知 provider 错误使用通用文案。

## Queue 配置

本地 Wrangler 4.56.0 schema 和当前 Cloudflare 文档均支持 consumer `max_retries`，设置为 `2`。

本阶段不配置 dead letter queue：虽然当前平台可以创建或绑定 DLQ，但项目尚无 DLQ 消费、告警和人工回放流程，增加一个无人处理的队列只会把失败藏到另一个地方。

consumer schema 不支持 `retention_period`。Queue 保留期属于队列级配置；Workers Free Plan 的 24 小时保留期不可配置，因此不在 `wrangler.jsonc` 中添加猜测字段。

## durationSeconds 与 render 限制

Workers AI 响应优先从有效 `words` 的最大结束时间推断时长，其次从有效 VTT cue 的最大结束时间推断。纯文本 fallback 的时间轴是估算值，不作为真实时长写入。

成功转录后写入 `durationSeconds`。超过 `LYRIC_VIDEO_MAX_DURATION_SECONDS` 时仍保持 `ready-for-edit`：用户已经支付了 STT 成本，歌词仍可编辑和导出，标记 `failed` 会丢失可用产品价值。未来或现有 render 入口在修改状态、发送 render job 之前拒绝超时记录，并返回清晰限制信息。

## 测试策略

- 配置大小限制覆盖默认值和自定义值。
- 真实 provider 达到每日限制时验证 R2、D1 insert、Queue 和 AI 均未发生。
- development stub 不消耗真实 AI 每日额度。
- provider 失败落库为 transcription failure，Queue 消息被 ack，重复投递不再次调用 AI。
- AI 前的 D1/R2 基础设施异常不 ack，允许 Queue 重试。
- stale/old job 不调用 AI、不覆盖状态。
- words 和 VTT 成功响应写入 `durationSeconds`。
- 超时转录保持 `ready-for-edit`，render 入口拒绝且不 enqueue。
- 运行 data-ops build、user application 全量测试和 build、Wrangler types/config 校验，以及只输出路径和变量名的脱敏 secret 扫描。

## 已知风险

- 每日配额是先查后写，不具备原子性；高并发下可能越限。
- 以 UTC 自然日定义“每日”，用户本地午夜与额度重置时间可能不同。
- AI 调用后的 D1 持续故障会留下 `transcribing` 记录，需要后续运维巡检或恢复机制。
- 仅限制次数不能完全限制成本；不同音频时长仍有成本差异，而本阶段不能在 STT 前可靠获得时长。
- 发现的 Cloudflare API token 是否已泄露无法仅靠仓库扫描判断，删除本地文件不能替代 token 轮换。
