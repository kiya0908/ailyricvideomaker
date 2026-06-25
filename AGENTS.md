# AGENTS.md

本文件是本仓库内所有代理和自动化协作者的工作说明。回答用户时使用中文；新增或维护文档时也优先使用中文，除非文件本身是英文 API 文档、代码注释或上游模板。

## 工作态度

- 先审题，再动手。必须主动指出需求里的盲点、冲突、风险和不现实之处。
- 不要只顺着用户的话做。如果方案明显绕远、风险很高或逻辑不成立，要直接说出来，并给出更稳的替代路径。
- 质疑假设，但落到行动。指出问题后要继续给出可执行的下一步，而不是停在批评上。
- 保持小步修改。除非用户明确要求重构，否则不要做无关格式化、重命名、依赖升级或目录搬家。
- 代码和文档都要写得朴素、清楚、可维护。不要为了显得聪明引入过早抽象。

## 当前项目画像

这是一个 Bun workspace 的 Cloudflare Workers SaaS monorepo。

- 根目录 `package.json` 管理 workspace：`apps/*` 和 `packages/*`。
- `apps/user-application` 是用户侧应用：TanStack Start + TanStack Router + React 19 + Vite + Tailwind CSS v4，部署到 Cloudflare Worker。
- `apps/data-service` 是独立 Worker 服务：Hono + Cloudflare WorkerEntrypoint，目前功能很轻。
- `packages/data-ops` 管理认证、数据库、Drizzle schema/migrations、查询和 zod schema。
- `packages/ui` 是共享 UI 包：shadcn/base-ui 风格组件、Tailwind 全局样式和工具函数。
- `packages/eslint-config` 和 `packages/typescript-config` 是共享工程配置。
- 当前业务里已有歌词视频功能：`apps/user-application/src/features/lyric-videos`、对应 API routes、R2 bucket 绑定和 `packages/data-ops/src/drizzle/lyric-video-schema.ts`。

## 已知现场问题

- 当前 `.git` 是空目录，`git status` 会报 “not a git repository”。不要假装 Git 正常可用；需要提交/推送时先确认仓库元数据已恢复。
- 当前环境没有可用的 `bd` 命令。beads 工作流可以作为目标流程，但命令不可用时必须在交付说明里写明阻塞原因。
- 根目录 `IMPLEMENTATION_PLAN.md` 目前内容是乱码且像是已完成的旧计划。不要把它当成可信现状；复杂任务需要新计划时，先清理或重建计划内容。
- `.gitignore` 已排除 `.env`、`.env.*`、`.dev.vars`、`.wrangler`、`node_modules/` 等本地和敏感文件。不要把真实密钥写进受版本控制的文件。

## 常用命令

优先使用 Bun，不要混用 npm/pnpm/yarn，除非用户明确要求或现有脚本必须如此。

```bash
bun run setup
bun run build:data-ops
bun run dev:user-application
bun run dev:data-service
bun run deploy:user-application
bun run deploy:data-service
```

子项目常用命令：

```bash
bun run --filter user-application test --run
bun run --filter user-application build
bun run --filter data-service test --run
bun run --filter @repo/data-ops build
bun run --filter @workspace/ui lint
```

Cloudflare 类型生成：

```bash
bun run --filter user-application cf-typegen
bun run --filter data-service cf-typegen
```

## 代码边界

- 用户侧页面、路由、API route、前端状态和歌词视频 UI 放在 `apps/user-application`。
- 跨应用共享的数据结构、认证、Drizzle schema、migration、数据库访问和 zod schema 放在 `packages/data-ops`。
- 可复用展示组件放在 `packages/ui`；业务组件留在具体 app。
- Worker 后端能力如果是独立服务，放在 `apps/data-service`；如果是用户应用内部 API，放在 `apps/user-application/src/routes/api`。
- `routeTree.gen.ts` 是 TanStack Router 生成文件。不要手改它；通过路由文件变化和构建/生成流程更新。
- `worker-configuration.d.ts` 是 Wrangler 类型生成文件。绑定变化后运行对应 `cf-typegen`。

## 实现流程

1. 理解：先读相邻代码，至少找 2-3 个相似实现或约定。
2. 定界：确认会影响哪些 app/package、API、数据表、环境绑定和部署配置。
3. 计划：多文件或行为性改动先写 3-5 步短计划；简单文档或单点修复可直接做。
4. 验证：优先补测试或运行已有测试；UI 展示改动至少说明手动验证路径。
5. 复盘：交付时说明改了什么、为什么、如何验证、剩余风险。

复杂任务需要 `IMPLEMENTATION_PLAN.md` 时，使用这个格式，并随着进展更新状态：

