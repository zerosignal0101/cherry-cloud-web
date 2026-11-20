# 功能扩展移植计划

本文是 [cloud-migration.md](cloud-migration.md) 的续篇，定义首版（对话、文件、设置）之后八个功能域在 Web 上的移植顺序、边界与验收标准。实现以本文为准；调整范围先改本文。

计划日期：2026-11-19。状态：**M11 已完成；M12 已完成（技能库 + Pi 运行时）；M13 已完成（小应用 + 浏览器）；M14 已完成（配置管理 + 服务端终端，终端默认关闭）**。

## 0.1 M10 已完成内容

- `WorkspaceService` + `workspace.*` RPC：`DATA_DIR/workspaces` 沙箱，支持工作区 CRUD、文件树、读写与删除；拒绝绝对路径、`..`、反斜杠、NUL 与符号链接。
- `SecretStore`：`DATA_DIR/secrets.json`，`SecretBox` 加密、0600、原子写入；只提供 `has/list` 与显式 `get`，未接任何浏览器读接口。
- `WebNotificationService`：站内通知记录 + `notification.present`/`notification.conversation` 事件；`notification.send`、`notification.activate` 已注册。
- 共享缓存桥：`cache.get_all_shared` / `cache.sync_shared` + WS `cache:sync`；标签页可实时收到 `jobs.state.*` 等共享状态，persist 层保持本地。
- 翻译文本：`translate.open` 已注册，流式结果复用 `ai.stream.*`；PDF/OCR 仍延后。
- 定时任务：`AgentJobsService`、`WebChannelManager`、`WebAgentLifecycleService` 已注册；任务创建/读取/暂停/恢复/删除可用，真实执行等待 M12。
- 导航：翻译与定时任务加入桌面侧栏与移动底栏；桌面控制探测返回空快照。
- 验证：工作区 RPC、Agent + 任务创建/列表/删除、翻译错误语义、通知发送/已读、双端导航；`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。

## 0.2 M11 已完成内容

- 笔记根改为服务端命名空间：渲染进程只见 `/notes`，服务端映射到 `DATA_DIR/notes`；`app.get_info.notesPath` 也返回该逻辑路径，不再暴露宿主目录。
- `NotesStorage` + `notes.*` RPC：校验、创建文件夹、写/读、重命名、移动、递归删除、列表、搜索；所有路径拒绝 `..`、反斜杠、NUL、越界与符号链接。
- Markdown 内容保存在 `DATA_DIR/notes`，是唯一副本；`note` 表继续保存星标/展开状态。重命名、移动、删除会同步重写或移除元数据。
- 全文搜索在服务端完成（文件名 + 内容、正则/大小写选项），浏览器不再逐文件读取。
- 笔记树/编辑器继续复用上游 `file.tree.*` 与 `file.edit.*` 原语，服务端在 `/notes` 边界做路径翻译：快照、变更事件、编辑租约、文件观察都对浏览器呈现逻辑路径。没有 ripgrep 的部署走 Node `fs` 回退扫描。
- 桌面目录选择已移除；粘贴图片写入 `/media/<id>`，导入 Markdown 中的旧 `file://.../files/<id>` 链接在 `notes.write` 时重写。
- 浏览器传输新增二进制编解码（`Uint8Array` 以 base64 标记跨 HTTP/WS），修复编辑器读写字节与截图类事件在 JSON 传输中的退化。
- 标签页 WebSocket 断开不再立即等同窗口销毁：服务端保留 15 秒重连宽限，避免刷新页面后文件编辑租约被永久关闭。
- 验证：创建/编辑/自动保存/刷新后保留、重命名、删除、搜索、附件图片、双端页面与无控制台错误；`pnpm typecheck`、`pnpm lint`、`pnpm test`（148 文件 / 2211 用例）通过。

## 0.3 M12 已完成内容

