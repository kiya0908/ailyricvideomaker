# 项目现状梳理

本文档记录当前仓库的页面、程序文件、数据库结构和关键风险，方便后续继续开发 AI Lyric Video Maker 方向时快速接手。

## 一句话结论

当前项目是一个 **Cloudflare Workers SaaS 模板**，已经被初步改向 **AI Lyric Video Maker**：

- 模板能力：TanStack Start、Better Auth、Polar 订阅、Cloudflare D1/R2、共享 UI 包。
- 新业务能力：已新增歌词视频上传、列表、编辑、生成入口和数据库表。
- 关键现实：AI 转写和真实视频生成目前还是占位实现，不是完整可上线产品。

需要特别清醒的一点：页面上出现 “Generate video” 并不代表真的生成了 mp4。当前 `transcribeAudioToLyrics()` 返回固定假歌词，`renderLyricVideo()` 返回 stub，最终写入 R2 的输出内容也是 JSON 占位数据。

## Monorepo 结构

根目录 `package.json` 使用 Bun workspace：

```json
"workspaces": [
  "packages/*",
  "apps/*"
]
```

主要目录：

| 目录 | 作用 |
|---|---|
| `apps/user-application` | 用户侧 Web 应用，TanStack Start + React + Cloudflare Worker |
| `apps/data-service` | 独立 Cloudflare Worker 服务，当前只有基础 Hono 示例 |
| `packages/data-ops` | 认证、数据库初始化、Drizzle schema、migration、查询 |
| `packages/ui` | 共享 UI 组件、样式、hooks、工具函数 |
| `packages/eslint-config` | 共享 ESLint 配置 |
| `packages/typescript-config` | 共享 TypeScript 配置 |

## 用户侧页面

以下页面都在 `apps/user-application/src/routes` 下，由 TanStack Router 文件路由生成。

| URL | 页面作用 | 主要文件 | 当前状态 |
|---|---|---|---|
| `/` | 首页 landing page | `apps/user-application/src/routes/index.tsx` | 仍主要是模板首页，不是 AI Lyric Video Maker 品牌页 |
| `/docs` | 文档入口页 | `apps/user-application/src/routes/_static/docs/index.tsx` | 模板文档页 |
| `/docs/$name` | Markdown 文档详情 | `apps/user-application/src/routes/_static/docs/$name.tsx` | 读取 `public/docs/*.md` |
| `/app` | 登录后 dashboard | `apps/user-application/src/routes/_auth/app/index.tsx` | 模板示例数据，还未业务化 |
| `/app/lyric-videos` | 歌词视频列表和音频上传 | `apps/user-application/src/routes/_auth/app/lyric-videos.tsx` | 新业务主页面 |
| `/app/lyric-videos/$id` | 歌词时间轴编辑、模板设置、生成按钮 | `apps/user-application/src/routes/_auth/app/lyric-videos.$id.tsx` | 新业务详情页，但生成逻辑仍是占位 |
| `/app/polar/subscriptions` | 订阅套餐选择 | `apps/user-application/src/routes/_auth/app/polar/subscriptions.tsx` | 模板支付功能 |
| `/app/polar/portal` | 跳转 Polar 用户门户 | `apps/user-application/src/routes/_auth/app/polar/portal.tsx` | 依赖 `POLAR_SECRET` |
| `/app/polar/checkout/success` | 支付成功/处理中页面 | `apps/user-application/src/routes/_auth/app/polar/checkout.success.tsx` | 模板支付回调页 |

登录保护入口：

- `apps/user-application/src/routes/_auth/route.tsx`
- 未登录时显示 `GoogleLogin`
- 登录后显示 `AppSidebar`、`SiteHeader` 和子页面 `Outlet`

全局根路由：

- `apps/user-application/src/routes/__root.tsx`
- 设置 HTML 文档、全局 CSS、主题、错误页、not found、Router/Query devtools

## 导航现状

Sidebar 文件：

- `apps/user-application/src/components/dashboard/app-sidebar.tsx`

当前导航里存在一些模板残留入口：

| 导航项 | URL | 实际页面状态 |
|---|---|---|
| Dashboard | `/app` | 有页面，但还是模板示例数据 |
| Subscriptions | `/app/polar/subscriptions` | 有页面 |
| Lyric Videos | `/app/lyric-videos` | 有页面，是新业务主入口 |
| Analytics | `/app/analytics` | 当前没有对应 route |
| Projects | `/app/projects` | 当前没有对应 route |
| Team | `/app/team` | 当前没有对应 route |
| Settings | `/app/settings` | 当前没有对应 route |
| Get Help | `/app/help` | 当前没有对应 route |
| Search | `/app/search` | 当前没有对应 route |

