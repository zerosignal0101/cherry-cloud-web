import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolvePath('./src/shared'),
      '@main': resolvePath('./src/main'),
      '@server': resolvePath('./src/server')
    }
  },
  test: {
    include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
    // Code CLI ships in a later milestone; its bundled skill resources are not vendored yet.
    exclude: [
      '**/node_modules/**',
      'src/shared/data/presets/__tests__/codeCliTools.test.ts',
      // Reads the upstream workspace copy of provider-registry; the Web build uses the npm package.
      'src/shared/utils/__tests__/provider.serverTools.test.ts'
    ],
    passWithNoTests: true,
    environment: 'node'
  }
})