- 技能库根为 `DATA_DIR/Skills`（`pathRegistry` 的 `feature.agents.skills`）；`SkillStorage` 在 `/skills` 逻辑根与物理目录之间做双向翻译，浏览器只看到逻辑路径。
- `skill.*` Web 子集已注册：目录、启用/停用、卸载、reconcile、市场读取可用；`skill.install_from_directory`、`skill.import_system` 明确拒绝，`skill.discover_system` 返回空集。
- ZIP 安装改为浏览器上传 `POST /api/skills/install`（20 MB 上限，multipart）：服务端暂存到 `DATA_DIR/tmp`、走同一个 `SkillService.installFromZip`，无论成败都清理暂存；来源记录为内容哈希 `zip://sha256/<hash>`，重复上传同一压缩包可替换同一技能。
- `skill.folder.open` 删除；`skill.folder.resolve` 返回 `/skills/<folderName>`，内置技能为只读。技能 RPC 响应中的 `file:` 来源统一清空，避免把宿主暂存路径带回浏览器。
- 导入对话框只接受浏览器 `File`（选择或拖放 `.zip`），目录安装与 `getPathForFile` 已从该流程移除。
- 注册 `AgentSessionRuntimeService`、`AgentLifecycleService`、`AgentSessionDeliveryService`、`AgentImportService`、`AgentJobsService`，以及 `ApiGatewayService` 与 `TraceStorageService`；`WebContentsLike` 支持 `once`/`on`/`removeListener('destroyed')`，warm lease 以标签页 client id 管理。
- Web 运行时为 `pi`；新 Agent 创建向导默认 `pi`。`pi-durable` 依赖尚未发布的 Pi 包（query-fork/context-usage），`claude-code` 依赖二进制与子进程策略，均延后。
- 固定版本 `@earendil-works/pi-ai@1.5.2` 不认识上游的 `objectTransports`，Pi 模型绑定改走内部回环 API Gateway（`resolveApiGatewayRuntime` + `x-cherry-agent-session-id`），保留用量归属；`pnpm build` 与流式调用均已验证。
- Agent 工作区统一到 `WorkspaceService`：`ai.agent.workspace.register` 只接受 `/workspaces/<id>`，DataApi 响应把物理工作区前缀改写为逻辑路径；新建工作区先 `workspace.create` 再注册，不再弹宿主目录选择器。`AgentWorkspaceNamespace` 再把 `/workspaces/<id>` 接到对应工作区行，`file.tree.*` / `file.edit.*` / `file.observe.*` 可浏览系统与用户工作区。
- `agent.memory.*` 注册；memory 路径投影为 `/agents/<agentId>/...`，`open_folder` 明确拒绝。会话、消息、投影继续使用现有表。
- 技能与 Agent 运行时的服务端探针验证：ZIP 安装/目录读取、创建 Agent 与会话、发送消息、Pi 调用模型并持久化回复、用量记录、工作区路径脱敏。
- 明确延后：Claude Code 二进制下载、频道（Telegram/Slack 等）、Doctor/系统诊断、计算机控制。


## 0.4 M13 已完成内容

- 小应用运行时改为 Web 子类：`WebMiniAppRuntimeService` 继承上游安装/授权/配额逻辑，只跳过桌面分区、内置包扫描与 `webContents` 可见性判断；包目录、数据目录、快照与发布日志都落在 `DATA_DIR/miniapps`。
- 本地包安装改为浏览器上传：`POST /api/miniapps/preview` 接收 multipart 并暂存到 `DATA_DIR/tmp`，以 `x-client-id` 作为所有者调用上游 `previewFileForInstall`，确认/取消/应用后清理暂存；桌面文件选择、宿主路径与内置包安装 RPC 明确拒绝。
- 本地小应用运行在 opaque origin 的 sandbox iframe（`sandbox="allow-scripts"`）。静态资源走 `/api/miniapps/:appId/assets/:token/*`：HMAC 令牌放在路径段中，使 HTML 内的相对 CSS/JS/图片请求自动继承令牌；服务端校验安装状态、令牌、realpath 包含并拒绝 `__cherry`，响应带严格 CSP 与 `no-store`。
- 资源响应中的 `cherry-miniapp://<id>/<entry>` 在 DataApi 响应与安装结果里统一改写为签名 HTTP URL；HTML 入口注入 bridge 脚本。
- `window.cherry` 能力桥经宿主 `postMessage` 转发到已鉴权的 `mini_app.bridge.invoke` RPC：`storage`（`DATA_DIR/miniapps/data/<appId>`）、`file`、`ai.chat`、`notification`、`clipboard`、`network.fetch` 与 `file.export`。宿主只处理 `kind === 'app'` 的应用、校验 `event.source` 与 appId，站点小应用不能冒充本地应用；导出由宿主触发浏览器下载。
- 安装、卸载、清空数据、授权/撤销、详情与活动记录继续复用上游 RPC；`MiniAppPane` 直接渲染 iframe，工具栏提供地址、刷新、外部打开、分屏、置顶、详情与重启；`MiniAppTabsPool` 与 webview 池退化为空实现。
- 站点小应用保留 DataApi 与页面入口；拒绝被嵌入的站点显示超时提示与“外部打开”，不尝试绕过 `X-Frame-Options`/CSP。
- 独立浏览器 `/app/browser` 改为 `IframeBrowser`：保留起始页/上次地址、刷新、外部打开与 `/browser-visits` 历史；`file:` 地址拒绝。浏览器设置删除配置导入（cookie 解密不可移植），相关入口与横幅一并移除。
- Agent 浏览器改为服务端 `ServerBrowserSessionService`：`playwright-core` 按 MCP 连接创建 context/page，提供 navigate、snapshot、screenshot、click、hover、type、press_key、scroll、select_option、history、wait_for、find、execute、console/network/dialog 等工具；每个请求先经过 SSRF 校验（仅 http/https、拒绝凭据、回环/私网/链路本地/元数据地址，并缓存 DNS 判定）。
- 浏览器工具以 `browser` MCP server 挂到 Agent 运行时，与 automation 并列；`mcp__browser__*` 走既有工具策略。`browser.*` 的 Web 子集保留历史写入与清空，pane/cursor/input 路由降级为空操作，导入类 RPC 明确拒绝；服务端路径不依赖 Electron webview/CDP。
- `playwright-core` 固定为 `1.62.1`。部署需安装与该版本匹配的 Chromium，或用 `BROWSER_EXECUTABLE_PATH` 指向现有浏览器；容器内无沙箱时设置 `BROWSER_NO_SANDBOX=1`。
- 验证：签名资源、CSS/JS 子资源、bridge storage 读写与权限拒绝、安装/详情/卸载；Playwright E2E 在真实 Chrome 下完成 open/snapshot/screenshot；`pnpm typecheck`、`pnpm lint`、`pnpm test`（150 文件 / 2217 用例，1 个 E2E 默认跳过）与 `pnpm build` 通过。

