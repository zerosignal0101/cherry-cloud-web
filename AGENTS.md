# AGENTS.md

cherry-cloud-web 是 cherry-studio 的 Web 化分支：服务端持有数据与模型调用，浏览器只做界面。

先读 [架构说明](docs/architecture/cloud-migration.md)，它定义了边界、里程碑与上游同步范围。

## 不可违反的约束

- `src/platform/` 之外禁止 `import 'electron'`。服务端编译时 `electron` 被解析到 `src/platform/electron`（见 `tsconfig.server.json`），`@application` 指向 `src/platform/application`，因此上游 `src/main` 代码可保持原样。
- 桌面专属能力不再引入：托盘、快捷键、自动更新、多窗口、划词助手、快捷助手、截图、webview 浏览器。
- 不使用 Cherry 官方账号、订阅、支付、CherryIN 与埋点。
- 数据只存在服务端：禁止让浏览器直接读写本地文件系统；附件一律经上传接口进入 `DATA_DIR/files`，通过 `/media/:id` 读取。
- 单实例部署：不引入需要多副本一致性的方案。
- 提供商与联网搜索逻辑属于同步区，不要在此仓库内做“顺手优化”；上游问题反馈给上游，本地只做适配。

## 通信约定

- 渲染进程只通过 `window.api.ipcApi.request(route, input)` 与 `window.api.ipcApi.on(event, cb)` 访问服务端。
- 新增能力时先改 `src/shared/ipc` 的 zod schema，再实现服务端 handler，最后接页面。
- 一元调用走 HTTP，事件与流式走 WebSocket；不要为新功能另开传输方式。
- 新增 HTTP/WS 入口默认要求会话（`AuthGuard`），需要公开时在 `isPublicPath` 或路由内显式放行；跨站写入必须校验 `Origin`。

## 代码风格

- 复制自上游的代码保持原样，改写处集中在新目录或明确标注的适配文件，方便对比上游。
- UI 组件优先用 `packages/ui`；样式走 Tailwind 语义 token，不写颜色字面量。
- 日志统一走 `loggerService`，不用 `console.log`。
- 提交信息遵循 Conventional Commits，scope 用具体模块名（如 `feat(transport):`、`fix(files):`）。

## 命令

- `pnpm dev`：并行启动 Vite 与服务端（默认 5173 / 8787）。
- `pnpm build`：类型检查 + 构建 SPA。
- `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm test`。

## 上游同步

- 同步区清单与机制见架构文档第 4 节；执行 `pnpm sync:upstream --check` 查看漂移。
- 升级 `@cherrystudio/*` 依赖后必须跑 provider-registry 的 compat 校验与相关单测。
