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
  - 登录页为服务端渲染的独立 HTML（M5 已由 SPA 登录视图替换，见下）。登录接口限速 10 次 / 5 分钟并带失败延迟。
  - 跨站防护：POST 与 WebSocket 升级校验 `Origin`（同源或 `ALLOWED_ORIGINS`），WebSocket 复用会话 Cookie，不再使用查询串 ticket。
- M4 进行中（对话核心，传输层已完成）：
  - DataApi 走 HTTP：`POST /api/data` 复用上游 `ApiServer.handleRequest` 与完整 `apiHandlers`（主题、消息、助手、供应商、文件、标签等），请求/响应信封不变；浏览器 `window.api.dataApi.request` 已对接。
  - 数据变更通知：上游 `notifyDataApiDataChange` 仍调用 `WindowManager.broadcast`，服务端用 `src/server/data/windowManager.ts` 适配到 WebSocket 连接（事件 `data-api:data-changed`），写操作提交后各标签页自行收敛。
  - 连接身份：每个标签页在 `sessionStorage` 生成稳定 client id，RPC 带 `x-client-id`、WebSocket 升级带 `?client=`；`IpcContext.senderId` 即该 id，`ai.stream.*` 的定向推送据此路由（等价于桌面端的 WindowId）。
  - 前端已能打开对话页并渲染上游 composer；流式调用仍待真实供应商密钥联调。
- M5 完成（双 Shell 与页面裁剪）：
  - URL 即页面：`/` 重定向到 `/app/chat`，`/app/*` 由 `WebShell` 包裹，`/settings/*` 共用同一 Shell；`UrlTabsProvider` 仍实现 `TabsContext`，使上游约 37 处 `useTabs()` 调用无需改写。
  - 双 Shell：`md:` 以上是 56px 图标导航栏；以下为底部导航（对话 / 文件 / 设置）。导航项即首版范围，知识库、Agents、绘画、代码、笔记、翻译、定时任务、小应用等分期入口不再出现。
  - 设置菜单裁剪为 Web 子集：供应商、模型、MCP、提示词、联网搜索、文档处理、OCR、通用、外观、通知、数据、归档、用量、关于；Cherry 账号/订阅/网关、本地模型、划词助手/快捷助手/截图/快捷键、webview 浏览器、Agents/技能、通道与设备配对均不下发。
  - 移动端：设置导航收进抽屉，页头显示当前分区并可打开菜单；供应商设置改为列表/详情两级（返回按钮回到列表）；文件页固定分类栏在手机上换成页头筛选菜单；对话列表在手机上浮在聊天之上（点空白处关闭），不再挤压正文。
  - 登录：`/login` 由服务端返回 SPA shell，`entryPoint` 先查 `/api/auth/status`，未登录渲染独立 `LoginApp`（不读取 preference/IPC；通过公开的 `/api/ui/bootstrap` 取主题模式与界面语言，避免 401 回跳），登录成功整页跳转；已登录访问 `/login` 由服务端 302 到 `next`。设置页底部提供退出登录。原服务端渲染登录 HTML 已删除。
  - 文件子系统接通：服务端生命周期注册 `FileManager`，并在 `/api/rpc` 注册 `file.*` 路由（元数据、物理路径、条目创建/回收等）；`window.api.file` 由 `src/renderer/ipc/webFile.ts` 实现，`select` 走浏览器选择器并上传，`save`/`saveImage` 触发下载，字节型 `createInternalEntry` 走 `POST /api/files`。
  - 附件发送改为浏览器语义：composer 的附件持有所选 `File`（`ComposerAttachment.blob`），发送时上传为 internal `FileEntry`，消息部分带 `providerMetadata.cherry.fileEntryId` 与 `/media/:id` URL；服务端 `fileProcessor` 通过 `FileManager` 读取字节。粘贴、拖放、附件按钮都不再依赖桌面路径。
  - 文件页上传改为浏览器语义：按钮与拖放都走 `POST /api/files`，不再依赖桌面路径；图片预览 URL 对 internal 条目使用 `/media/:id`。
  - 新库会种入一个无模型的默认助手与空话题（`WebDefaultAssistantSeeder`），避免首次打开是一片空白；模型由用户在供应商设置中选择。
  - 仍待清理：路径式预览（`FilePreview` 仍按物理路径调用 file IPC）、Markdown 图片导出/备份等依赖路径的导出流程，以及删除残留的桌面专属页面与组件（菜单与路由已不可达或不在菜单中）。