**M13 明确延后/限制**

- 站点是否允许 iframe 由对方决定；被拒绝时只能新标签页打开，不做代理改写。
- `cherry.ai.chat` 只返回最终文本，不提供流式增量；浏览器运行时每个连接单页，无多标签/持久化登录态，也没有可视化实时画面（截图按工具调用返回）。
- 小应用更新/回滚、内置包、应用市场 URL 安装与分屏池保活不在本阶段；本地包数据在卸载时按上游语义清理。
- 标注导出、打印/保存 HTML，以及 HTML 文件预览、代码块 HTML artifact 预览的 `<webview>` 迁移原计划留给 M16；M16 已用 sandbox iframe 替换预览并移除 webview 标注，Agent 浏览器继续以服务端工具调用与截图返回作为可用路径。

## 0.5 M14 已撤回（代码工作区与服务端终端）

- 站点不使用 CLI：`/app/code` 页面、`CodeCliConfigService`、`code_cli.*` RPC、`/api/terminal` WebSocket、`node-pty` 依赖与全部 `CODE_TERMINAL_*` 开关已移除；服务端启动时不再创建 `code-cli` 默认工作区。
- 保留与 CLI 无关的共用能力：`BinaryManager`（PDF 翻译与技能安装所需的 mise 托管工具）与 `feature.binary.*` 偏好；设置页不再提供依赖项管理入口。

## 0.7 M16 已完成内容（功能扩展收口）

- 桌面残留清理：
  - 删除不可达的桌面设置路由与页面：`api-gateway`、`channels`、`computer-use`、`dependencies`、`device-connections`、`local-models`、`profile`、`subscription`、`voice`、`quick-assistant`、`screenshot`、`selection-assistant`、`shortcut`、`mcp/mcp-install`、`mcp/npx-search`。
  - 删除首版范围外的应用路由：`knowledge`、`paintings`、`launchpad`、`release-notes`。
  - 删除桌面窗口入口：快捷助手、截图、划词助手、子窗口、数据目录迁移、旧版升级；仅保留 `windows/main`、`windows/login` 与 `prepareWindow`。
  - 移除 `<webview>` 运行时与 Electron 类型占位：`WebviewBrowser`、`WebviewHost`、`WebviewNavigation`、`WebviewSearch`、`WebviewAnnotationControls`、`AgentBrowserRuntimeHost`、`WebviewRuntimeService`、`AgentBrowserRuntimeService`、MiniApp webview 池与调试指示器。`src/renderer/types/electron-shim.d.ts` 已删除。
  - 会话右侧的 Agent 浏览器 tab 与 HTML artifact 专用 webview 移除；Agent 浏览器继续以服务端无头 Playwright 的工具调用与截图返回为可用路径，站点浏览保留 `/app/browser` 的 sandbox iframe。
  - 同步收紧 `NavigateTool` 与 `isKnownNavigationPath` 的路由白名单，桌面专属设置页不再被 Agent 或 Markdown 链接打开；Doctor 的深层链接同步去掉已删除的依赖设置。
  - 修复 `react-spinners` 子路径默认导入在构建后变成模块对象导致小应用页崩溃的问题，统一改为命名导入。
- HTML 预览迁移：
  - HTML 文件与代码块 artifact 的静态预览继续使用无脚本 iframe；交互式 artifact 改为 opaque-origin sandbox iframe（`allow-scripts`，不含 `allow-same-origin`），通过注入的 `postMessage` 桥接高度与滚轮事件，脚本无法访问宿主 `window.api`。
  - 打开本地 HTML artifact 不再依赖 `file://` webview；内容经 `fs.readText` 读取后以 `srcdoc` 渲染。相对路径的本地资源不可解析属于当前限制。
- 账号与更新边界：
  - 移除自动更新 UI、更新通知、更新对话框与升级说明；删除 Cherry 账号、订阅、配额、CherryIN 登录入口、订阅角标与云模型选择器。账号菜单改为本地用户名、通知、外观、帮助与设置。
  - Onboarding 只保留“配置自己的供应商”路径；登录页使用本地中英文字典，不依赖尚未登录可用的 i18n 资源。