结论：导航菜单还没清理。菜单上出现的链接不等于功能已实现。

## API 接口

歌词视频相关 API 都在 `apps/user-application/src/routes/api`。

| URL | 方法 | 作用 | 文件 |
|---|---|---|---|
| `/api/auth/$` | GET/POST | Better Auth 认证入口 | `apps/user-application/src/routes/api/auth.$.tsx` |
| `/api/lyric-videos` | GET | 获取当前用户的歌词视频列表 | `apps/user-application/src/routes/api/lyric-videos.tsx` |
| `/api/lyric-videos` | POST | 上传音频并创建歌词视频记录 | `apps/user-application/src/routes/api/lyric-videos.tsx` |
| `/api/lyric-videos/$id` | GET | 获取当前用户的单个歌词视频 | `apps/user-application/src/routes/api/lyric-videos.$id.tsx` |
| `/api/lyric-videos/$id` | PATCH | 更新歌词 JSON 和模板配置 | `apps/user-application/src/routes/api/lyric-videos.$id.tsx` |
| `/api/lyric-videos/$id/render` | POST | 触发生成视频 | `apps/user-application/src/routes/api/lyric-videos.$id.render.tsx` |
| `/api/lyric-videos/$id/audio` | GET | 返回 R2 中的原始音频 | `apps/user-application/src/routes/api/lyric-videos.$id.audio.tsx` |
| `/api/lyric-videos/$id/output` | GET | 返回 R2 中的输出视频 | `apps/user-application/src/routes/api/lyric-videos.$id.output.tsx` |

权限模型：

- `apps/user-application/src/features/lyric-videos/api.ts` 提供 `requireUserId()`。
- API 先通过 Better Auth session 取当前用户 ID。
- 查询和更新歌词视频时都按 `userId + id` 过滤。
- R2 对象读取前也先确认该视频属于当前用户。

## 歌词视频业务模块

核心目录：

```text
apps/user-application/src/features/lyric-videos
```

| 文件 | 作用 |
|---|---|
| `api.ts` | API 响应工具、鉴权工具、错误响应 |
| `service.ts` | 业务核心：列表、创建、更新、渲染、R2 读写 |
| `lyrics.ts` | 默认模板、歌词归一化逻辑 |
| `validation.ts` | zod 校验：歌词行、歌词 JSON、模板配置、更新请求 |
| `types.ts` | TypeScript 类型 |
| `lyrics.test.ts` | 歌词归一化测试 |
| `render-node-example.ts` | Node/ffmpeg 风格的示例渲染代码，目前未接入 Worker 主流程 |

当前上传流程：

1. 用户在 `/app/lyric-videos` 上传音频。
2. POST `/api/lyric-videos`。
3. 服务端校验文件类型。
4. 音频写入 R2：`lyric-videos/{userId}/{videoId}/audio`。
5. D1 创建 `lyric_videos` 记录，状态先是 `processing`。
6. 调用 `transcribeAudioToLyrics()`。
7. 当前该函数返回固定的三行假歌词。
8. 更新状态为 `ready-for-edit`。

当前生成流程：

1. 用户在详情页编辑歌词和模板。
2. PATCH `/api/lyric-videos/$id` 保存修改。
3. POST `/api/lyric-videos/$id/render`。
4. 服务端将状态改为 `rendering`。
5. 调用 `renderLyricVideo()`。
6. 当前该函数只是返回 `stub://lyric-video-render`。
7. 服务端向 R2 写入一个 JSON 占位内容，content-type 标成 `video/mp4`。
8. 更新状态为 `ready`，输出地址为 `/api/lyric-videos/$id/output`。

## 数据库结构

数据库使用 Cloudflare D1 + Drizzle。schema 位于：

- `packages/data-ops/src/drizzle/auth-schema.ts`
- `packages/data-ops/src/drizzle/lyric-video-schema.ts`

迁移文件：

- `packages/data-ops/src/drizzle/0000_right_grim_reaper.sql`
- `packages/data-ops/src/drizzle/0001_lyric_videos.sql`

### `auth_user`

用户表。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `name` | 用户名 |
| `email` | 邮箱，唯一 |
| `email_verified` | 邮箱是否验证 |
| `image` | 头像 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### `auth_session`

