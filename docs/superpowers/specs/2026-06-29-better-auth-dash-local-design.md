# Better Auth Dash 本地接入设计

Status: Deferred

Reason: Current priority is staging auth and upload chain validation. Better Auth Dash is observability-only and not required for MVP. Revisit after staging login/upload flow is stable.

## 背景

项目已经使用 Better Auth，并通过 `packages/data-ops` 统一创建服务端认证实例。用户应用在 `apps/user-application` 中读取 Cloudflare Worker 环境变量并初始化认证。当前登录方式是 Email OTP；本地开发时验证码输出到 Worker 日志。

本次只接入 Better Auth Infrastructure 的 `dash` 管理面板、分析和审计能力，不扩展生产登录能力，也不启用 Sentinel 安全插件。

## 目标

- 只允许本地开发环境通过 `.dev.vars` 配置 `BETTER_AUTH_API_KEY` 并启用 `dash()`。
- 保持现有 Email OTP 登录流程不变，开发者继续从本地 Worker 日志读取验证码。
- 未配置 Infrastructure API Key 的环境不启用 `dash()`；未配置 Key 时，现有 Email OTP 登录必须继续可用。
- 不在受版本控制的文件中保存真实 API Key。
- 依赖声明与实际使用它的 workspace 保持一致。

## 非目标

- 不接入 `sentinel()` 或 `sentinelClient()`。
- 不在应用内展示审计日志，因此不接入 `dashClient()`。
- 不接入生产邮件服务。
- 不启用 `activityTracking`，不新增 `lastActiveAt` 字段或 D1 migration。
- 不修改现有认证路由、登录页面或 OTP 交互。

## 环境硬边界

- 本阶段只允许 local dev 使用 `BETTER_AUTH_API_KEY`。
- staging 和 production 不配置 `BETTER_AUTH_API_KEY`。
- 不修改 `wrangler.jsonc` 的 `vars`，不配置 staging secret 或 production secret。
- 不部署 staging，不部署 production；所有运行时验证只使用本地 `.dev.vars` 和本地 Worker。
- 如果未来要在 staging 或 production 启用 Dash，必须重新评估登录可用性、密钥管理、外部服务故障和部署回滚，并经过单独设计和批准。

## 方案选择

采用服务端按环境可选启用方案：`createBetterAuth()` 接收可选的 Infrastructure API Key，仅在 Key 存在时把 `dash({ apiKey })` 加入插件列表。

没有采用无条件启用方式，因为它会强迫测试、CLI 和尚未配置 Key 的部署环境同时提供密钥。没有加入客户端插件，因为当前应用不需要直接调用审计日志 API。

## 设计

### 依赖边界

`@better-auth/infra` 由 `packages/data-ops` 的认证工厂直接导入，因此依赖应声明在 `packages/data-ops/package.json`，而不是只声明在 monorepo 根 `package.json`。锁文件随 workspace 依赖调整更新。

### 服务端配置

`packages/data-ops/src/auth/setup.ts` 增加纯配置 helper `createAuthPlugins({ infraApiKey })`。它始终返回现有 `emailOTP()`；当 `infraApiKey` 是非空字符串时，再加入 `dash({ apiKey: infraApiKey })`。`createBetterAuth()` 使用该 helper 生成插件列表，避免测试 Better Auth 返回实例的内部结构。

`packages/data-ops/src/auth/server.ts` 沿用现有参数透传，不新增全局状态或环境变量读取逻辑。共享包只接收显式配置，不直接依赖 Cloudflare Worker 运行时。

### Worker 环境注入

`apps/user-application/src/server.ts` 从 `cloudflare:workers` 的 `env.BETTER_AUTH_API_KEY` 读取 Key，并通过一个只负责显式字段映射的薄 helper 作为 `infraApiKey` 传给 `setAuth()`。测试该映射边界，不依赖 `cloudflare:workers` 的内部实现。

`apps/user-application/src/runtime-env.d.ts` 只声明可选的 `BETTER_AUTH_API_KEY` 变量名和类型，不包含值。该类型声明不代表允许在 staging 或 production 配置 Key；运行环境仍受“环境硬边界”约束。

本地真实 Key 由开发者写入 `apps/user-application/.dev.vars`：

```dotenv
BETTER_AUTH_API_KEY=本地真实值
```

`.dev.vars` 已被根目录 `.gitignore` 排除，不创建或提交包含真实值的示例文件。

### 数据流

