# 路由系统

Web 版使用 **TanStack Router + 单一 URL 路由**。URL 就是页面：`/app/*` 与 `/settings/*` 共用导航壳，浏览器前进/后退可用，刷新后仍停留在当前页面。

桌面端“每个标签页一个 MemoryRouter”和 webview 标签页已在 M16 移除。路由上方的 `TabsContext` 兼容层仍向上游组件提供 `openTab`、`closeTab`、当前标签页等子集 API，但每个标签页就是一个 URL 路由，不再是独立路由器。

## 新增页面

在 `src/renderer/routes/` 下创建文件，文件路径就是 URL。

```tsx
// src/renderer/routes/app/notes.tsx
import { createFileRoute } from '@tanstack/react-router'
import NotesPage from '@renderer/pages/notes/NotesPage'

export const Route = createFileRoute('/app/notes')({
  component: NotesPage
})
```

运行 `pnpm dev`（或任意 Vite 构建）后，路由插件会重新生成 `routeTree.gen.ts`。不要手改生成文件。

## 导航

页面内使用 TanStack Router：

```tsx
const navigate = useNavigate()
navigate({ to: '/settings/provider' })
navigate({ to: '/app/mini-app/$appId', params: { appId } })
```

路由树之外的运行时代码（弹窗、消息操作）使用渲染层的 `openTab` / `openSettingsTab`。它们最终改变 URL；`forceNew` 只对桌面独立窗口有意义，Web Shell 不使用。

## 布局

- `src/renderer/routes/app.tsx` 用 `WebShell` 包裹 `/app/*`。
- `src/renderer/routes/settings.tsx` 用同一 Shell 包裹 `/settings/*`。
- 桌面显示 56px 图标栏；手机显示底部导航与设置抽屉。
- 只注册 Web 范围的路由。已移除的桌面页面（知识库、绘画、启动台、订阅、频道、划词/快捷助手、截图、快捷键、本地模型、环境依赖、设备配对）不在路由树中，且会被 `isKnownNavigationPath` 拒绝。

## 生成的路由树

`routeTree.gen.ts` 由 `@tanstack/router-plugin` 根据 `src/renderer/routes/` 生成。新增或删除路由文件后需要运行一次 Vite 开发服务或构建，确保路由树与类型注册同步。
