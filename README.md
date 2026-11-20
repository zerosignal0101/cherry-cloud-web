# cherry-cloud-web

Cherry Studio 的自托管 Web 版：数据与模型调用在服务端，浏览器只做界面，单一使用者，公网访问。

- 架构与里程碑：[docs/architecture/cloud-migration.md](docs/architecture/cloud-migration.md)
- 功能域移植记录：[docs/architecture/feature-migration.md](docs/architecture/feature-migration.md)
- 部署与运维：[docs/deployment.md](docs/deployment.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 开发

```bash
pnpm install
ADMIN_PASSWORD=<至少8位> pnpm dev   # Vite :5173 + API :8787
pnpm build        # 类型检查 + dist/web + dist/server
pnpm typecheck
pnpm lint
pnpm test          # 服务端/shared 单测与 i18n 键覆盖
pnpm test:e2e      # 构建后运行桌面与手机 Playwright 主路径
```

首次启动会用 `ADMIN_PASSWORD` 生成 `DATA_DIR/auth.json`，之后该变量不再生效；忘记密码时删除该文件重设。

环境变量见 `.env.example`，部署细节见 [docs/deployment.md](docs/deployment.md)。

## 部署摘要

单 Node 进程（systemd），由反向代理终止 TLS 并转发 `/`、`/api`、`/media`，以及 `/api/ws` 的 WebSocket 升级。参考文件：

- `deploy/systemd/cherry-cloud-web.service`
- `deploy/nginx/cherry-cloud-web.conf`

本部署不提供 CLI 与服务端终端，浏览器只负责界面，数据与模型调用都在服务端。

Agent 浏览器需要与 `playwright-core@1.62.1` 匹配的 Chromium，或用 `BROWSER_EXECUTABLE_PATH` 指定现有 Chrome/Chromium。

## 备份

在 `设置 → 数据` 中配置 WebDAV 或 S3。备份包含 SQLite 一致性快照、附件、笔记、技能、工作区、小应用与必要凭据文件，归档必须按敏感数据保管；恢复会同时恢复备份时的登录密码。恢复会先校验并暂存，随后需要重启服务进程才会在启动阶段换入；旧数据保留在 `DATA_DIR/restore-aside/`。若使用 `APP_SECRET`，恢复端需配置同一密钥才能解开备份中的加密凭据。