登录 session 表。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `expires_at` | 过期时间 |
| `token` | session token，唯一 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `ip_address` | IP 地址 |
| `user_agent` | 浏览器/客户端信息 |
| `user_id` | 关联 `auth_user.id`，用户删除时级联删除 |

索引：

- `auth_session_token_unique`
- `auth_session_userId_idx`

### `auth_account`

第三方账号/OAuth 绑定表。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `account_id` | 第三方账号 ID |
| `provider_id` | 第三方 provider，例如 Google |
| `user_id` | 关联 `auth_user.id`，用户删除时级联删除 |
| `access_token` | OAuth access token |
| `refresh_token` | OAuth refresh token |
| `id_token` | OAuth id token |
| `access_token_expires_at` | access token 过期时间 |
| `refresh_token_expires_at` | refresh token 过期时间 |
| `scope` | OAuth scope |
| `password` | 密码字段，当前 email/password 关闭 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

索引：

- `auth_account_userId_idx`

### `auth_verification`

验证记录表，用于 OTP 等验证流程。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `identifier` | 验证对象，例如邮箱 |
| `value` | 验证值 |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

索引：

- `auth_verification_identifier_idx`

### `lyric_videos`

歌词视频业务表。

| 字段 | 说明 |
|---|---|
| `id` | 主键，视频 ID |
| `user_id` | 关联 `auth_user.id`，用户删除时级联删除 |
| `title` | 视频标题 |
| `audio_file_url` | 音频 API 地址 |
| `lyrics_json` | 歌词 JSON |
| `template_config` | 视频模板配置 JSON |
| `status` | 状态：`processing`、`ready-for-edit`、`rendering`、`ready`、`failed` |
| `output_video_url` | 输出视频 API 地址，可为空 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

索引：

- `lyric_videos_user_id_idx`
- `lyric_videos_status_idx`

## R2 存储结构

歌词视频使用 Cloudflare R2 bucket 绑定：

```text
LYRIC_VIDEO_BUCKET
```

对象 key 规则：

```text
lyric-videos/{userId}/{videoId}/audio
lyric-videos/{userId}/{videoId}/output.mp4
```

相关代码：

- `apps/user-application/src/features/lyric-videos/service.ts`
- `apps/user-application/src/routes/api/lyric-videos.$id.audio.tsx`
- `apps/user-application/src/routes/api/lyric-videos.$id.output.tsx`

## 环境变量和 Cloudflare 绑定

主要配置文件：

- `apps/user-application/wrangler.jsonc`

当前关键绑定和变量：

| 名称 | 类型 | 说明 |
|---|---|---|
| `DB` | D1 binding | 用户、认证、歌词视频数据库 |
| `LYRIC_VIDEO_BUCKET` | R2 binding | 存储上传音频和输出视频 |
| `BETTER_AUTH_SECRET` | env var | Better Auth secret |
| `GOOGLE_CLIENT_ID` | env var | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | env var | Google OAuth secret |
| `POLAR_SECRET` | env var | Polar API secret |

真实密钥不要写入仓库。生产环境应使用 Cloudflare secret/dashboard 管理，本地使用 `.env`、`.env.*` 或 `.dev.vars`。

## 认证和应用启动

入口文件：

- `apps/user-application/src/server.ts`

启动时做的事：

1. 从 Cloudflare `env.DB` 初始化 Drizzle D1 数据库。
2. 用 `BETTER_AUTH_SECRET`、Google OAuth 配置和 Drizzle adapter 初始化 Better Auth。
3. 交给 TanStack Start server handler 处理请求。

认证相关文件：

- `packages/data-ops/src/auth/setup.ts`
- `packages/data-ops/src/auth/server.ts`
- `apps/user-application/src/lib/auth-client.ts`
- `apps/user-application/src/routes/api/auth.$.tsx`

注意：`emailOTP` 当前把 OTP 输出到 worker log，这只适合开发环境。生产环境必须换成真实邮件服务，例如 Resend 或 Postmark。

## 支付模块

支付使用 Polar，主要是模板保留能力。

主要文件：

- `apps/user-application/src/routes/_auth/app/polar/subscriptions.tsx`
- `apps/user-application/src/routes/_auth/app/polar/portal.tsx`
- `apps/user-application/src/routes/_auth/app/polar/checkout.success.tsx`
- `apps/user-application/src/core/functions/payments.ts`
- `apps/user-application/src/components/payments/polar/*`
- `packages/data-ops/src/queries/polar.ts`