- i18n：
  - 新增 `src/shared/__tests__/rendererI18n.test.ts`，扫描浏览器源码中的静态 `t('…')` 键，校验 `en-US` 与 `zh-CN` 存在对应键（含 i18next 复数后缀）。
  - 补齐 6 个缺失键；其他 16 种语言继续按需加载并以 `en-US` 回退。
- E2E 与文档：
  - 新增根 `playwright.config.ts`、`e2e/smoke.spec.ts` 与 `scripts/e2e-server.mjs`；桌面 1440×900 覆盖登录、对话壳、数据设置、笔记与横向溢出，手机 390×844 覆盖底部导航、设置、对话壳与横向溢出。`pnpm test:e2e` 先构建再用临时 `DATA_DIR` 启动。
  - 新增 `docs/deployment.md`、`deploy/systemd/cherry-cloud-web.service`、`deploy/nginx/cherry-cloud-web.conf`；README 更新部署、测试与备份摘要。

**M16 明确限制**

- 交互式 HTML artifact 的本地相对资源（同目录 CSS/JS/图片）不会加载；内联内容、绝对 URL 与 data URL 可用。
- 打印/保存 HTML 交给浏览器原生能力；webview 标注导出随 webview 移除，不再提供。
- 站点 iframe 仍由对方的 `X-Frame-Options`/`frame-ancestors` 决定，被拒绝时只能新标签页打开。
- 新增文案只保证 `en-US`/`zh-CN`；其余语言缺失键回退英文。

## 0. 目标与原则

把下列桌面能力移植为服务端执行、浏览器展示的功能：

| 功能域 | 目标形态 |
| --- | --- |
| Agents 与技能 | 服务端 Agent 运行时、会话/工作区、技能库与安装 |
| 代码工作区 | 已撤回：站点不提供 CLI 能力 |
| 浏览器 | 站点浏览（iframe）与服务端 Agent 浏览器运行时 |
| 小应用 | 站点小应用 + 上传安装的本地小应用，运行在 sandbox iframe |
| 笔记 | 服务端笔记内容存储、树、搜索、附件 |
| 翻译 | 文本流式翻译；文件/PDF 翻译分期 |
| 定时任务 | 服务端调度、任务执行、站内通知 |
| 云盘备份 | 服务端备份到 WebDAV/S3，恢复与自动备份 |

原则：

1. **服务端持有执行与数据。** 浏览器不读写宿主机路径，不拉起本地进程；文件一律经 `POST /api/files` 或功能域上传接口进入 `DATA_DIR`，经 `/media/:id` 或功能域只读路由读取。
2. **垂直切片。** 每个功能域先交付“可完整操作的一条主路径”，再补边缘能力；不以页面能打开作为完成标准。
3. **不复活桌面运行路径。** `<webview>`、Electron `session.fromPartition`、`webContents.debugger`、`safeStorage`、外部终端启动、二进制自动下载都不进入 Web 实现。
4. **复用上游数据层与契约。** 能通过 `POST /api/data` 复用的 handler 直接复用；新增 RPC 先改 `src/shared/ipc/schemas`，再实现服务端 handler，最后接页面。
5. **单实例。** 定时任务、备份、浏览器运行时都是进程内单例；不引入队列中间件或多副本协调。
6. **同步区不动。** 供应商与联网搜索继续按上游同步；新功能代码放在 `src/server/features/`、`src/server/*` 与明确的渲染适配层。

## 1. 现状矩阵

| 功能域 | 页面/路由 | 当前服务端状态 | 主要阻塞 | 结论 |
| --- | --- | --- | --- | --- |
| Agents 与技能 | `/app/agents`、`/settings/skills/*` | Agent 运行时与技能库已接入；`pi` 会话/流式/工作区可用 | `pi-durable` 与 Claude Code 延后（依赖未发布包/二进制） | 已完成（见 §0.3） |
| 代码工作区 | `/app/code`、`/settings/code-execution` | 不再提供：页面、配置服务与终端整体移除 | — | **已撤回（M14，见 §0.5）** |
| 浏览器 | `/app/browser`、`/settings/browser` | 站点 iframe + `/browser-visits`；服务端 Playwright 浏览器与 `browser` MCP 已接入；导入删除 | 站点可能拒绝 iframe；无多标签/可视化实时画面 | **已完成（M13，见 §0.4）** |
| 小应用 | `/app/mini-app/*` | 站点/本地小应用均走 sandbox iframe；包上传、签名资源、能力桥、安装/卸载/授权可用 | 更新/回滚、内置包、市场安装延后 | **已完成（M13，见 §0.4）** |
| 笔记 | `/app/notes` | `notes.*` 已注册；内容在 `DATA_DIR/notes`，树/编辑经 `/notes` 路径翻译 | 无 | **已完成（M11）** |
| 翻译 | `/app/translate` | 历史/语言/偏好走 DataApi 与 preference；`translate.open` 未注册 | 文件读取依赖本地路径；PDF 依赖 BabelDOC | 文本翻译优先，文件/PDF 延后 |
| 定时任务 | `/app/scheduled-tasks` | 读接口可用；`SchedulerService`/`JobManager` 已在生命周期 | `AgentJobsService`、`NotificationService`、`ChannelManager` 未注册 | 中小工作量，优先 |
| 云盘备份 | `/settings/data` | WebDAV/S3 手动与自动备份、列表/删除、暂存恢复、进度事件；凭据在 SecretService；Word 导出服务端生成 | 恢复需重启进程；备份文件含加密凭据 | **已完成（M15，见 §3.8）** |