```markdown
## Stage N: 名称
**Goal**: 可交付目标
**Success Criteria**: 可验证结果
**Tests**: 具体测试或验证命令
**Status**: Not Started | In Progress | Complete
```

任务全部完成后，删除临时计划文件，或将仍需跟进的事项转成 issue/交接说明。不要留下过期计划污染下一次判断。

## 验证标准

- 行为逻辑、数据结构、API、认证、存储、数据库迁移必须有可验证路径，优先自动化测试。
- UI 纯展示改动可以不写测试，但必须说明浏览器或构建验证方式。
- 改 `packages/data-ops` 后至少运行 `bun run build:data-ops`。
- 改 `apps/user-application` 后按风险选择运行 `bun run --filter user-application test --run`、`bun run --filter user-application build`、`cf-typegen`。
- 改 `apps/data-service` 后按风险选择运行 `bun run --filter data-service test --run`、`bun run --filter data-service cf-typegen`、Wrangler dev/build 相关检查。
- 改 `packages/ui` 后运行 `bun run --filter @workspace/ui lint`，并确认使用方不会被样式或导出破坏。
- 如果命令因依赖、网络、权限或当前仓库状态失败，要记录原始错误和影响，不要把失败包装成通过。

## 环境变量和密钥

提交代码前必须检查是否有关键环境变量或密钥被硬编码。重点看：

- `wrangler.jsonc`
- `.env*`
- `.dev.vars`
- `packages/data-ops/drizzle.config.ts`
- `apps/**/src`
- `packages/**/src`
- 文档里的示例密钥

允许提交空字符串、占位符、示例值和绑定名；禁止提交真实 token、secret、password、private key、Cloudflare API token、Polar secret、Google OAuth secret、数据库连接串等。

建议扫描命令：

```bash
rg -n "SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|CLOUDFLARE|POLAR|GOOGLE_CLIENT_SECRET|BETTER_AUTH_SECRET" .
```

注意：扫描命令不是免死金牌。即使命令没扫到，也要人工看配置语义；例如 `wrangler.jsonc` 里的 secret 字段只能是空值或占位符。

真实本地值放进 `.env`、`.env.*` 或 `.dev.vars`。Cloudflare 生产密钥通过 Wrangler secret / dashboard 管理，不写入仓库。

## 数据库、R2 和 Cloudflare 约束

- D1 schema 和 migration 归 `packages/data-ops/src/drizzle` 管。
- 本地 D1 路径由 `packages/data-ops/drizzle.config.ts` 从 `apps/user-application/.wrangler/state/...` 探测。没有本地 D1 时迁移命令可能无法运行，必须说明。
- 歌词视频音频和输出使用 `LYRIC_VIDEO_BUCKET` R2 绑定。涉及对象 key、权限和下载接口时，要确认只能访问当前用户自己的资源。
- `apps/user-application/wrangler.jsonc` 中已有 `DB` 和 `LYRIC_VIDEO_BUCKET` 绑定，以及认证/支付相关 env 占位。
- `apps/data-service/wrangler.jsonc` 当前只有基础 Worker 配置；新增绑定时同步更新类型。

## Git 和 issue 流程

目标流程使用 beads：

```bash
bd prime
bd ready
bd create "标题" --type task --priority 2
bd close <id>
bd sync
```

但当前环境 `bd` 不可用，且 `.git` 不是有效仓库。遇到这种情况：

- 不要执行破坏性 Git 修复。
- 不要声称已经提交、同步或推送。
- 在最终交付中明确写出：Git/bd 不可用，因此未提交、未推送、未同步 issue。
- 如果用户要求提交/推送，先要求恢复有效 `.git` 或提供正确仓库。

当 Git 恢复正常，结束工作会话时应执行：

```bash
git status --short --branch
git pull --rebase
bd sync
git push
git status --short --branch
```

只有在这些命令真实成功后，才能说工作已提交并推送。

## 禁止事项

- 不要使用 `--no-verify` 绕过 hook。
- 不要禁用测试来制造“通过”。
- 不要提交无法编译的代码。
- 不要吞掉错误或只 `console.log` 后继续假装成功。
- 不要把真实密钥写进代码、配置、文档或测试夹具。
- 不要手改生成文件来掩盖源文件问题。
- 不要在需求不清时做跨模块大改；先收窄问题。

## 交付格式

交付时用中文简洁说明：

- 改了哪些文件，以及为什么。
- 运行了哪些验证命令，结果如何。
- 哪些验证没能运行，原因是什么。
- 是否有安全、数据迁移、部署或兼容性风险。
- 对用户输入里的问题或盲点给出直接提醒。
