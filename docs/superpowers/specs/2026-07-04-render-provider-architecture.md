# Render Provider 架构设计

**Status: Proposed**

## Background

AI Lyric Video Maker 当前已经具备音频上传、歌词转写、歌词时间轴编辑、模板配置、渲染任务入队和输出文件读取的骨架，但没有真实视频渲染能力。现有 render 流程会把记录推进到 `rendering`，随后 Queue consumer 固定写入 `failed`，错误为 `Render provider is not configured`。

Phase 4.0 只完成代码审计和架构设计，不实现 provider，不调用第三方 API，不触发 Queue，不读写 R2，不修改 D1 schema、认证、前端或 Cloudflare 配置，也不部署任何环境。

目标链路是：

```text
音频 R2 object + 歌词时间轴 + 模板配置
  -> Queue Worker 编排
  -> 独立 Node/FFmpeg render service 渲染
  -> 流式返回 MP4
  -> Queue Worker 流式写入 R2
  -> D1 status=ready
  -> /api/lyric-videos/:id/output 鉴权读取
```

第一性原理判断：产品需要的是稳定生成可播放歌词视频，而不是在 Cloudflare Worker 内证明能够运行视频工具链。CPU 密集型编码与 Worker 编排职责必须分离。

## Current Render Flow

### 现有组件

- `apps/user-application/src/routes/_auth/app/lyric-videos.$id.tsx`
  - 用户点击 `Generate video`。
  - 页面先 PATCH 保存 `lyricsJson` 和 `templateConfig`，再 POST `/api/lyric-videos/:id/render`。
  - `uploaded`、`transcribing`、`rendering` 状态每 4 秒轮询详情。
  - `failed` 展示 `errorMessage` 和 `failureStage`。
  - 只有 `status=ready` 且 `outputVideoUrl` 非空时展示 `Open output`。
- `apps/user-application/src/routes/api/lyric-videos.$id.render.tsx`
  - 使用 `requireUserId()` 鉴权。
  - 把 `cloudflare:workers` 的 `env` 传给 `renderOwnedLyricVideo()`。
  - 成功入队后返回 HTTP 202。
- `apps/user-application/src/features/lyric-videos/service.ts`
  - `renderOwnedLyricVideo()` 只允许 `ready-for-edit` 或 `ready` 进入 render。
  - `rendering` 请求直接返回当前记录，不重复入队。
  - 使用 `LYRIC_VIDEO_MAX_DURATION_SECONDS` 对已知 `durationSeconds` 做 render 前限制，默认 300 秒。
  - 生成新的 `renderJobId`，写入 `status=rendering`、`renderProvider=not-configured`，然后发送 render Queue job。
  - 入队失败时写入 `status=failed`、`failureStage=render`。
  - `getLyricVideoAsset()` 根据用户所有权读取 R2。音频优先使用已存 `audioObjectKey`；输出在 `outputObjectKey` 为空时回退到固定的 `lyric-videos/<user>/<id>/output.mp4`。
- `apps/user-application/src/features/lyric-videos/jobs.ts`
  - `RenderLyricVideoJob` 目前仅包含 `type`、`jobId`、`lyricVideoId`、`userId`、`createdAt`。
  - Queue handler 已通过 `processLyricVideoJob(job, env)` 获得 `env`。
  - render 分支却调用 `processRenderJob(job)`，没有继续传递 `env`。这是函数签名未贯通，不是 Cloudflare 平台无法提供 env。
  - `processRenderJob()` 校验记录存在、`renderJobId` 匹配且状态为 `rendering` 后，固定写入 `failed`。
- `packages/data-ops/src/drizzle/lyric-video-schema.ts`
  - 当前共有 20 个字段。
  - render 相关字段包括 `status`、`outputVideoUrl`、`outputObjectKey`、`errorMessage`、`failureStage`、`renderProvider`、`renderJobId` 和 `durationSeconds`。