当前判断：支付模块还没有和歌词视频业务权益强绑定。例如生成次数、视频数量、导出权限等还没接入订阅状态。

## 独立 data-service

目录：

```text
apps/data-service
```

主要文件：

- `apps/data-service/src/index.ts`
- `apps/data-service/src/hono/app.ts`
- `apps/data-service/wrangler.jsonc`

当前状态：

- WorkerEntrypoint 接入 Hono app。
- Hono app 只有 `/` 返回 `Hello World`。
- 还没有承载 AI 转写、渲染队列、Webhook 或后台任务。

后续如果要做真实视频生成，可能需要重新评估：放在 `user-application` 内部 API、独立 `data-service`、Cloudflare Workflows、Queues、R2 event，还是外部渲染服务。

## 当前最大风险和下一步建议

### 当前风险

1. 首页、dashboard、docs、sidebar 仍有大量 SaaS 模板残留，品牌和业务不统一。
2. `/app` dashboard 是假数据，不是歌词视频业务仪表盘。
3. AI 转写是 stub，没有接 Whisper、Workers AI、OpenAI、AssemblyAI 等真实服务。
4. 视频生成是 stub，没有真正生成 mp4。
5. 输出接口把 JSON 占位内容用 `video/mp4` 返回，容易误判功能已完成。
6. Polar 支付没有和歌词视频用量/权限绑定。
7. 导航里多个链接没有 route，会进入 not found。
8. `apps/data-service` 还没有真实业务职责。

### 建议优先级

1. 清理模板残留：先把首页、sidebar、dashboard 改成 AI Lyric Video Maker 语境。
2. 明确 MVP：上传音频、自动转写、编辑歌词、选择模板、生成视频、下载视频。
3. 接入真实转写服务：先做一条稳定链路，不要同时试多个供应商。
4. 接入真实渲染方案：明确是在 Worker 内生成、外部服务生成，还是异步队列生成。
5. 给 `lyric_videos` 增加失败原因、渲染任务 ID、文件大小、时长等字段。
6. 把订阅权益和生成次数/导出权限绑定。
7. 删除或隐藏未实现的导航入口。
8. 增加端到端验证：上传、转写、编辑、渲染、下载。

## 快速定位文件

| 需求 | 优先查看 |
|---|---|
| 改首页 | `apps/user-application/src/routes/index.tsx`、`apps/user-application/src/components/landing/*` |
| 改登录后布局 | `apps/user-application/src/routes/_auth/route.tsx`、`apps/user-application/src/components/dashboard/*` |
| 改侧边栏 | `apps/user-application/src/components/dashboard/app-sidebar.tsx` |
| 改歌词视频列表页 | `apps/user-application/src/routes/_auth/app/lyric-videos.tsx` |
| 改歌词视频详情页 | `apps/user-application/src/routes/_auth/app/lyric-videos.$id.tsx` |
| 改歌词视频 API | `apps/user-application/src/routes/api/lyric-videos*.tsx` |
| 改歌词视频业务逻辑 | `apps/user-application/src/features/lyric-videos/service.ts` |
| 改歌词/模板校验 | `apps/user-application/src/features/lyric-videos/validation.ts` |
| 改数据库 schema | `packages/data-ops/src/drizzle/*` |
| 改认证 | `packages/data-ops/src/auth/*`、`apps/user-application/src/routes/api/auth.$.tsx` |
| 改支付 | `apps/user-application/src/core/functions/payments.ts`、`apps/user-application/src/components/payments/polar/*` |
| 改 Worker 配置 | `apps/user-application/wrangler.jsonc` |




可以，先简单记录成这份“项目文件架构地图”。我这次没有改代码，只做只读梳理。

## 一、项目整体结构

```txt
cloudflare-workers-saas-kit-main/
├─ package.json
├─ bun.lock
├─ AGENTS.md
├─ apps/
│  ├─ user-application/
│  └─ data-service/
├─ packages/
│  ├─ data-ops/
│  ├─ ui/
│  ├─ eslint-config/
│  └─ typescript-config/
```

这个项目是 **Bun workspace / monorepo**，不是单个 Vite 项目。

根目录 `package.json` 里定义了：

```json
"workspaces": [
  "packages/*",
  "apps/*"
]
```

所以它的逻辑是：

```txt
apps = 可独立运行/部署的应用
packages = 被 apps 复用的共享包
```

