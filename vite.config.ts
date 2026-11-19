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
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
      '/media': { target: API_TARGET, changeOrigin: true }
    }
  },
  build: {
    outDir: resolvePath('./dist/web'),
    emptyOutDir: true,
    sourcemap: false
  }
})