- `apps/user-application/src/routes/api/lyric-videos.$id.output.tsx`
  - 使用 `requireUserId()` 鉴权，再通过 `getLyricVideoAsset()` 返回 R2 body。
  - 当前 route 本身不检查 `status=ready`，也不要求数据库中的 `outputObjectKey` 非空。

### 从点击到失败的完整流程

1. 用户点击 `Generate video`。
2. 前端先保存歌词和模板；保存成功后 POST render route。
3. route 完成用户鉴权并调用 `renderOwnedLyricVideo({ userId, id, env })`。
4. service 检查所有权、状态和时长限制。
5. service 生成 `renderJobId`，把 D1 记录更新为 `rendering`，清除旧错误，并写入 `renderProvider=not-configured`。
6. service 向 `LYRIC_VIDEO_JOBS` 发送 render job，route 返回 202。
7. Queue consumer 在 `src/server.ts` 中取得 `workerEnv`，初始化 D1，并调用 `processLyricVideoBatch(batch, workerEnv)`。
8. `processLyricVideoJob(job, env)` 识别 render job，但没有把 env 继续传给 `processRenderJob()`。
9. `processRenderJob()` 忽略 stale job、jobId mismatch 和 status mismatch；匹配时固定写入：
   - `status=failed`
   - `failureStage=render`
   - `errorMessage=Render provider is not configured`
   - `renderProvider=not-configured`
   - `outputObjectKey=null`
10. 前端轮询得到 `failed`，停止轮询并显示失败原因。没有 MP4 写入 R2。

### 已识别风险

1. `processRenderJob()` 当前没有接收 `env`，因此无法访问 R2、provider 配置或 secret。
2. render 分支只会写入固定失败，尚无 provider seam。
3. `renderOwnedLyricVideo()` 的“读取状态 -> 更新 rendering”不是条件式原子转换；并发请求可能生成多个 job。
4. `processRenderJob()` 最终更新只按 `id + userId` 过滤，没有再次约束 `renderJobId + status=rendering`；检查和更新之间可能发生竞态。
5. `outputObjectKey` 为空时，输出读取会回退到固定路径，而不是拒绝访问。
6. failed 记录如果对应固定路径上仍存在旧 output object，用户可能绕过前端状态直接访问 output route。
7. Queue retry 可能重复调用 provider、重复渲染和重复扣费。
8. 当前没有独立 render attempt 记录、可靠 daily quota、external render job id、`renderStartedAt` 或 `renderCompletedAt`。
9. 从 `ready` 重新渲染时，旧 `outputVideoUrl` 和 `outputObjectKey` 的生命周期没有明确契约。

## MVP Render Requirements

### 输入

- 当前用户拥有的 `audioObjectKey`，且 R2 object 必须存在。
- 经过 `LyricsJsonSchema` 校验并规范化的非空 `lyricsJson`。
- 经过 `TemplateConfigSchema` 校验的 `templateConfig`。
- `title`。
- 已知且不超过限制的 `durationSeconds`。真实计费 provider 启用前，`null` 不应被当作无限制许可；应拒绝或先探测媒体时长。
- 稳定的 `renderJobId`，同时作为一次 render 的内部幂等键。

### 输出与成功不变量

- 真实 MP4，视频编码 H.264、音频编码 AAC。
- MVP 默认 9:16，优先 720x1280；只有成本、时延和稳定性验证通过后才把 1080x1920 设为默认。
- 简单纯色或静态图片背景、居中歌词、当前行高亮。
- 不做复杂 MV、粒子系统、多轨合成或用户脚本。
- MP4 通过 `ReadableStream` 写入确定的 R2 output key，禁止把完整视频读入 `ArrayBuffer`。
- 只有 R2 写入成功并可确认 object 存在后，才能原子地把匹配 job 更新为：
  - `status=ready`
  - `outputObjectKey=<实际 key>`
  - `outputVideoUrl=/api/lyric-videos/:id/output`
  - `renderProvider=<实际 provider>`
  - `errorMessage=null`
  - `failureStage=null`
- `ready` 必须严格表示“数据库指向一个可读取、`content-type=video/mp4` 的完整对象”。stub marker 不得满足该状态。