---

## 二、根目录职责

### `package.json`

根目录主要负责统一编排命令：

```txt
bun run setup
bun run build:data-ops
bun run dev:user-application
bun run deploy:user-application
bun run dev:data-service
bun run deploy:data-service
```

可以理解为：

```txt
根目录 = 项目总控台
```

它不直接写业务页面，也不直接写 API 逻辑。

---

## 三、`apps/user-application`

这是当前最重要的目录。

```txt
apps/user-application/
├─ package.json
├─ wrangler.jsonc
├─ src/
│  ├─ routes/
│  ├─ features/
│  ├─ components/
│  ├─ server.ts
│  └─ routeTree.gen.ts
```

它是：

```txt
主用户应用
TanStack Start + React + Vite
部署为 Cloudflare Worker
```

你之后要做的 **AI Lyric Video Maker 主站**，核心基本都在这里改。

它负责：

```txt
首页
登录后用户后台
歌词视频列表
歌词视频编辑页
API routes
上传音频
读取 R2 文件
调用数据层
Cloudflare Worker 部署
```

---

## 四、`apps/user-application` 里的关键文件

### 1. 首页

```txt
apps/user-application/src/routes/index.tsx
```

当前应该还是模板首页。

后面要改成：

```txt
AI Lyric Video Maker 落地页
Hero
上传入口
功能介绍
How it works
Use cases
FAQ
SEO 内容
```

---

### 2. 登录后 app 首页

```txt
apps/user-application/src/routes/_auth/app/index.tsx
```

这是登录后的 `/app` 页面。

---

### 3. 歌词视频列表页

```txt
apps/user-application/src/routes/_auth/app/lyric-videos.tsx
```

对应路由：

```txt
/app/lyric-videos
```

这个页面已经是 lyric video 业务相关页面。

---

### 4. 单个歌词视频编辑页

```txt
apps/user-application/src/routes/_auth/app/lyric-videos.$id.tsx
```

对应路由：

```txt
/app/lyric-videos/$id
```

后面很可能要改成：

```txt
歌词编辑器
时间轴编辑
模板选择
预览
生成视频按钮
下载视频
```

---

### 5. lyric video API routes

从 `routeTree.gen.ts` 看，目前已有这些 API：

```txt
/api/lyric-videos
/api/lyric-videos/$id
/api/lyric-videos/$id/audio
/api/lyric-videos/$id/output
/api/lyric-videos/$id/render
```

对应文件大概率在：

```txt
apps/user-application/src/routes/api/
```

它们负责：

```txt
创建歌词视频
读取单个歌词视频
读取音频
读取输出视频
触发渲染
```

---

### 6. lyric video 业务逻辑

核心文件：

```txt
apps/user-application/src/features/lyric-videos/service.ts
```

目前已经有这些函数：

```txt
listLyricVideos()
getLyricVideo()
createLyricVideoFromUpload()
updateLyricVideo()
renderOwnedLyricVideo()
getLyricVideoAsset()
transcribeAudioToLyrics()
renderLyricVideo()
```

其中要特别注意：

```txt
transcribeAudioToLyrics() 当前是假的
renderLyricVideo() 当前也是假的
```

现在它只是返回 placeholder 数据，还没有真正接 AI 转录和视频渲染。

---

## 五、`apps/data-service`

```txt
apps/data-service/
├─ package.json
├─ wrangler.jsonc
└─ src/
```

它是一个独立 Cloudflare Worker 服务。

技术栈：

```txt
Hono + Cloudflare WorkerEntrypoint
```

目前从 package 描述看，它的定位是：

```txt
独立后端服务
复用 packages/data-ops 的数据访问能力
```

但从目前功能看，它还很轻，短期可以先不作为主战场。

你可以先这样理解：

```txt
apps/user-application = 主产品网站
apps/data-service = 未来可拆出去的后端服务
```

如果后面 lyric video 渲染流程变复杂，比如：

```txt
AI webhook
异步任务
渲染任务回调
队列消费
状态同步
```

再考虑让 `data-service` 承担一部分后端职责。

---

## 六、`packages/data-ops`

```txt
packages/data-ops/
├─ package.json
├─ src/
│  ├─ auth/
│  ├─ database/
│  ├─ drizzle/
│  ├─ queries/
│  └─ zod-schema/
```

它是整个项目的数据层。

负责：

```txt
认证
数据库连接
Drizzle schema
数据库 migration
查询方法
Zod schema
```

