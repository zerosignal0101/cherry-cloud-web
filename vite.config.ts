import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  root: resolvePath('./src/renderer'),
  resolve: {
    alias: [
      { find: '@renderer', replacement: resolvePath('./src/renderer') },
      { find: '@shared', replacement: resolvePath('./src/shared') },
      { find: '@data', replacement: resolvePath('./src/renderer/data') },
      { find: '@logger', replacement: resolvePath('./src/renderer/services/LoggerService') },
      // Vendored upstream packages consumed from source. Subpaths are listed
      // before the bare specifier so a prefix match cannot append onto the
      // replacement file.
      {
        find: /^@cherrystudio\/ai-core\/contextOverflow$/,
        replacement: resolvePath('./vendor/ai-core/src/contextOverflow.ts')
      },
      { find: /^@cherrystudio\/ai-core\/provider$/, replacement: resolvePath('./vendor/ai-core/src/core/providers') },
      {
        find: /^@cherrystudio\/ai-core\/built-in\/plugins$/,
        replacement: resolvePath('./vendor/ai-core/src/core/plugins/built-in')
      },
      { find: /^@cherrystudio\/ai-core\/(.*)$/, replacement: resolvePath('./vendor/ai-core/src/$1') },
      { find: /^@cherrystudio\/ai-core$/, replacement: resolvePath('./vendor/ai-core/src/index.ts') },
      { find: /^@cherrystudio\/ai-sdk-provider$/, replacement: resolvePath('./vendor/ai-sdk-provider/src/index.ts') },
      { find: /^@cherrystudio\/agent-runtime$/, replacement: resolvePath('./packages/agent-runtime/src/index.ts') },
      { find: /^@cherrystudio\/agent-behavior$/, replacement: resolvePath('./packages/agent-behavior/src/index.ts') },
      { find: /^@cherrystudio\/ui\/styles\/(.*)$/, replacement: resolvePath('./packages/ui/src/styles/$1') },
      { find: '@cherrystudio/file-preview/core', replacement: resolvePath('./packages/file-preview/src/core.ts') },
      { find: '@cherrystudio/file-preview/react', replacement: resolvePath('./packages/file-preview/src/react.ts') },
      {
        find: '@cherrystudio/ui/icons/providers',
        replacement: resolvePath('./packages/ui/src/components/icons/providers/index.ts')
      },
      { find: '@cherrystudio/ui/icons', replacement: resolvePath('./packages/ui/src/components/icons/index.ts') },
      { find: '@cherrystudio/ui', replacement: resolvePath('./packages/ui/src') }
    ]
  },
  define: {
    __APP_EDITION__: JSON.stringify(process.env.CHERRY_EDITION ?? 'global'),
    __APP_RELEASE_NOTES__: JSON.stringify(''),
    __APP_RELEASE_VERSION__: JSON.stringify(''),
    __APP_RELEASE_HISTORY__: JSON.stringify([])
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // The plugin resolves these against `root` (src/renderer) by default and
      // would look for src/renderer/src/routes; state both paths explicitly.
      routesDirectory: resolvePath('./src/renderer/routes'),
      generatedRouteTree: resolvePath('./src/renderer/routeTree.gen.ts')
    }),
    react(),
    tailwindcss()
  ],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/media': { target: API_TARGET, changeOrigin: true },
      // The login page is server-rendered; in dev it lives on the API server.
      '/login': { target: API_TARGET, changeOrigin: true }
    }
  },
  build: {
    outDir: resolvePath('./dist/web'),
    emptyOutDir: true,
    sourcemap: false
  }
})