### 失败不变量

- 终止性输入或 provider 错误落库为：
  - `status=failed`
  - `failureStage=render`，存储阶段失败可使用 `storage`
  - 经过清洗、可展示且不包含 secret 的 `errorMessage`
  - `renderProvider=<尝试使用的 provider>`
- 基础设施瞬时错误必须抛出，让 Queue 重试；不能先写 terminal failed 再假装成功 ack。
- 失败更新必须带 `id + userId + renderJobId + status=rendering` 条件，避免旧 job 覆盖新状态。

## Options Considered

| 方案 | Workers 适配 | MP4 / 长任务 | 资源需求 | R2/D1/Queue 集成 | 成本与重试 | MVP / 模板扩展判断 |
| --- | --- | --- | --- | --- | --- | --- |
| A. Worker 内直接渲染 | 差 | 理论上可借助 WASM，但完整编码是长任务 | 高 CPU、128 MB 内存约束，FFmpeg 工具链不匹配 | 绑定集成直接 | 超限和运行时失败风险高；重试昂贵 | 不适合 MVP，也不适合作为长期主路线 |
| B. Worker 调外部 render API | 好，Worker 只编排 | 可输出 MP4；外部服务承担长任务 | Worker 只需流式 I/O | 容易接现有 Queue、R2、D1 | 可用稳定 idempotency key 去重；需控制超时和 provider 错误分类 | 适合 MVP，也是推荐的 Worker 侧边界 |
| C. 独立 Node/FFmpeg service | 好，作为 B 的实际渲染端 | 原生适合 H.264/AAC 和长任务 | 服务侧需要 CPU、内存、临时磁盘和 FFmpeg | 通过受控 HTTP API 与 Worker 集成 | 需要容量、超时、幂等、日志和部署运维 | 最适合真实 MVP；可逐步扩展模板 |
| D. Remotion / headless browser | Worker 内不适合；外部服务可行 | 可输出 MP4，通常需要 browser + 编码 | 内存和启动成本较高 | 外部化后可集成 | 帧渲染成本和失败面更大 | 模板表达力强，但首版复杂度高，延后评估 |
| E. HTML/CSS 动画 + 外部录制 | Worker 只生成描述时可行 | 录制端仍需 browser 和编码长任务 | 外部录制服务资源高 | 能集成，但增加中间表示和录制协议 | 跨浏览器一致性、字体和资源加载易失败 | 不适合首个 MVP，可作为未来模板路线 |
| F. 仅静态背景 + 歌词 JSON，不生成 MP4 | 完全适合 | 不能满足 MP4 交付 | 低 | 最容易 | 成本低、重试简单 | 可作编辑预览或 stub，但不能称为 render MVP |

结论：B 是 Worker 编排方式，C 是 B 后面的真实渲染实现，两者不是互斥方案。真实 MVP 推荐组合为“Cloudflare Queue Worker + 独立 Node/FFmpeg render service”。

Cloudflare 当前文档给出的 Worker isolate 内存上限为 128 MB，Queue consumer 单次 wall time 上限为 15 分钟；R2 `put()` 原生接受 `ReadableStream`。因此首版必须限制时长并端到端流式传输，不能缓冲完整 MP4：

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/queues/configuration/batching-retries/

## Recommended Direction

### Phase 4.1：adapter 与受控 stub

新增 render provider adapter 和 `development-stub-render`，让 `processRenderJob(job, env)` 真正获得 env，并建立状态机、幂等和失败分类，但不生成真实 MP4、不接 FFmpeg 服务。

`development-stub-render` 选择“受控 failure”，不写伪造 `.mp4`，也不把记录更新为 `ready`：

- adapter 正常返回一个明确的 `dry-run` 结果，证明选择器、输入校验和调用边界可工作。
- orchestration 把 dry-run 转成可识别的受控 render failure，例如 `Development render stub does not produce a video artifact`。
- 不写 R2 marker。把 JSON 或文本写入 output 路径会破坏 `ready => playable MP4` 不变量，并可能被误当成视频下载。
- stub success 测试验证 adapter dry-run 成功及“没有 R2 写入、没有 ready”；stub failure 测试验证 terminal/infrastructure 分类。
- 真实成功、R2 写入失败和 D1 完成更新失败使用测试专用 fake streaming provider 覆盖，不需要真实 API 或真实 MP4。