- M6 完成（供应商与设置能力）：
  - 供应商与模型继续走 DataApi；服务端注册 `ProviderRegistryUpdaterService`，启动 30 秒后按需拉取镜像目录，校验 schema/版本/修订号后写入 `DATA_DIR/provider-registry` 并通知数据层刷新。版本兼容取上游 `minAppVersion..sourceAppVersion` 区间，默认报告 `2.2.0`（可被 `APP_VERSION` 覆盖），已验证 GitCode 镜像的 `models.json` / `provider-models.json` 成功落盘。
  - 注册 `WebSearchService` 与 `web_search.*` RPC 路由，设置页的联网搜索提供商开关、API Key、检查按钮均可用；未配置密钥时返回领域错误而非 `ROUTE_NOT_FOUND`。
  - 注册 `mcp.*` RPC 路由（服务器增删启停、工具/资源/提示词、交互回复）；`McpRuntimeService`/`McpCatalogService` 已在生命周期中。桌面协议的 MCP 安装入口由 `WebProtocolService` 占位（列表为空、安装请求明确拒绝），MCP 设置页不再展示桌面二进制依赖面板。
  - 已验证：供应商/模型/联网搜索/MCP 设置页渲染无控制台错误，web_search 与 mcp 路由均有响应，目录更新在启动后自动完成。
- M10 完成（共享基座与低成本功能）：
  - `WorkspaceService` + `workspace.*` RPC：所有功能域共用的服务端目录沙箱，路径限制在 `DATA_DIR/workspaces`，拒绝绝对路径、`..`、反斜杠与符号链接；支持工作区创建/删除、文件树、读写与删除。
  - `SecretStore`：基于 `SecretBox` 的服务端凭据存储（`DATA_DIR/secrets.json`，0600、原子写入），供后续 WebDAV/S3/频道凭据使用；不向渲染进程暴露明文。
  - `WebNotificationService`：以站内记录 + WebSocket `notification.present`/`notification.conversation` 取代系统通知；注册 `notification.send`/`notification.activate`，任务结果通知可落库、未读状态可更新。
  - 共享缓存桥：`cache.get_all_shared` + `cache.sync_shared`，`CacheService` 的 shared 层变更经 WS `cache:sync` 推送到各标签页；`jobs.state.*` 等运行状态恢复实时性，persist 层保持标签页本地。
  - 翻译文本接通：注册 `translate.open`，复用 `AiStreamManager` 的 `ai.stream.*`；未配置模型时返回 `translate.error.not_configured`，不再出现 `ROUTE_NOT_FOUND`。PDF/OCR 翻译仍延后。
  - 定时任务接通：注册 `AgentJobsService`，并补齐 `NotificationService`、`ChannelManager`、`AgentLifecycleService` 的 Web 适配（无频道/无运行时能力时降级）；任务的创建、读取、暂停/恢复、删除走服务端调度器，真实执行由 M12 的 Pi 运行时接通。
  - 导航加入翻译与定时任务入口；共享 Agent 界面挂载时探测桌面控制改为返回空快照，避免无意义报错。
  - 已验证：工作区 RPC、Agent + 定时任务创建/列表/删除、翻译路由错误语义、通知发送/已读、桌面与手机双 Shell 导航。
- 首版之后的八个功能域（Agents 与技能、代码工作区、浏览器、小应用、笔记、翻译、定时任务、云盘备份）已单独规划，见 [feature-migration.md](feature-migration.md)。执行顺序为 M10 共享基座与低成本功能 → M11 笔记 → M12 Agents 与技能 → M13 小应用与浏览器 → M14 代码工作区 → M15 云盘备份与导出 → M16 收口。
- M11 完成（笔记）：
  - 渲染进程只使用逻辑根 `/notes`；`NotesStorage` 将其映射到 `DATA_DIR/notes`，并校验 `..`、反斜杠、NUL、越界与符号链接。`app.get_info.notesPath` 返回 `/notes`，不再暴露宿主目录。
  - `notes.*` RPC 提供创建目录、写入/读取、重命名、移动、递归删除、列表与服务端全文搜索；重命名/移动/删除同步维护 `note` 表的星标/展开元数据。
  - 笔记树与编辑器继续复用 `file.tree.*` / `file.edit.*`，服务端在 `/notes` 边界翻译快照、变更事件、编辑租约和文件观察路径；缺少 ripgrep 时使用 Node `fs` 回退扫描。
  - 笔记设置移除目录选择；粘贴图片写入 `/media/<id>`，导入 Markdown 的旧 `file://.../files/<id>` 链接在写入时重写。
  - HTTP/WS 传输增加二进制标记（base64）编解码，修复 `Uint8Array` 经 JSON 退化；标签页断线保留 15 秒重连宽限，刷新后编辑租约仍可用。
  - 已验证：新建、编辑、自动保存、刷新保留、重命名、移动、删除、搜索、附件图片与双端页面；无控制台错误。
