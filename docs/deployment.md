# 部署与运维

cherry-cloud-web 是单进程应用：同一个 Node 进程提供 SPA、HTTP RPC、DataApi、媒体文件与 WebSocket。SQLite 与所有数据都在 `DATA_DIR`，因此**只能运行一个实例**，不要在多副本或共享 `DATA_DIR` 的部署后面做负载均衡。

## 1. 前置条件

- Node.js 24.12+（与 `package.json` 的 `engines` 一致）。
- pnpm 10+。
- 服务端 Agent 浏览器需要与 `playwright-core@1.62.1` 匹配的 Chromium；也可以设置 `BROWSER_EXECUTABLE_PATH` 指向现有 Chrome/Chromium。
- 反向代理终止 TLS，并转发 `/`、`/api`、`/media`；`/api/ws` 需要 WebSocket 升级。

## 2. 安装与构建

```bash
git clone <repo> cherry-cloud-web
cd cherry-cloud-web
pnpm install --frozen-lockfile
pnpm build        # typecheck + dist/web + dist/server
```

首次启动前准备数据目录与密码：

```bash
sudo install -d -o cherry -g cherry -m 0700 /var/lib/cherry-cloud-web
sudo install -d -o cherry -g cherry -m 0700 /var/log/cherry-cloud-web
```

## 3. 环境变量

复制 `.env.example` 为 `.env`（systemd 部署也可以把变量写进 unit）。关键项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；由同机反向代理转发时保持回环地址 |
| `PORT` | `8787` | 监听端口 |
| `DATA_DIR` | `./.data` | SQLite、附件、笔记、工作区、备份临时文件与日志 |
| `WEB_DIST` | `./dist/web` | SPA 构建产物 |
| `ADMIN_PASSWORD` | 空 | 仅首次启动、`DATA_DIR/auth.json` 不存在时生效，至少 8 位 |
| `SESSION_TTL_DAYS` | `30` | 会话 Cookie 有效期 |
| `COOKIE_SECURE` | 空 | 反代已终止 TLS 但未透传协议时设为 `true` |
| `ALLOWED_ORIGINS` | 空 | 额外允许的 POST/WS 来源，逗号分隔 |
| `APP_SECRET` | 空 | 固定加密与签名密钥；留空自动生成 `secret.key` / `session.key` |
| `LOG_LEVEL` | `info` | 服务端日志级别 |
| `MIGRATIONS_DIR` | `./migrations/sqlite-drizzle` | 数据库迁移目录，随仓库提供 |
| `BROWSER_EXECUTABLE_PATH` | 空 | 服务端 Playwright 使用的 Chrome/Chromium |

`APP_SECRET` 一旦设置就不要随意更换：供应商 API Key、备份凭据和会话签名都由它派生。更换后旧密钥无法解密，所有会话也会失效。使用固定 `APP_SECRET` 时，恢复备份的目标服务器必须配置同一个值。

## 4. systemd

`deploy/systemd/cherry-cloud-web.service` 是参考 unit。安装：

```bash
sudo cp deploy/systemd/cherry-cloud-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cherry-cloud-web
sudo systemctl status cherry-cloud-web
journalctl -u cherry-cloud-web -f
```

unit 假设代码在 `/opt/cherry-cloud-web`、数据在 `/var/lib/cherry-cloud-web`，并读取 `/opt/cherry-cloud-web/.env`。按实际路径修改 `User`、`WorkingDirectory`、`EnvironmentFile` 与 `ReadWritePaths`。

## 5. 反向代理

### Nginx

参考 `deploy/nginx/cherry-cloud-web.conf`。要点：

- `client_max_body_size` 至少覆盖上传上限（默认单文件 100MB；备份恢复走服务端下载，不受此项影响）。
- `/api/ws` 必须设置 `proxy_http_version 1.1`、`Upgrade`/`Connection` 头，并放宽 `proxy_read_timeout`。
- 保留 `Host`、`X-Forwarded-Proto`、`X-Forwarded-For`；服务端用它们判断 Cookie `Secure` 与同源校验。
- `/media` 可以单独缓存，但不要缓存 `/api`。