## 2. 共享基座（M10）

后续功能共用以下服务，先于功能域落地：

### 2.1 工作区沙箱 `WorkspaceService`

- 位置：`src/server/features/workspace/`。
- 根目录：`DATA_DIR/workspaces/<workspaceId>`；Agent 工作区与技能文件浏览共用同一套解析。
- 能力：`list/stat/read/write/mkdir/move/delete`，路径规范化、realpath 包含校验、大小与条目数上限、禁止跟随符号链接。
- 契约：新增 `workspace.*` IpcApi schema；不使用浏览器传入的任意绝对路径。
- 现有 `feature.notes.path`、`sys.home`、`~/.claude` 等桌面路径假设一律替换为工作区 id。

### 2.2 上传与媒体

- 单文件继续走 `POST /api/files`。
- 功能域包（技能 zip、小应用包）新增专用 multipart 接口，复用 `@fastify/multipart` 与 `DATA_DIR` 存储，但保留独立的校验与配额：
  - 包大小、解压后大小、条目数、符号链接、zip-slip；
  - 只允许清单声明的文件类型；
  - 上传成功后写入功能域表并返回 id，不返回宿主机路径。

### 2.3 密钥与凭据

- 备份、WebDAV/S3、频道等新凭据不得明文经过 `preference`。
- 复用服务端已有密钥加密能力（`DATA_DIR` 下的密钥文件），新增 `SecretService`：写入、读取（仅服务端）、掩码读取（渲染进程）。
- 渲染进程只能拿到 `hasSecret`/掩码，不能回读明文。

### 2.4 站内通知 `WebNotificationService`

- 替代桌面 `NotificationService`：写入通知表 + `notification.*` WS 事件，不调用系统通知。
- 供定时任务、自动备份、Agent 任务使用。
- 渲染进程复用现有通知中心；浏览器 Notification API 仅在用户授权后作为可选增强。

### 2.5 运行状态桥

- 长时间运行的服务（Agent 运行时、浏览器运行时、备份）通过 WS 事件推送状态，不再依赖 `CacheService.getAllShared` 的桌面桥。
- 统一定义 `runtime.status.changed` 事件（`feature`、`status`、`detail`）。

### 2.6 安全边界

- 所有文件系统操作限定在 `DATA_DIR`；符号链接、`..`、绝对路径注入均拒绝。
- 子进程仅允许白名单可执行文件，工作目录必须是工作区；资源与超时上限。
- 服务端发起的网络请求（小应用能力、技能市场、浏览器）必须做目标校验，防止 SSRF。

## 3. 功能域方案

### 3.1 翻译（M10）

范围：

- 注册 `translate.open`，复用 `AiStreamManager` 的 `ai.stream.*` 推送，文本翻译可用。
- 语言识别走已注册的 `ai.text.generate`；历史、收藏、自定义语言继续走 DataApi。
- 文件翻译改为浏览器选择 `File` → `POST /api/files` → 服务端读取 `FileEntry`；只支持纯文本/Markdown 的第一版。
- PDF/OCR/BabelDOC、`pdfjs.resource.read`、`file_processing.*` 延后。

改动点：

- `src/server/ai/routes.ts` 注册 `translateRequestSchemas`（仅 `translate.open`）。
- `src/main/ipc/handlers/translate.ts` 的 sender 解析走 Web `WindowManager` 适配。
- `src/renderer/pages/translate/TranslatePage.tsx`、`translationFiles.ts` 去掉 `readExternal`/`getPathForFile`。
- `src/renderer/hooks/translate/*` 保持现有调用。

验收：粘贴文本可选择语言并流式输出；历史写入数据库；上传文本文件可翻译；无本地路径调用。

### 3.2 定时任务（M10）

范围：

- 实现 `WebNotificationService`。
- 注册 `AgentJobsService`（`agent.task` handler）与 `NotificationService` 名称映射。
- `runAgentTask` 对 `ChannelManager` 的解析改成可选：无频道时跳过，不阻塞任务。
- `SchedulerService`/`JobManager` 已在生命周期，验证服务重启后 `job_schedule` 能重新装载。

改动点：

- `src/server/ai/runtime.ts` 服务列表。
- `src/server/ai/webServices.ts` 新增通知实现。
- `src/main/ai/agents/AgentJobsService.ts`、`runAgentTask.ts` 的最小适配（保持上游逻辑）。

验收：创建/暂停/恢复/立即运行/删除任务；运行历史与通知可读；重启服务后计划仍在；无 `ChannelManager` 时不报错。依赖 Agent 运行时才能真实执行任务的，可与 M12 联动验收。

### 3.3 笔记（M11，已完成）

实现：