1. Wrangler 启动本地 Worker，并从 `.dev.vars` 加载 `BETTER_AUTH_API_KEY`。
2. 用户应用的 Worker 入口把 Key 显式传给 `setAuth()`。
3. `packages/data-ops` 创建 Better Auth 实例；存在 Key 时注册 `dash()`。
4. 用户通过现有 Email OTP 流程登录。
5. Better Auth 的认证事件由 `dash` 插件发送到 Infrastructure 服务，并可在管理面板查看。

### 错误处理

- Key 未配置：跳过 `dash()`，现有 Email OTP 登录必须继续运行。
- Key 配置错误或外部服务不可用：通过本地 OTP 登录 smoke 明确验证其影响，不能只依赖插件文档或推测。如果错误 Key 导致 OTP 请求、验证码校验或会话建立失败，本功能不得合并。
- Dash 不得成为登录必要条件，也不得把外部 Infrastructure 服务故障扩散为本地认证不可用。
- OTP 邮件未发送：这是现有本地实现的预期行为，验证码从 Worker 日志读取，不在本次改动中接入邮件服务。

## 分阶段实施

### Phase A：依赖、导入与构建 Spike

- 把 `@better-auth/infra` 声明到实际使用它的 `packages/data-ops`。
- 增加最小 `dash` import 和 `createAuthPlugins()` 配置接缝。
- 运行数据包构建和相关单元测试。
- 本阶段不配置 Key、不启动面板验证；构建失败时停止，不进入 Phase B。

### Phase B：本地 Key 与 OTP 登录 Smoke

- 只在被忽略的本地 `.dev.vars` 中配置 Key。
- 验证无 Key、正确 Key、错误 Key 三种情况下的 OTP 请求、验证码校验和会话建立。
- 任一 Dash 配置导致登录失败时停止，本功能不得合并，也不进入 Phase C。

### Phase C：面板事件确认

- 使用正确的本地 Key 完成一次 OTP 登录。
- 在 Better Auth Infrastructure 管理面板确认用户或认证事件可见。
- 不进行 staging 或 production 部署验证。

每个阶段独立验证，只有前一阶段通过后才能继续下一阶段；不把三个阶段压成一次不可定位问题的完整接入。

## 验证

### 自动化测试目标

- 未传 `infraApiKey` 时，`createAuthPlugins()` 的结果不包含 Dash 插件。
- 传入 `infraApiKey` 时，`createAuthPlugins()` 注册 Dash 插件。
- `setAuth()` 能把 `infraApiKey` 透传给认证配置工厂。
- Worker 环境映射 helper 能读取 `env.BETTER_AUTH_API_KEY` 并映射为 `infraApiKey`。
- 未配置 Key 时，数据包构建、用户应用测试和用户应用构建全部通过。

测试只验证公开配置接缝和行为，不读取 Better Auth 实例内部私有插件列表，不为测试引入脆弱的实现耦合。

实现后执行：

```bash
bun run build:data-ops
bun run --filter user-application test --run
bun run --filter user-application build
```

手动验证：

1. 不配置 Key：启动本地应用并完成一次 Email OTP 登录。
2. 配置正确 Key：重新启动本地应用，完成登录，并在管理面板确认事件可见。
3. 配置一个明确无效的测试值：重新启动本地应用，再次完成 OTP 请求、验证码校验和会话建立。
4. 如果第 1 或第 3 步登录失败，停止交付，本功能不得合并。
5. 验证全过程不修改 `wrangler.jsonc`，不配置远程 secret，也不触发任何部署。

提交前扫描敏感信息，并人工检查变更文件：

```bash
rg -n "SECRET|TOKEN|PASSWORD|PRIVATE_KEY|DATABASE_URL|CLOUDFLARE|POLAR|GOOGLE_CLIENT_SECRET|BETTER_AUTH_SECRET|BETTER_AUTH_API_KEY" .
```

扫描结果中允许出现环境变量名、类型声明和占位说明，禁止出现真实 API Key 或其他密钥值。

## 风险与兼容性

- `dash` 依赖外部 Infrastructure 服务；本地网络不可用时，面板数据可能无法上报。
- 当前 OTP 输出包含邮箱和验证码，只适合本地开发。把这套行为部署到生产环境会泄露验证码，后续上线前必须接入真实邮件服务并移除日志输出。
- 本次不启用活动追踪，因此不会生成 `lastActiveAt` 数据；如果以后启用，必须同步生成并审核 D1 migration。
- `@better-auth/infra` 当前版本为 `0.3.4`，仍是 `0.x` 版本。未来升级前应复核插件 API 和行为，避免直接使用宽松版本升级造成破坏。
- 即使代码允许可选 Key，当前批准范围仍仅限 local dev；类型能力不能被误解为 staging 或 production 的部署授权。
