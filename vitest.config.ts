import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  // Upstream main-process classes use legacy TypeScript decorators; the test
  // pipeline needs the same lowering the server build asks rolldown for.
  oxc: { decorator: { legacy: true } },
  define: {
    // The desktop build embeds the Claude Code binary manifest; the web build
    // ships no binary, so the manifest stays empty.
    __CLAUDE_CODE_BINARY_MANIFEST__: JSON.stringify({ version: '', packages: {} })
  },
  resolve: {
    alias: [
      { find: '@shared', replacement: resolvePath('./src/shared') },
      { find: '@main', replacement: resolvePath('./src/main') },
      { find: '@server', replacement: resolvePath('./src/server') },
      { find: '@platform', replacement: resolvePath('./src/platform') },
      { find: '@data', replacement: resolvePath('./src/main/data') },
      { find: '@logger', replacement: resolvePath('./src/main/core/logger/LoggerService.ts') },
      { find: '@application', replacement: resolvePath('./src/platform/application.ts') },
      { find: /^electron$/, replacement: resolvePath('./src/platform/electron/index.ts') },
      // Vendored upstream packages, resolved from source like the builds do.
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
      { find: /^@cherrystudio\/agent-behavior$/, replacement: resolvePath('./packages/agent-behavior/src/index.ts') }
    ]
  },
  test: {
    include: ['src/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
    // The CLI preset table stays for BinaryManager's mise recipes; its bundled skill resources are not vendored.
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
