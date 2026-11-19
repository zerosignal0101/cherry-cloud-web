# 从 Cherry Studio 桌面端改造为 Web 应用

本文记录 cherry-cloud-web 的目标形态、关键决策与实施顺序。后续实现以本文为准，变更需先改本文。

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
WS   /api/ws           事件推送与 AI 流式（event + payload）
POST /api/upload       附件上传
GET  /media/:id        文件读取（支持 Range）
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