### 后续真实 MVP：外部 Node/FFmpeg 服务

1. Queue Worker 从 R2 获取音频 stream。
2. Worker 将音频、歌词、模板和 idempotency key 发送给独立 Node/FFmpeg service。
3. render service 只负责 CPU/视频渲染，以 `video/mp4` 流式响应返回结果。
4. Worker 校验响应状态和 content type，把响应 body 直接流式 `put()` 到 R2。
5. R2 写入成功后，Worker 条件式更新 D1 为 `ready`。

职责边界：

- Worker：鉴权、所有权、输入校验、provider 选择、状态机、幂等、重试策略、R2 写入和 D1 更新。
- 外部服务：媒体探测、字幕合成、FFmpeg 编码和流式响应。
- 外部服务默认不持有长期 R2 凭证。若未来要让服务直接读写 R2，必须单独设计最小权限、短期凭证、object prefix 隔离、回收和审计，不能把现有长期凭证直接交给服务。

明确不推荐：

- Worker 内直接运行 FFmpeg。
- Worker 内运行 headless browser。
- 任何完整 MP4 的 `ArrayBuffer`/`Blob` 内存缓冲。
- 未做专门凭证边界设计时，让外部服务直接持有长期 R2 凭证。

## Provider Interface

### 边界原则

- `processRenderJob(job, env)` 接收 Cloudflare env。
- provider selector/factory 从 env 中读取选择项和所需 secret，但不把完整 `Env` 暴露给每次 render 的业务输入。
- render input 使用领域数据和窄化后的音频 stream；这使 provider 可测试，也降低意外访问其他绑定或 secret 的风险。
- job 生成 output key、写 R2 并完成 D1 状态转换；provider 不负责 R2。
- provider 返回 `ReadableStream`，不能返回完整 `ArrayBuffer`。

建议接口：

```ts
type RenderLyricVideoInput = {
  lyricVideoId: string;
  userId: string;
  idempotencyKey: string;
  audio: {
    objectKey: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
  };
  lyricsJson: LyricsJson;
  templateConfig: TemplateConfig;
  title: string;
  durationSeconds: number;
};

type RenderLyricVideoResult =
  | {
      kind: "video";
      provider: string;
      body: ReadableStream<Uint8Array>;
      contentType: "video/mp4";
      durationSeconds?: number;
    }
  | {
      kind: "dry-run";
      provider: "development-stub-render";
    };

interface RenderLyricVideoProvider {
  readonly name: string;
  render(input: RenderLyricVideoInput): Promise<RenderLyricVideoResult>;
}
```

provider result 不包含 `outputObjectKey`。output key 属于应用的存储策略，应该由 job 统一生成和控制，避免 provider 任意选择用户路径或覆盖对象。

### 为什么由 job 写 R2

- 外部服务不需要长期 R2 凭证。
- 所有权和 object key 规则集中在应用中。
- Queue job 能把 provider response body 直接传给 `R2Bucket.put()`，不需要完整缓冲。
- R2 成功和 D1 成功之间的补偿逻辑只有一个所有者。
- 测试可分别注入 provider stream、R2 失败和 D1 失败。

### renderJobId 与 externalRenderJobId

- `renderJobId` 继续作为内部 Queue 幂等 token，并作为外部请求的 `Idempotency-Key`。同一 Queue message 的重试必须复用它。
- 同步流式 provider 不需要 `externalRenderJobId`。
- 如果未来改为“提交 -> 轮询/回调 -> 下载”的异步 provider，外部 job id 不能复用 `renderJobId` 字段；届时再新增 `externalRenderJobId` 或 render attempts 表。

## Queue and State Machine

### 状态转换