- M12 完成（Agents 与技能）：
  - 技能库以 `DATA_DIR/Skills` 为根，`SkillStorage` 在 `/skills` 逻辑根与宿主目录间翻译；ZIP 安装改为 `POST /api/skills/install` 上传，目录安装与 `folder.open` 从 Web 流程移除。
  - 注册 `AgentSessionRuntimeService`、`AgentLifecycleService`、`AgentSessionDeliveryService`、`AgentImportService`、`AgentJobsService`；Web 运行时为 `pi`，会话创建、发送、流式回复、停止与用量记录已端到端验证。
  - 固定版本 Pi SDK 缺少 `objectTransports`，Pi 模型请求改走内部回环 API Gateway；`pi-durable`（未发布 Pi 包）与 `claude-code`（二进制/子进程）延后。
  - Agent 工作区统一为逻辑 `/workspaces/<id>`，memory 路径投影为 `/agents/<agentId>/...`；DataApi 与 RPC 响应不再泄露宿主路径。
  - 已验证：ZIP 技能安装/读取、创建 Agent 与会话、Pi 消息与回复持久化、用量记录、工作区路径脱敏；`pnpm typecheck`、`pnpm lint`、`pnpm test`（149 文件 / 2213 用例）与 `pnpm build:web`、`pnpm build:server` 通过。
- M13 完成（小应用与浏览器）：
  - 本地小应用安装改为 `POST /api/miniapps/preview` 上传，沿用上游安装/授权/配额逻辑；运行资源经 `/api/miniapps/:appId/assets/:token/*` 的 HMAC 路径令牌提供，iframe 为 opaque origin，`window.cherry` 能力经宿主转发到 `mini_app.bridge.invoke`。
  - 站点小应用与本地小应用都改为 sandbox iframe；`MiniAppTabsPool`/webview 池退化为空实现，安装、卸载、清空数据、授权与活动记录可用。
  - `/app/browser` 改为 `IframeBrowser`，保留偏好与 `/browser-visits`；浏览器配置导入与相关入口删除。
  - Agent 浏览器由 `ServerBrowserSessionService` 提供：`playwright-core` 每 MCP 连接一个 context/page，navigate/snapshot/click/type/screenshot 等工具经 SSRF 校验后执行，并以 `browser` MCP server 挂到 Agent 运行时。
  - 部署需安装匹配 `playwright-core@1.62.1` 的 Chromium 或设置 `BROWSER_EXECUTABLE_PATH`。站点 iframe 被拒时的外部打开、AI 桥非流式、单页浏览器、更新/回滚与标注/打印等限制见 [feature-migration.md](feature-migration.md) §0.4。
  - 已验证：签名资源与子资源、bridge 存储与权限、安装/详情/卸载；Playwright E2E open/snapshot/screenshot；`pnpm typecheck`、`pnpm lint`、`pnpm test`（150 文件 / 2217 用例）与 `pnpm build` 通过。
- M14 代码工作区（已撤回）：
  - 该里程碑曾提供 `/app/code` 配置管理与服务端 PTY 终端。站点不使用 CLI，页面、`CodeCliConfigService`、`/api/terminal`、`node-pty` 依赖与 `CODE_TERMINAL_*` 开关已整体移除，服务端不再注册对应 RPC 与路由。
- 依赖版本按 cherry-studio 的 `pnpm-lock.yaml` 固定，避免 `^` 漂移导致 patch 失效与重复的 React/micromark 类型。
- M16 完成（功能扩展收口）：
  - 移除不可达的桌面路由、桌面窗口与 `<webview>` 运行时，删除 Electron 类型占位；会话右栏 webview 浏览器与 HTML artifact webview 不再挂载。
  - HTML 文件与代码块 artifact 改由 sandbox iframe 渲染：静态层无脚本，交互层为 opaque origin（`allow-scripts`、无 `allow-same-origin`）并通过 `postMessage` 回传高度/滚轮；Agent 浏览器继续使用服务端无头 Playwright 与截图返回。
  - 移除自动更新 UI、Cherry 账号/订阅/配额/CherryIN 登录与云模型选择器；账号菜单改为本地用户、通知、外观、帮助与设置，Onboarding 只保留自有供应商配置。
  - 登录页使用本地中英文字典；新增 i18n 静态键覆盖测试，校验 `en-US` 与 `zh-CN`。
  - 新增 Playwright 桌面 1440×900 与手机 390×844 主路径、`scripts/e2e-server.mjs` 临时数据目录启动脚本，以及 `docs/deployment.md`、systemd 与 Nginx 参考配置。
  - 已验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 通过。