你可以理解为：

```txt
packages/data-ops = 后端数据模型和数据库操作层
```

---

## 七、`packages/data-ops` 里的 lyric video 表

关键文件：

```txt
packages/data-ops/src/drizzle/lyric-video-schema.ts
```

当前表名：

```txt
lyric_videos
```

字段大概是：

```txt
id
user_id
title
audio_file_url
lyrics_json
template_config
status
output_video_url
created_at
updated_at
```

状态包括：

```txt
processing
ready-for-edit
rendering
ready
failed
```

这个表已经很接近 AI lyric video maker 的核心数据模型。

但后面大概率还要补：

```txt
转录任务 ID
渲染任务 ID
错误信息
视频时长
文件大小
生成消耗积分
模板类型
封面图 URL
外部服务返回数据
```

---

## 八、`packages/ui`

```txt
packages/ui/
├─ package.json
├─ src/
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/
│  └─ styles/
```

这是共享 UI 组件库。

它导出了：

```txt
@workspace/ui/components/*
@workspace/ui/hooks/*
@workspace/ui/lib/*
@workspace/ui/globals.css
```

也就是说，`user-application` 里用到的 Button、Card、Dialog、Input 这类组件，大概率来自这里。

你可以理解为：

```txt
packages/ui = 内部版 shadcn/ui 组件库
```

后面做 AI lyric video maker 的业务组件，不一定都要放这里。

建议区分：

```txt
通用组件：放 packages/ui
业务组件：放 apps/user-application/src/features/lyric-videos
```

例如：

```txt
Button / Card / Input / Dialog -> packages/ui
LyricsEditor / TemplatePicker / VideoPreview -> user-application/features/lyric-videos
```

---

## 九、`packages/eslint-config` 和 `packages/typescript-config`

这两个是工程配置共享包。

```txt
packages/eslint-config
packages/typescript-config
```

负责：

```txt
统一 ESLint 规则
统一 TypeScript 配置
```

正常业务开发时不需要优先关注。

---

## 十、部署配置

关键文件：

```txt
apps/user-application/wrangler.jsonc
```

里面已经有：

### D1 数据库绑定

```json
{
  "binding": "DB",
  "database_name": "saas-kit-db",
  "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "remote": false,
  "migrations_dir": "packages/data-ops/src/drizzle"
}
```

### R2 bucket 绑定

```json
{
  "binding": "LYRIC_VIDEO_BUCKET",
  "bucket_name": "saas-kit-lyric-videos"
}
```

也就是说：

```txt
D1 = 存用户、歌词视频记录、状态
R2 = 存音频文件和生成后的视频文件
```

这对 AI lyric video maker 是有用的。

---

## 十一、目前项目里已经存在的 lyric video 雏形

现在这个模板不是完全空的。它已经有：

```txt
lyric_videos 数据表
歌词视频上传逻辑
歌词视频列表页
歌词视频详情页
音频 R2 存储
输出视频 R2 存储接口
render API
歌词 JSON
template config
状态流转
```

但它缺少真正核心能力：

```txt
真实音频转歌词
真实歌词时间轴
真实视频渲染
异步任务队列
积分扣费
失败重试
生成成本控制
SEO 落地页
```

所以当前项目状态可以记录为：

```txt
SaaS 底座已有
lyric video 业务壳子已有
AI 和视频生成核心还没接入
```

---

## 十二、我建议你先记住这张架构图

```txt
cloudflare-workers-saas-kit-main
│
├─ 根目录
│  └─ 管理 workspace、统一脚本、依赖锁
│
├─ apps
│  │
│  ├─ user-application
│  │  ├─ 主用户网站
│  │  ├─ 首页 / 登录 / 后台
│  │  ├─ lyric video 页面
│  │  ├─ lyric video API
│  │  └─ Cloudflare Worker 部署
│  │
│  └─ data-service
│     ├─ 独立后端 Worker
│     └─ 当前较轻，后期可用于异步服务
│
└─ packages
   │
   ├─ data-ops
   │  ├─ 数据库
   │  ├─ 认证
   │  ├─ Drizzle schema
   │  ├─ migrations
   │  └─ 查询逻辑
   │
   ├─ ui
   │  ├─ 通用 UI 组件
   │  ├─ hooks
   │  └─ 全局样式
   │
   ├─ eslint-config
   │  └─ 共享 ESLint 配置
   │
   └─ typescript-config
      └─ 共享 TS 配置
```

---

