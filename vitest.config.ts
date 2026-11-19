import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolvePath('./src/shared'),
      '@server': resolvePath('./src/server')
    }
  },
  test: {
    include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node'
  }
})
