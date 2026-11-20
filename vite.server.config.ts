import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Vendored workspace packages: consumed from source, the same way the web build consumes `packages/ui`. */
const agentPackages = [
  'agent-runtime',
  'agent-runtime-claude-code',
  'agent-runtime-pi',
  'agent-runtime-pi-durable',
  'agent-behavior'
].map((name) => ({
  find: new RegExp(`^@cherrystudio/${name}$`),
  replacement: resolvePath(`./packages/${name}/src/index.ts`)
}))

/**
 * The upstream main process is written for Electron Vite, which resolves
 * `?raw` and `?nodeWorker` imports. The web server builds the same tree through
 * this config, so both queries get equivalents here.
 *
 * `?nodeWorker` has no thread to spawn in the same way; the modules that use it
 * already fall back to running the task in-process when no factory is exported.
 */
function electronViteCompat(): Plugin {
  const RAW = '?raw'
  const NODE_WORKER = '?nodeWorker'

  return {
    name: 'cherry:electron-vite-compat',
    enforce: 'pre',
    load(id) {
      if (id.endsWith(NODE_WORKER)) {
        return 'export default undefined'
      }
      if (id.endsWith(RAW)) {
        const file = id.slice(0, -RAW.length)
        const contents = readFileSync(file, 'utf8')
        return `export default ${JSON.stringify(contents)}`
      }
      return null
    }
  }
}

// Native or runtime-asset packages: keep them as real `require`/`import` targets
// so the bundle does not try to inline `.node` binaries or bundled workers.
const externalPackages = [
  'better-sqlite3',
  '@napi-rs/canvas',
  '@node-rs/xxhash',
  'sharp',
  'tesseract.js',
  'font-list',
  '@anthropic-ai/claude-agent-sdk',
  'bufferutil',
  'utf-8-validate'
]

export default defineConfig({
  define: {
    // The desktop build embeds the Claude Code binary manifest; the web build ships
    // no binary, so the manifest stays empty and that runtime reports itself absent.
    __CLAUDE_CODE_BINARY_MANIFEST__: JSON.stringify({ version: '', packages: {} })
  },
  resolve: {
    alias: [
      { find: '@application', replacement: resolvePath('./src/platform/application.ts') },
      { find: /^@main\/(.*)$/, replacement: resolvePath('./src/main/$1') },
      { find: /^@data\/(.*)$/, replacement: resolvePath('./src/main/data/$1') },
      { find: /^@platform\/(.*)$/, replacement: resolvePath('./src/platform/$1') },
      { find: /^@shared\/(.*)$/, replacement: resolvePath('./src/shared/$1') },
      { find: '@logger', replacement: resolvePath('./src/main/core/logger/LoggerService.ts') },
      // Vendored upstream AI packages, resolved from source exactly like the
      // workspace ones: the published `@cherrystudio/ai-core` copies drift from
      // the provider tree this repo ships.
      { find: /^@cherrystudio\/ai-core$/, replacement: resolvePath('./vendor/ai-core/src/index.ts') },
      { find: /^@cherrystudio\/ai-core\/provider$/, replacement: resolvePath('./vendor/ai-core/src/core/providers') },
      {
        find: /^@cherrystudio\/ai-core\/built-in\/plugins$/,
        replacement: resolvePath('./vendor/ai-core/src/core/plugins/built-in')
      },
      { find: /^@cherrystudio\/ai-core\/(.*)$/, replacement: resolvePath('./vendor/ai-core/src/$1') },
      { find: /^@cherrystudio\/ai-sdk-provider$/, replacement: resolvePath('./vendor/ai-sdk-provider/src/index.ts') },
      { find: /^@cherrystudio\/ai-sdk-provider\/(.*)$/, replacement: resolvePath('./vendor/ai-sdk-provider/src/$1') },
      ...agentPackages,
      { find: /^electron$/, replacement: resolvePath('./src/platform/electron/index.ts') }
    ]
  },
  ssr: {
    target: 'node',
    // Only our own sources are bundled. Dependencies keep their published entry
    // points so CommonJS packages (pino, thread-stream, native addons) run with
    // their own `__dirname`/`require` intact.
    noExternal: [],
    external: externalPackages
  },
  build: {
    ssr: resolvePath('./src/server/main.ts'),
    outDir: resolvePath('./dist/server'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: externalPackages,
      // Upstream main-process classes use legacy TypeScript decorators.
      transform: { decorator: { legacy: true } },
      output: { format: 'es', entryFileNames: 'main.js' }
    }
  },
  plugins: [electronViteCompat()]
})
