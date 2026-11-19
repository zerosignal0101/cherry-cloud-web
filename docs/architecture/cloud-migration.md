# 从 Cherry Studio 桌面端改造为 Web 应用

本文记录 cherry-cloud-web 的目标形态、关键决策与实施顺序。后续实现以本文为准，变更需先改本文。

## 0. 当前状态

- M0 完成：源码基线入库，SPA 可构建，服务端可启动（`/api/health`、静态资源、深链回退均验证通过），`pnpm typecheck` 与 `pnpm lint` 通过。
- M1 完成：`POST /api/rpc` 复用上游 `IpcRouter` 与 zod 契约，`WS /api/ws` 推送事件；浏览器侧 `window.api.ipcApi` 改由 `src/renderer/ipc/webApi.ts` 实现（HTTP 一元调用 + WS 事件 + 重连）；新增 Node 平台层（数据目录、密钥加密）；`system.ping` 端到端验证通过（当时的 `APP_TOKEN` 在 M3 由密码会话取代）。
- M2 完成（数据与文件）：
  - SQLite 启动即建库：沿用上游 `migrations/sqlite-drizzle`，`openDatabase` 负责完整性检查、WAL/外键 pragma、迁移与 Web 子集种子；`application.get('DbService')` 由服务端注册，上游数据服务（`FileEntryService` 等）原样可用。
  - `src/platform/electron` 是 `electron` 的服务端替身（`app`/`ipcMain`/`dialog`/`shell`/`clipboard`），`tsconfig.server.json` 把 `electron` 指向它；上游 `src/main` 代码因此无需改动即可在 Node 下运行。
  - 文件只走服务端：`POST /api/files`（multipart，上限 100MB）写入 `DATA_DIR/files` 并生成 `file_entry` 行；`GET /media/:id` 支持 Range/ETag/304，供图片、音视频与预览使用。浏览器不再接触物理路径（`window.api.file` 的适配在 M4/M5 完成）。
  - 种子仅保留 Web 需要的子集（偏好、知识库排序、会话排序、翻译语言）；桌面功能与 Cherry 品牌相关的种子显式排除。
- M3 完成（鉴权）：
  - 单密码：`ADMIN_PASSWORD` 首次启动写入 `DATA_DIR/auth.json`（scrypt 哈希，0600），之后忽略该变量；重置需删除文件。
  - 会话：HMAC-SHA256 签名的无状态 Cookie（HttpOnly、SameSite=Lax、Path=/、按请求协议决定 Secure），有效期 `SESSION_TTL_DAYS`。
  - 保护面：`/api/rpc`、`/api/files`、`/media/:id`、SPA 页面均需会话；未登录页面请求 302 到 `/login?next=`，API 返回 401。
  - 登录页为服务端渲染的独立 HTML（M5 由 React 登录页替换），登录接口限速 10 次 / 5 分钟并带失败延迟。
  - 跨站防护：POST 与 WebSocket 升级校验 `Origin`（同源或 `ALLOWED_ORIGINS`），WebSocket 复用会话 Cookie，不再使用查询串 ticket。
- 依赖版本按 cherry-studio 的 `pnpm-lock.yaml` 固定，避免 `^` 漂移导致 patch 失效与重复的 React/micromark 类型。
- 为通过类型检查，renderer 中仍引用 Electron 类型的桌面专属文件使用 `src/renderer/types/electron-shim.d.ts` 占位；这些文件在 M5 删除。
- `pnpm lint` 目前只覆盖 `src/server`、`src/platform` 与脚本；`src/shared`、`src/renderer` 待 `window.api` 真实类型收敛后再纳入。

## 1. 目标

把 cherry-studio（Electron 桌面端）改造为公网访问、单一使用者的 Web 应用：

- 服务端持有数据与模型调用，浏览器只做界面。
- 桌面尺寸使用 URL 多页面，而非原来的单窗口标签页；手机端可访问，布局参考 cherry-studio-app。
- 移除原生桌面能力：划词助手、快捷助手、截图、托盘、快捷键、多窗口、自动更新。
- 移除 Cherry 官方云能力：账号登录、订阅/配额、支付、CherryIN、官方公告、埋点。
- 鉴权为单密码 + 会话 Cookie，无用户系统。

## 2. 架构

单 Node 进程同域提供：

```
GET  /                 静态 SPA（dist/web），未命中路由回退 index.html
POST /api/rpc          一元调用：{ id, route, input } -> IpcResult 信封
WS   /api/ws           事件推送与 AI 流式（event + payload；会话 Cookie + Origin 校验）
POST /api/auth/login   密码登录，写入会话 Cookie
POST /api/auth/logout  清除会话 Cookie
GET  /api/auth/status  当前会话状态
GET  /login            服务端渲染登录页（M5 由 SPA 页面替换）
POST /api/files        附件上传（multipart，单文件）-> FileEntry 描述 + /media/:id
GET  /media/:id        文件读取（Range / ETag）
```

