# cherry-cloud-web

Cherry Studio 的自托管 Web 版：数据与模型调用在服务端，浏览器只做界面，单一使用者，公网访问。

- 架构与里程碑：[docs/architecture/cloud-migration.md](docs/architecture/cloud-migration.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 开发

```bash
pnpm install
pnpm dev          # Vite :5173 + API :8787
pnpm build        # 类型检查 + 构建 dist/web
```

环境变量见 `.env.example`。

## 部署

单 Node 进程（systemd），由反向代理终止 TLS 并转发 `/`、`/api`、`/media`（含 WebSocket 升级）。部署说明随 M7 补齐。