### Caddy

```caddyfile
cherry.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787 {
    header_up X-Forwarded-Proto {scheme}
  }
}
```

Caddy 默认支持 WebSocket 升级。若启用了 `COOKIE_SECURE=true`，仍应确保反代传递 `X-Forwarded-Proto: https`。

## 6. 健康检查与日志

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

返回 `{"status":"ok",...}`。健康检查不需要会话。服务端日志走 stdout（systemd 由 journald 收集）。

## 7. 升级

```bash
cd /opt/cherry-cloud-web
sudo -u cherry git pull
sudo -u cherry pnpm install --frozen-lockfile
sudo -u cherry pnpm build
sudo systemctl restart cherry-cloud-web
```

启动时会自动执行 SQLite 迁移。升级前建议先做一次 WebDAV/S3 备份。不要同时运行两个进程指向同一个 `DATA_DIR`。

## 8. 备份与恢复

在 `设置 → 数据` 配置 WebDAV 或 S3，支持手动与自动备份。归档包含 SQLite 一致性快照、附件、笔记、技能、工作区、小应用和登录密码哈希，必须按敏感数据保管。

恢复流程：

1. 在设置中选择远端备份并确认恢复。
2. 服务端下载、校验并暂存，然后返回“需要重启”。
3. 重启 `cherry-cloud-web`。新进程在打开数据库与鉴权之前完成换入。
4. 旧数据保留在 `DATA_DIR/restore-aside/<restoreId>/`，确认无误后再手动删除。

恢复会覆盖当前账号密码。若备份来自另一台服务器且使用了 `APP_SECRET`，目标机必须配置相同密钥才能解开备份中的加密凭据，否则请在恢复后重新填写供应商与备份凭据。

## 9. 服务端浏览器

- 本部署不提供 CLI 与服务端终端；WebSocket 只有 `/api/ws`（会话事件与流式）与文件上传相关的 HTTP 入口。
- Agent 浏览器是服务端无头 Chromium，不向浏览器暴露远程调试端口；站点 iframe 是否可嵌入由对方 `X-Frame-Options`/`frame-ancestors` 决定。

## 10. 测试

```bash
pnpm typecheck
pnpm lint
pnpm test          # 服务端与 shared 单测 + i18n 键覆盖
pnpm test:e2e      # 构建后用 Playwright 跑桌面 1440×900 与手机 390×844
```

E2E 使用临时 `DATA_DIR` 与 `scripts/e2e-server.mjs`，不会写入仓库数据；失败时报告在 `playwright-report/`，跟踪文件在 `test-results/`。Playwright 配置使用系统 Google Chrome（`channel: 'chrome'`）；没有 Chrome 的机器请先安装，或改用 `pnpm exec playwright install chromium` 并调整 `playwright.config.ts`。

## 11. 常见问题

- **登录后立刻跳回 `/login`**：检查反向代理是否保留 Cookie、是否同时提供 HTTP 与 HTTPS；跨协议访问会让 `Secure` Cookie 失效。必要时设置 `COOKIE_SECURE=true`。
- **WebSocket 反复重连**：确认反代放行 `/api/ws` 的 Upgrade；`ALLOWED_ORIGINS` 需要包含实际访问来源。
- **Agent 浏览器启动失败**：安装匹配版本的 Chromium，或设置 `BROWSER_EXECUTABLE_PATH`。
- **恢复后仍是旧数据**：恢复只写 journal，必须重启进程；检查 `DATA_DIR/restore-journal.json` 是否存在以及日志中的 promotion 错误。
- **SQLite busy/locked**：确认没有第二个实例指向同一 `DATA_DIR`；备份期间服务端会短暂暂停写入。