```text
ready-for-edit | ready
  -- conditional start --> rendering
  -- provider + R2 + conditional D1 success --> ready
  -- terminal render error --> failed(render)
  -- terminal storage error --> failed(storage)
  -- infrastructure error --> throw for Queue retry, remain rendering
```

### 处理规则

| 情况 | 行为 | ack / retry |
| --- | --- | --- |
| 记录不存在 | 视为 stale job，结构化日志，不更新 | ack |
| jobId 不匹配 | 旧 job，不更新 | ack |
| status 不是 `rendering` | 已完成、失败或被替换，不更新 | ack |
| `audioObjectKey` 缺失或 R2 object 不存在 | 输入终止错误，条件式写 `failed` | ack |
| `lyricsJson.lines` 为空 | 输入终止错误，条件式写 `failed` | ack |
| 歌词行数或时长超限 | 在 provider 调用前拒绝，条件式写 `failed` | ack |
| provider 为 `not-configured` | 受控 terminal failure，不调用外部服务 | ack |
| stub dry-run | 受控 terminal failure，不写 R2、不标记 ready | ack |
| provider terminal failure | 清洗错误后条件式写 `failed(render)` | ack |
| provider infrastructure failure | 不写 terminal failed，抛出错误 | Queue retry |
| provider 成功，R2 写入失败 | 删除可能存在的临时对象；可重试错误则抛出 | Queue retry |
| R2 成功，D1 更新失败 | 保留确定 key 的完整对象并抛出；重试先 `head()` 复用 | Queue retry |
| D1 条件更新影响 0 行 | job 已 stale；不得覆盖新状态，按 object 归属决定清理 | ack |

### 幂等与重复扣费

- 从首次入队到所有 retry，`renderJobId` 不变。
- 每次 provider 调用携带相同 `Idempotency-Key: renderJobId`。
- provider 必须承诺相同 key + 相同输入不会创建第二个计费任务；没有该能力的 provider 不得进入 production。
- provider 调用前先检查数据库 jobId/status；provider 返回后、写 R2 前和更新 D1 时再次检查。
- output 使用 job-scoped 临时 key，例如 `.../renders/<renderJobId>.mp4`。只有完整写入后才把该 key发布到 D1，避免覆盖当前可用产物。
- 若重试时 job-scoped object 已存在且 metadata 与 jobId、content type 一致，则复用，不重复调用 provider。
- 不直接覆盖当前 `outputObjectKey`。新 render 成功后切换 D1 指针，旧对象异步清理；失败时旧 ready 产物是否继续可用需要产品决策，首版建议失败记录不对外暴露旧对象。

Cloudflare Queues 默认会重试失败消息；达到最大重试次数后，没有 DLQ 的消息会被丢弃。真实 provider 上线前应单独评估 `max_retries`、DLQ 和告警，但 Phase 4.1 不修改 Queue 配置：

- https://developers.cloudflare.com/queues/configuration/configure-queues/
- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/

## R2/D1 Output Contract

### 写入顺序

1. 条件式确认 `renderJobId` 仍有效、状态仍为 `rendering`。
2. provider 返回 `video/mp4` stream。
3. 写入 job-scoped R2 key，并设置 `httpMetadata.contentType=video/mp4` 和用于恢复的 job metadata。
4. 使用 R2 `head()` 确认对象存在、大小大于 0、content type 正确。
5. 使用 `id + userId + renderJobId + status=rendering` 条件更新 D1 为 `ready`。
6. 后续安全清理旧对象；清理失败不能回滚已经发布的新产物。

### 读取契约

output route 应只在以下条件全部满足时读取：

- 当前用户拥有记录。
- `status=ready`。
- `outputObjectKey` 明确非空。
- R2 object 存在。

输出读取不得在 `outputObjectKey` 为空时推导固定 key。该 fallback 对 audio 的兼容价值不能自动延伸到 output，因为 output 的存在性本身是业务状态。

建议输出响应保留 R2 metadata，并补充 `content-length`、`etag`、合理的 `content-disposition`；这些属于后续实现，不在 Phase 4.0 修改。