- 渲染进程不再引用 Electron 类型。`src/renderer/types/web-globals.d.ts` 只声明 `installWebApi()` 安装的 `window.electron` 兼容对象（平台/环境探测与空操作 IPC），不包含 Electron 运行时。
- `pnpm lint` 目前只覆盖 `src/server`、`src/platform` 与脚本；`src/shared`、`src/renderer` 待 `window.api` 真实类型收敛后再纳入。
- 新标签页：浏览器没有桌面端的独立窗口标签页，URL Shell 下调用 `openTab` 只会复用当前页面。侧栏对话条目的“在新标签页打开”改为 `window.open(url, '_blank', 'noopener,noreferrer')`，桌面构建仍走应用内新标签页。浏览器里“新窗口”与“新标签页”结果相同，重复的“从新窗口打开”菜单项已移除。全局搜索与历史记录行属于“在当前页选中该会话”，继续走 `openConversation` 原地导航；只有显式的新开动作才弹新页面。
- 移动端可用性修正：
  - 软键盘：Shell 保持 `dvh` 高度，不再按 `visualViewport` 改写高度，也不再声明 `interactive-widget=resizes-content`。原先二者会把底部导航顶到键盘上方并重排整页，连输入框位于顶部的表单也跟着跳动。键盘避让只发生在对话舞台：`useKeyboardViewportInset` 给出被遮挡高度，`ComposerDockTransitionFrame` 按“舞台底部到视口底部的距离”折算后只上移 composer，且只在焦点位于 composer 内时生效——点开选择器的搜索框同样会唤起键盘，此时页面必须保持不动。聊天内容区因此仍会在键盘打开时收缩（与桌面聊天一致），其余页面布局不动。
  - 顶栏选择器层级：`ChatAppShell` 的 top bar 从 `z-10` 提到 `z-20`。选择器浮层挂载在触发器旁，若与问候层、composer 同处 `z-10`，DOM 靠后的内容会盖住浮层。
  - 消息脚注：`sm` 以下把 Token 读数折到操作图标下一行——两者并排时脚注内容宽于可用宽度，读数会被推到屏幕右缘之外。Token 详情原本只由 HoverCard 承载，触摸设备上悬停不会触发，因此按指针类型区分：细指针保持悬停预览 + 点击定位，粗指针点按后弹出详情对话框（`useCoarsePointer`）。
  - 助手/智能体编辑与新建弹窗：`sm` 以下改为贴顶全高 sheet，左侧固定宽度 tab 轨道改成可横向滚动的标签条，表单行标签列收窄；不再出现 390px 宽下内容被 144px 轨道挤掉的情况。
  - 对话控件顺序改为先模型、后助手/智能体，窄屏收成图标时模型仍紧邻输入区。
  - 历史记录：行标题改成真实链接（`<a href="/app/chat?topicId=…">`），浏览器自带的“新标签页打开”“复制链接”才有上下文；普通单击仍走应用内导航（阻止默认跳转），修饰键与非主键交还给浏览器。选中行时先关闭历史浮层再切换会话——URL Shell 下打开标签页可能复用当前页面，原先“已开标签页就提前返回”会让历史列表继续盖在对话上。顶栏在 `sm` 以下换行：搜索独占一行，来源筛选与批量操作折到第二行，不再横向溢出。
  - 暗色表面：`packages/ui` 的 dark tokens 为 macOS 透明窗口的 vibrancy 保留了 55% alpha，浏览器里会与白色画布混合成发灰的半透明面。Web 侧在 `src/renderer/assets/styles/theme-overrides.css` 覆盖为不透明等值色（须在 `tailwind.css` 之后加载；该文件不在同步区，重新同步 `packages/ui` 不会丢）。

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
POST /api/data         DataApi 信封：DataRequest -> DataResponse（主题/消息/助手/供应商等）
WS   /api/ws           事件推送与 AI 流式（event + payload；会话 Cookie + Origin 校验）
POST /api/auth/login   密码登录，写入会话 Cookie
POST /api/auth/logout  清除会话 Cookie
GET  /api/auth/status  当前会话状态
GET  /api/ui/bootstrap 登录页所需的主题模式与界面语言（公开，只读）
GET  /login            返回 SPA shell；未登录由前端渲染登录页，已登录 302 到 next
POST /api/files        附件上传（multipart，单文件）-> FileEntry 描述 + /media/:id
GET  /media/:id        文件读取（Range / ETag）
```

- TLS、压缩、请求体上限由反向代理负责。
- 数据：SQLite（drizzle schema 与 migrations 沿用上游）+ `DATA_DIR/files`。
- 传输契约沿用 `src/shared/ipc` 的 zod schema，浏览器侧只替换 `window.api.ipcApi` 的实现。
- AI 流式沿用 `AiStreamManager` 的监听器模型：新增 WebSocket 监听器，不改引擎；`ai.stream.open/attach/detach/abort` 语义保留，支持断线重连与多标签页共享。

## 3. 边界

### 首版包含

对话（流式、推理、工具调用）、助手、话题、分组、供应商与模型、联网搜索、MCP、文件上传与预览、设置、鉴权、移动端布局、翻译（文本）、定时任务（创建与调度，执行已由 M12 接通）、笔记、Agents 与技能（`pi` 运行时）、云盘备份（WebDAV/S3、自动备份、暂存恢复）。

### 首版不包含（分期）

知识库/RAG、绘画、PDF/OCR 翻译、本地模型（OVMS/ONNX/ASR/TTS）、`pi-durable` 与 `claude-code` 运行时。笔记由 M11、Agents 与技能由 M12、浏览器与小应用由 M13、云盘备份与导出由 M15 移入首版。代码工作区（CLI 配置管理与服务端终端）已撤回，不提供 CLI 能力。

页面与菜单在首版隐藏或删除，服务端不注册对应服务。首版之后的移植范围、顺序与验收标准见 [feature-migration.md](feature-migration.md)；未列入该文的桌面能力（托盘、快捷键、划词/快捷助手、截图、计算机控制、多窗口）不再移植。

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
11. **M10 共享基座与低成本功能（完成）**：工作区沙箱、密钥、站内通知、状态桥；翻译文本、定时任务。
12. **M11 笔记（完成）**：服务端内容根、树/搜索/附件、渲染层去路径化。
13. **M12 Agents 与技能（完成）**：技能库与 ZIP 上传、`pi` 运行时、会话与工作区、memory；`pi-durable`/`claude-code` 延后。
14. **M13 小应用与浏览器（完成）**：站点 iframe、本地包上传运行、服务端 Playwright 浏览器与 `browser` MCP。
15. **M14 代码工作区（已撤回）**：CLI 配置管理与服务端终端随后按站点决定整体移除，不提供 CLI 能力。
16. **M15 云盘备份与导出（完成）**：WebDAV/S3、自动备份、暂存恢复、凭据进 SecretService、服务端 Word 导出；恢复需要重启进程。
17. **M16 功能扩展收口（完成）**：桌面残留与 webview 清理、HTML sandbox 预览、Cherry 云能力移除、E2E、i18n 键覆盖、部署文档。

M10–M16 的详细范围与依赖见 [feature-migration.md](feature-migration.md)。

## 7. 风险

- main 服务的 Electron 传递依赖：以 Web 服务白名单 + 平台层最小实现控制，无法服务者注入 stub。
- 文件子系统改造面大（`window.api.file` 约 250 处）：先做同名适配层，再逐页清理。
- webview 型能力无法迁移：首版删除，后续用 sandbox iframe + 服务端代理重做。
- 单进程 SQLite 不支持多副本：部署强制单实例，备份用 SQLite backup 而非拷贝。
- 无状态会话无法逐条吊销：登出只清 Cookie，泄露的令牌在过期前仍有效；用 `SESSION_TTL_DAYS` 收敛窗口，如需即时失效则删除 `DATA_DIR/session.key`（会使全部会话失效）。
- 密码校验用 scrypt（约几十毫秒/次），登录限速 10 次 / 5 分钟；暴力破解面已很小，但仍应把服务放在反向代理之后。
- 功能扩展引入服务端执行面：Agent 运行时与服务端浏览器都意味着在宿主机执行代码或访问网络。统一走工作区沙箱、命令白名单、资源上限与默认关闭策略；凭据存服务端密钥，不进入偏好与日志。详见 [feature-migration.md](feature-migration.md) 第 6 节。