- TLS、压缩、请求体上限由反向代理负责。
- 数据：SQLite（drizzle schema 与 migrations 沿用上游）+ `DATA_DIR/files`。
- 传输契约沿用 `src/shared/ipc` 的 zod schema，浏览器侧只替换 `window.api.ipcApi` 的实现。
- AI 流式沿用 `AiStreamManager` 的监听器模型：新增 WebSocket 监听器，不改引擎；`ai.stream.open/attach/detach/abort` 语义保留，支持断线重连与多标签页共享。

## 3. 边界

### 首版包含

对话（流式、推理、工具调用）、助手、话题、分组、供应商与模型、联网搜索、MCP、文件上传与预览、设置、鉴权、移动端布局。

### 首版不包含（分期）

知识库/RAG、绘画、Agents 与技能、代码工作区、浏览器、小应用、笔记、翻译、定时任务、本地模型（OVMS/ONNX/ASR/TTS）、云盘备份。

页面与菜单在首版隐藏或删除，服务端不注册对应服务。

## 4. 模块划分与上游同步

同步区（随提供商/协议变化，需定期从上游获取）：

| 类别 | 内容 | 同步方式 |
| --- | --- | --- |
| npm 依赖 | `@cherrystudio/provider-registry`、`@cherrystudio/web-search`、`@cherrystudio/ai-core`、`@cherrystudio/ai-sdk-provider`、`@cherrystudio/file-preview`、`@cherrystudio/remote-*` | 升级版本号，跑 provider-registry compat 校验 |
| 运行时目录 | 供应商/模型目录 | 复用 `ProviderRegistryUpdaterService` 的远端拉取，失败回退内置 |
| vendor | `packages/ui` 及后续需要的未发布模块 | `scripts/sync-upstream.mjs` 按 `upstream.json` 的 commit 覆盖，输出差异报告 |

非同步区：`src/renderer`、`src/server`、`src/platform`、`src/main` 的 Web 适配层。允许与上游分叉，不做逐行对齐。

## 5. 目录约定

```
src/shared/    协议与类型（复制自上游）
src/main/      业务服务（复制自上游，按 Web 服务白名单裁剪）
src/platform/  替代 electron 的 Node 平台层（app/net/safeStorage/dialog/shell/...）
src/server/    HTTP/WS/鉴权/上传/静态资源
src/renderer/  浏览器前端（复制自上游，改造 Shell 与文件访问）
packages/ui/   vendored UI 包
```

`src/platform` 之外禁止 `import 'electron'`，由 lint 规则保证。

## 6. 里程碑

1. **M0 基座**：建仓、复制源码、Vite 构建、服务端骨架、文档与规范。
2. **M1 平台层与传输**：Node 平台适配、RPC/WS 传输、浏览器侧 `window.api`、服务白名单。
3. **M2 数据与文件**：SQLite、上传/下载/预览、密钥加密。
4. **M3 鉴权**：密码、会话、限速、WS ticket、Origin 校验。
5. **M4 对话核心**：供应商与模型、流式、重连续传、多标签页、移除官方云能力。
6. **M5 双 Shell**：URL 多页面、桌面侧栏、移动抽屉与底部导航、桌面专属功能下架。
7. **M6 供应商与设置**：供应商管理、联网搜索、MCP、目录更新。
8. **M7 部署**：systemd、迁移、备份、日志、健康检查、反代示例。
9. **M8 上游同步**：`upstream.json`、同步脚本、定期检查。
10. **M9 收口**：单测、E2E、文档、i18n 裁剪。

## 7. 风险

- main 服务的 Electron 传递依赖：以 Web 服务白名单 + 平台层最小实现控制，无法服务者注入 stub。
- 文件子系统改造面大（`window.api.file` 约 250 处）：先做同名适配层，再逐页清理。
- webview 型能力无法迁移：首版删除，后续用 sandbox iframe + 服务端代理重做。
- 单进程 SQLite 不支持多副本：部署强制单实例，备份用 SQLite backup 而非拷贝。
- 无状态会话无法逐条吊销：登出只清 Cookie，泄露的令牌在过期前仍有效；用 `SESSION_TTL_DAYS` 收敛窗口，如需即时失效则删除 `DATA_DIR/session.key`（会使全部会话失效）。
- 密码校验用 scrypt（约几十毫秒/次），登录限速 10 次 / 5 分钟；暴力破解面已很小，但仍应把服务放在反向代理之后。