- 逻辑根固定为 `/notes`，映射到 `DATA_DIR/notes`。Markdown 文件是服务端唯一副本；`note` 表继续保存 `isStarred` / `isExpanded`，不新增内容表。
- `notes.*` RPC 覆盖路径校验、创建目录、写入、读取、重命名、移动、递归删除、列表与全文搜索；拒绝绝对路径、`..`、反斜杠、NUL、越界 realpath 与符号链接组件。
- 现有渲染层的树与编辑器仍使用 `file.tree.*` / `file.edit.*`；服务端在 `/notes` 边界翻译快照、变更事件、编辑租约与文件观察路径，浏览器始终只看到逻辑路径。
- 搜索由服务端扫描并返回匹配行、上下文、评分；浏览器不再逐个文件调用 `readExternal`。
- 笔记设置移除了宿主目录选择；旧桌面路径会在加载时回退到 `/notes`。导入 Markdown 的旧 `file://.../files/<id>` 图片链接在写入时改写为 `/media/<id>`；新粘贴图片直接写 `/media/<id>`。
- `MutationObserver`/watcher 仍由上游 `DirectoryTreeBuilder` 提供；缺少 ripgrep 的部署使用 Node `fs` 回退扫描。
- 延后：Obsidian 仓库发现、Word/PDF/打印导出。

验收（已完成）：新建、编辑、自动保存、刷新后内容保留、重命名、移动、删除、搜索、星标、图片显示；浏览器不发送任何宿主路径。

### 3.4 Agents 与技能（M12）

分两步，先技能后运行时。

**技能库**

- 注册 `skillRequestSchemas` 的 Web 子集：列表、详情、启用/停用、安装、卸载、reconcile、目录/市场读取。
- `SkillService` 以 `DATA_DIR/skills` 为库根；镜像目录同样落在 `DATA_DIR`，不写用户 home。
- `skill.install_from_zip` 改为包上传；`install_from_directory` 删除；`folder.open`/`folder.resolve` 改为工作区只读列表或删除。
- `skill.list_catalog` 的服务端数据源接通；渲染进程技能列表改用 DataApi `/skills` 或已注册的 RPC。
- 内置技能随构建产物放入服务端资源目录，并在 Web seeder 中按需登记。

**Agent 运行时**

- 选择 `pi`/`pi-durable` 作为 Web 运行时；`claude-code` 类型延后（需要服务端二进制与子进程策略，另行决策）。
- 注册 `AgentSessionRuntimeService`、`AgentLifecycleService`、`AgentSessionDeliveryService`、`AgentImportService`、`AgentJobsService`。
- 适配 `WebContentsLike`：把 `once('destroyed')`/`removeListener` 映射为连接关闭事件；warm lease 以 client id 管理。
- 解耦 `GET /agent-sessions/:id/messages` 对 `getHistoryActions` 的硬依赖：运行时未启用时返回空动作。
- 注册 `agent.*`（memory/avatar）路由；`open_folder` 删除或改为工作区下载。
- Agent 工作区统一到 `WorkspaceService`；会话、消息、投影继续使用现有表。
- 定时任务复用 M10 的 `AgentJobsService`。

验收：创建 Agent、创建会话、发送消息、流式输出、停止、重试、fork；技能可安装/启用并被运行时发现；会话历史可读；服务重启后会话与工作区仍可用。

**明确延后**：Claude Code 二进制下载、频道（Telegram/Slack 等）、Doctor/系统诊断、计算机控制。

**实现说明（已完成）**

- 技能根使用 `DATA_DIR/Skills`（上游 `feature.agents.skills` 的既有映射），不是新建的 `DATA_DIR/skills`。
- 技能 ZIP 上传走 `POST /api/skills/install`；`skill.install_from_zip` 不再接受宿主路径。`folder.resolve` 返回逻辑 `/skills/<folderName>`，`folder.open` 删除。
- Pi 运行时已经可用；`pi-durable` 依赖尚未发布的 Pi 包（query-fork/context-usage），`claude-code` 依赖服务端二进制与子进程策略，二者不在本次范围。
- 固定版本 Pi SDK 不支持上游的 `objectTransports`，因此 Web 构建通过 `ApiGatewayService.ensureInternalGateway()` 暴露的回环地址转发模型请求，并附带 `x-cherry-agent-session-id` 记录会话用量。
- Agent 工作区路径统一为 `/workspaces/<id>`；`ai.agent.workspace.register` 只接受该形式，DataApi 响应会把物理前缀改写为逻辑路径。Agent memory 路径对应 `/agents/<agentId>/...`。

### 3.5 小应用（M13）

第一阶段：站点小应用。

- DataApi `/mini-apps` 继续使用。
- `<webview>` 替换为 sandbox iframe（`allow-scripts`、独立 origin 或严格 CSP）；用 `postMessage` 实现 `MiniAppBridge`，校验 `origin`/`source`。
- 对拒绝被 iframe 嵌入的站点，第一版给出明确提示或改用新标签页打开，不承诺绕过限制。