### 跨 R2/D1 非事务补偿

R2 和 D1 没有跨服务事务。采用“先写不可见的 job-scoped object，再条件发布 D1 指针”：

- R2 失败：D1 不得 ready。
- R2 成功但 D1 失败：对象是未发布 orphan；retry 可复用，最终由定期清理回收。
- D1 更新影响 0 行：视为 stale，绝不把旧 job 发布为当前输出。

## Cost and Safety Guards

### Phase 4.1 默认值

- provider 默认：`not-configured`。
- 只有显式选择 `development-stub-render` 才能运行 stub。
- staging 和 production 默认不得真实 render。
- production 未显式配置真实 provider、secret 和护栏前必须 fail closed。
- stub 不产生真实 MP4，不写 output R2，不得标记 ready。

### 真实 MVP 建议上限

| 护栏 | 建议初始值 | 原因 |
| --- | --- | --- |
| 最大时长 | 300 秒；未知时长拒绝真实 render | 复用现有产品限制，控制编码时间和外部调用时长 |
| 最大歌词行数 | 500 行 | 阻止异常 payload 和无界字幕图层 |
| 最大 billable render attempts | 同一 `renderJobId` 只允许 1 个计费任务 | retry 依赖 provider 幂等，不等于重新购买一次 render |
| Queue delivery retries | Phase 4.1 沿用现状；真实 provider 前显式评估 | 需结合 provider 幂等、DLQ 和告警统一决定 |
| 每用户每日 render 次数 | 免费用户建议 3 次/UTC 日，付费策略另定 | 当前 schema 无法可靠审计多次 render，正式启用前需 attempt ledger |
| 分辨率 | 默认 720x1280 | 先验证质量、耗时和成本，再开放 1080x1920 |

### 安全要求

- provider secret 只通过 Cloudflare secrets 管理，不写入 `wrangler.jsonc`、代码、文档示例值、测试夹具或日志。
- 错误日志只记录内部 job id、video id、provider、阶段和稳定错误码，不记录 API key、完整响应 body、用户音频或歌词正文。
- 外部服务必须鉴权、校验请求大小、限制并发，并验证 idempotency key。
- provider response 必须限制状态码、content type 和最大字节数；不能盲目信任任意 stream。
- 所有 object key 必须由应用根据已鉴权的 userId/videoId/jobId 生成，provider 不可提交任意 R2 key。

## Environment Variables and Secrets

本阶段不新增任何变量或 secret，也不修改 `wrangler.jsonc`。

未来候选配置：

| 名称 | 类型 | 用途 | 默认/安全行为 |
| --- | --- | --- | --- |
| `LYRIC_VIDEO_RENDER_PROVIDER` | 非 secret env | 选择 `not-configured`、`development-stub-render` 或真实 provider | 缺失和未知值都按 `not-configured` fail closed |
| `LYRIC_VIDEO_MAX_RENDER_SECONDS` | 非 secret env | render 专用时长上限 | 建议 300；不能高于平台和 provider 安全上限 |
| `LYRIC_VIDEO_MAX_LYRICS_LINES` | 非 secret env | 歌词行数上限 | 建议 500 |
| `LYRIC_VIDEO_DAILY_RENDER_LIMIT` | 非 secret env | 免费用户每日次数 | 没有可靠 attempt ledger 前不能声称严格计费控制 |
| `RENDER_PROVIDER_API_URL` | 非 secret env | 外部服务地址 | 缺失时真实 provider 不可用 |
| 具体 provider API key | Cloudflare secret | 外部服务鉴权 | 只通过 secret 管理；禁止通用示例真实值 |

环境策略：

- local：允许显式 `development-stub-render`。
- staging：默认 `not-configured`；只有专门的非计费 stub smoke 阶段才可显式启用 `development-stub-render`。
- production：默认 `not-configured`；没有显式 provider、secret、配额、幂等和告警前不能真实 render。
- Phase 4.1 不需要真实 provider key，也不需要 staging secret。

## Data Model Assessment

