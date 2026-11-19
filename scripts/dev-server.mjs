/**
 * Development entry for the API server.
 *
 * The server shares the upstream main-process sources, which rely on bundler
 * features (decorators, `?raw`, `?nodeWorker`, `import.meta.env`). `tsx` cannot
 * provide those, so dev runs the same Vite SSR build as production and lets
 * `node --watch` restart the bundle whenever it is rewritten.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

const configFile = fileURLToPath(new URL('../vite.server.config.ts', import.meta.url))
const entry = fileURLToPath(new URL('../dist/server/main.js', import.meta.url))

await build({ configFile, mode: 'development', logLevel: 'warn' })

const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', entry], {
  stdio: 'inherit',
  env: process.env
})

const watcher = await build({
  configFile,
  mode: 'development',
  logLevel: 'warn',
  build: { watch: {} }
})

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  child.kill('SIGTERM')
  void watcher.close()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => {
  if (!stopping && code) process.exit(code)
})