第二阶段：本地包小应用。

- `POST /api/miniapps` 上传包；服务端复用 `install/archive.ts` 的校验逻辑解压到 `DATA_DIR/miniapps/<appId>`。
- 静态资源经鉴权路由 `/api/miniapps/:appId/assets/*` 提供；realpath 包含、CSP、禁止目录浏览。
- 能力映射：
  - `cherry.storage` → 服务端存储表/工作区；
  - `cherry.file` → `FileManager` + `/media/:id`；
  - `cherry.network.fetch` → 服务端代理（manifest host allowlist + SSRF 校验）；
  - `cherry.ai.chat` → 现有 AI 运行时；
  - `notification`/`clipboard` → 浏览器 API（需用户手势/授权）；
  - `file.export` → 浏览器下载。
- 安装、卸载、清空数据、授权、活动记录注册 RPC；更新/回滚、内置包、分屏池延后。

验收：安装上传的包、启动、读写存储、调用 AI、卸载；站点小应用可添加并在 iframe 中打开；无 `<webview>` 依赖。

**实现说明（已完成）**：包上传走 `POST /api/miniapps/preview`，运行资源走带 HMAC 路径令牌的只读路由；iframe 为 opaque origin，能力统一经宿主 RPC 转发。实现细节与限制见 §0.4。`window.cherry` 目前提供 storage/file/ai.chat/notification/clipboard/network.fetch/file.export，AI 调用返回最终文本而非流。

### 3.6 浏览器（M13）

第一阶段：

- 保留浏览器偏好与 `/browser-visits` 历史。
- `/app/browser` 改为新标签页打开或可嵌入站点的 sandbox iframe；删除浏览器配置导入（本地 cookie 解密不可移植）。
- `webview.*`、标注导出、打印/保存 HTML 延后。

第二阶段：Agent 浏览器。

- 新增服务端 `BrowserRuntimeService`：Playwright/Chromium，按会话隔离上下文，提供 navigate/snapshot/click/type/screenshot 工具与 MCP 端点。
- 画面通过截图流或受控预览路由提供；所有操作经会话鉴权与目标域名策略。
- 替换 `WebBrowserSessionService` 空桩；`browser.*` 中仅保留运行时需要的子集。
- 资源上限、并发上限、空闲回收；单实例部署下按会话排队。

验收：Agent 可打开页面、读取可访问性快照、点击/输入、截图；浏览器设置与历史可用；服务端无 Electron webview/CDP 依赖。

**实现说明（已完成）**：站点浏览用 sandbox iframe；Agent 浏览器用 `playwright-core`，每个 MCP 连接一个 context/page，所有请求经过 SSRF 校验，工具以 `browser` MCP server 挂载。浏览器配置导入已删除，标注/打印/实时可视化画面延后。实现细节与部署要求见 §0.4。

### 3.7 代码工作区（M14，已撤回）

- 站点不使用 CLI，`/app/code`、CLI 配置读写、服务端终端与本节的验收项整体取消；实现细节见 §0.5。
- 与 CLI 无关的 mise 托管工具安装（`BinaryManager`）保留，供 PDF 翻译与技能安装使用。

### 3.8 云盘备份与导出（M15）

第一阶段：手动备份/恢复（WebDAV）。

- 新增 `backup.*` IpcApi schema 与 handler（替换旧 `ipcMain` 通道）：备份、列出、删除、恢复、连接检查、进度事件。
- 备份内容改为服务端 `DATA_DIR`：SQLite（使用 SQLite backup API，不拷贝 WAL 文件）+ `files/` + 必要元数据；不打包浏览器 IndexedDB/LocalStorage。
- 恢复前暂停 `JobManager`/Agent 运行时写入，写恢复日志，恢复后重启进程或重新打开数据库；不做桌面式 `app.relaunch`。
- 凭据存 `SecretService`，界面只显示掩码。
- `AutoBackupService` 注册到生命周期，自动备份复用 `SchedulerService`；`backup.get_auto_sync_state` 由真实状态替换。

第二阶段：S3。

- 补齐 `@aws-sdk/client-s3`、`@aws-sdk/lib-storage` 依赖并锁定版本。
- 复用同一备份/恢复流程；分片上传与重试。

延后/删除：本地目录备份（改为服务端导出目录或隐藏）、坚果云 SSO、Obsidian 仓库、数据重置（后续做管理员端点）。

导出：Markdown/图片继续浏览器下载；Word 导出改为服务端生成后下载，Obsidian 导出删除。

验收：手动备份到 WebDAV、列表、删除、恢复；自动备份按计划运行并有站内通知；S3 在第二阶段完成；恢复过程有明确停机/重启说明。