### 结论

当前 20 字段足够 Phase 4.1 和受限的单次 MVP render：现有字段可以表达一次 render 的当前状态、内部 jobId、provider、输出 key/URL和最后错误。因此 Phase 4.0 和 Phase 4.1 都不做 D1 migration。

但当前 schema 不足以支持可靠计费、多次尝试审计、异步 provider 恢复和历史指标。不能因为“能把当前状态写进一行”就宣称已经具备计费账本。

### 字段评估

| 候选 | 单次同步 MVP | 何时需要 |
| --- | --- | --- |
| `externalRenderJobId` | 不需要 | provider 改为异步提交/轮询/回调时 |
| `renderAttemptCount` | 可暂缓 | 需要限制物理调用次数但尚未引入 attempts 表时 |
| `renderStartedAt` | 可暂缓 | SLA、stale rendering 恢复、耗时分析前 |
| `renderCompletedAt` | 可暂缓 | SLA、保留期和完成时间报表前 |
| `renderCostCents` | 不应只放主表 | 开始真实计费和成本核算前，最好归属 attempt ledger |
| `videoWidth` / `videoHeight` | 可从固定模板推导 | 开放多规格或需要媒体事实校验前 |
| `videoDurationSeconds` | 可暂用输入时长 | 输出时长可能与音频不一致、需要探测时 |
| `templateVersion` | 当前模板固定时可暂缓 | 模板演进且需要可重复渲染时 |

### 推荐的未来模型

真实计费或允许多次 render 前，优先评估 `render_attempts` 表，而不是把所有历史字段塞进 `lyric_videos`：

- 每次逻辑 render 一行，关联 lyric video、user 和 internal renderJobId。
- 可记录 provider、externalRenderJobId、attempt 状态、started/completed 时间、成本、输出规格、templateVersion、错误码和幂等信息。
- `lyric_videos` 继续保存当前可见状态和当前 output pointer。

是否创建该表必须由真实 provider 的同步/异步协议、计费方式和产品配额共同决定；本阶段不生成 migration。

## Phase 4.1 Implementation Plan

### 方案名称

Render Provider Seam 与安全 Stub。

### 目标

在不接真实 FFmpeg 服务、不生成真实 MP4 的前提下，建立可测试的 provider adapter、env 贯通、条件式状态机、错误分类和流式成功 seam。

### 小步范围

1. 新增 `apps/user-application/src/features/lyric-videos/render-provider.ts`：定义接口、错误类型、provider selector 和 `not-configured` 行为。
2. 新增 `apps/user-application/src/features/lyric-videos/development-stub-render-provider.ts`：返回明确 `dry-run` 或可配置的受控错误，不写 R2、不生成 MP4。
3. 修改 `jobs.ts`：render 分支调用 `processRenderJob(job, env)`；完成输入校验、provider 调用、状态分类和条件式更新。
4. 必要时在 `service.ts` 收紧 render 起始转换为条件式更新，并明确重新 render 时旧 output pointer 的处理；只做与幂等直接相关的最小修改。
5. 增加单元测试。真实成功路径使用测试 fake provider 返回小型 `ReadableStream`，不调用外部服务。

### 明确不修改

- 不接真实 Node/FFmpeg service。
- 不修改 auth 或 Better Auth Dash。
- 不修改 D1 schema，不生成 migration。
- 不新增真实 provider secret，不部署 staging/production。
- 不把 stub marker 写成 `.mp4`，不把 stub 结果标记为 ready。
- 不扩展复杂模板、Remotion 或 headless browser。

### 环境与 secret

- migration：不需要。
- 真实 provider key：不需要。
- staging secret：不需要。
- 可在 Phase 4.1 引入可选的非 secret `LYRIC_VIDEO_RENDER_PROVIDER` selector；缺失默认 `not-configured`。是否同步修改本地/Cloudflare 配置应作为 Phase 4.1 开始时的显式变更项，不能在本设计阶段偷改。
- staging/production 必须保持 `not-configured`，除非后续任务明确授权 stub；两者都不得选择真实 provider。

### 测试范围

- stale target：ack，无更新、无 provider 调用。
- jobId mismatch：ack，无更新、无 provider 调用。
- status mismatch：ack，无更新、无 provider 调用。
- provider not configured：受控 `failed(render)`，无 R2 写入。
- stub dry-run success：adapter 返回 dry-run；job 不 ready、不写 output，并记录受控结果。
- stub terminal failure：条件式 `failed(render)`。
- stub infrastructure failure：抛出供 Queue retry，记录保持 rendering。
- audio key/object 缺失、空歌词、未知/超限时长、歌词行数超限：provider 调用前拒绝。
- fake provider streaming success：R2 成功后条件式更新 ready。
- R2 写入失败：D1 不 ready，错误可重试。
- R2 成功但 D1 更新失败：重试复用 job-scoped object，不重复 provider 调用。
- provider 返回错误 content type、空 body 或超限响应：拒绝发布。
- 更新期间 job 变 stale：条件更新影响 0 行，不覆盖新状态。
- retry 使用相同 idempotency key，已有匹配 object 时不重复调用 provider。

### smoke test 范围

Phase 4.1 首选纯本地、无外部副作用 smoke：

- 用 development stub 证明 selector、Queue job handler 和受控失败路径。
- 用内存 fake R2/fake provider 证明 stream plumbing 和 ready 条件。
- 不发送真实 Queue 消息，不上传音频，不写远程 R2，不触发 Workers AI。
- staging smoke 必须由后续单独任务授权；默认不部署。

### 回滚

- provider 默认值保持 `not-configured`，因此出现异常时无需数据回滚即可关闭 stub seam。
- Phase 4.1 不迁移 schema，代码回滚不涉及 D1 downgrade。
- 不覆盖旧 output key；失败 job-scoped 测试对象可按 renderJobId 清理。
- 若新状态机测试失败，回滚 adapter 接线即可恢复当前固定失败行为。

## Risks and Open Questions

### 最可能翻车的点

1. **把 stub 当成功产物。** 如果 stub 写 marker 并设置 ready，output contract 立即失真。决策：stub 使用 dry-run + 受控 failure，绝不 ready。
2. **以为 Queue retry 自动等于业务幂等。** Queue 只负责重投，不阻止 provider 重复计费。决策：稳定 renderJobId、provider idempotency、job-scoped object 和条件更新缺一不可。
3. **用流式 API 名义掩盖中间缓冲。** provider client、日志、校验或 SDK 任一层调用 `arrayBuffer()` 都可能触碰内存上限。决策：端到端检查 stream 所有权并限制响应大小。
4. **R2 已成功但 D1 失败。** 这是必然存在的跨服务部分失败。决策：不可见 job-scoped key + retry 复用 + orphan 清理。
5. **旧输出泄漏。** 当前 fallback key 和 route 状态检查不足可能暴露失败前对象。决策：后续实现必须要求 ready + 显式 outputObjectKey，禁止 output fallback。

### 开放问题

- 真实 Node/FFmpeg service 部署在哪个平台，其单任务 CPU、内存、磁盘、最大响应时长和并发上限是多少？
- 服务能否稳定支持 HTTP streaming 和 `Idempotency-Key`，还是必须采用异步 job API？
- 如果采用异步 API，使用 Queue 延迟重投、Cloudflare Workflows 还是 provider callback 继续编排？这会决定是否立即需要 `externalRenderJobId`。
- 免费用户每日 3 次是产品策略还是仅初始安全值？重新渲染是否消耗一次额度？
- 失败重新渲染时，旧的 ready 视频应继续可访问，还是立即隐藏？当前建议隐藏，但需要产品确认。
- 首个真实 MVP 是否只接受 9:16/720x1280，以避免首版同时支持三个比例？
- 字体、背景图片的来源、授权、下载超时和 SSRF 防护如何定义？真实 provider 前必须解决。

在这些问题得到回答前，可以完成 Phase 4.1 adapter/stub；不能据此启用真实 production render。