**实现说明（已完成）**：
- 服务端新增 `src/server/features/backup/`：SQLite 用 `VACUUM INTO` 生成一致性快照，连同 `DATA_DIR` 中的 `files/`、`notes/`、`Skills/`、`workspaces/`、`miniapps/`、`Agents/`、`provider-registry/` 及 `auth.json`、`cache.json`、`secrets.json`、密钥文件打包；日志与 `tmp/` 不入包，符号链接不跟随。备份前暂停 Agent/Job/流式写入并等待 drain。
- `backup.*` 路由覆盖 WebDAV 与 S3（`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`）：连接检查、备份、列表、删除、恢复与进度事件。凭据写入 `SecretService`；旧版偏好中的明文会在启动时迁移并清空，界面只显示“已保存/清除”，不回读明文。
- 恢复只做校验与暂存（zip-slip/折叠路径/大小上限、SQLite 校验和与迁移链），写入 `restore-journal.json` 后在下次启动、数据库打开前由 `promotePendingRestore` 原子换入；旧数据保留在 `restore-aside/<id>/` 便于人工回滚。页面明确提示需要重启服务。
- `AutoBackupScheduler` 复用 `SchedulerService`，支持 WebDAV/S3 自动备份、失败状态、手动完成重置计时与站内通知。
- 本地目录备份、坚果云 SSO、Obsidian 设置与导出入口已从页面隐藏；Word 导出改走 `export.word.download`，由服务端生成 `.docx` 后浏览器下载。
- 已知边界：备份包含加密凭据文件，必须按敏感数据保管；备份也包含 `auth.json`，恢复后登录密码会回到备份时状态。使用 `APP_SECRET` 部署时，恢复端需使用同一密钥才能解开 `secrets.json`。恢复失败会保留日志/暂存目录供排查，手工删除 `restore-journal.json` 前应先确认。

## 4. 里程碑

| 里程碑 | 范围 | 依赖 | 退出标准 |
| --- | --- | --- | --- |
| M10 共享基座与低成本功能 | Workspace/Secret/Notification/状态桥；翻译文本；定时任务 | 无 | 三项功能可用，共享服务有单测 | **完成** |
| M11 笔记 | 内容模型、API、渲染迁移、搜索、附件 | M10 工作区/上传 | 笔记主路径完整，无本地路径 | **完成** |
| M12 Agents 与技能 | 技能库、Pi 运行时、会话/工作区、内存 | M10 | Agent 对话与技能端到端 |
| M13 小应用与浏览器 | 站点 iframe、包上传/运行、服务端浏览器 | M10、M12（AI/文件/工作区） | 小应用安装运行；Agent 浏览器工具可用 | **完成** |
| M14 代码工作区 | CLI 配置管理；服务端终端 | M10 工作区 | 站点不使用 CLI，整体撤回 | **已撤回** |
| M15 云盘备份与导出 | WebDAV/S3、自动备份、恢复、导出 | M10 Secret/Notification | 备份恢复演练通过 | **完成** |
| M16 功能扩展收口 | E2E、i18n、文档、桌面残留清理 | 全部 | 类型检查、lint、单测、构建与 Playwright 双端主路径通过 | **完成** |

建议插入顺序：M10 → M11 → M12 → M13 → M15 → M16（M14 已撤回）。

## 5. 测试与验收

每个功能域至少包含：

- 服务端单测：路径沙箱（`..`、符号链接、绝对路径）、配额、权限、状态机。
- HTTP/RPC 集成测试：鉴权、Origin、`ROUTE_NOT_FOUND` 不出现、错误为领域错误。
- 浏览器 E2E（Playwright）：桌面 1440×900 与手机 390×844 各一条主路径。
- 安全用例：zip-slip、SSRF、iframe 逃逸、备份恢复路径穿越、密钥不落日志。
- 回归：现有 143 个测试文件保持通过；新增功能按目录补测试。

## 6. 风险与决策

1. **服务端执行是最大风险。** Agent 运行时、终端、浏览器都意味着在服务器上执行代码或访问网络。第一版限定单用户、工作区沙箱、命令白名单；终端默认关闭；容器化部署作为推荐方案。
2. **小应用隔离弱于 Electron。** iframe 无法复制 `persist:` 分区、PAC、WebRTC 策略。服务端必须承担路径、CSP、网络与配额校验；不依赖渲染进程自检。
3. **站点拒绝 iframe。** 不尝试绕过 `X-Frame-Options`/`frame-ancestors`；以提示或新标签页降级。
4. **备份恢复需要停机。** 单实例 SQLite 下恢复必须暂停写入；文档写清维护窗口与回滚方式。
5. **上游同步边界。** 功能域适配集中在新目录；修改上游文件时保持最小 diff 并注释原因，避免阻塞后续同步。
6. **凭据。** 新凭据必须走 `SecretService`，不得写入偏好或日志；备份文件本身也要视为敏感数据。
7. **资源上限。** Playwright、终端、包解压、备份并发都要有上限与超时，防止单用户部署被自身任务拖垮。

## 7. 明确不做

- 计算机控制（computer use）、截图/划词/快捷助手、系统托盘与快捷键。
- 桌面浏览器配置导入与 cookie 解密。
- 坚果云 SSO、Obsidian 仓库发现。
- Claude Code 二进制自动下载与外部终端启动（除非单独批准服务端二进制策略）。
- 多副本、多租户与跨用户权限模型。
