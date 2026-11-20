import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Playwright webServer entry.
 *
 * Starts the built single-process server against a throwaway DATA_DIR and the
 * password the E2E suite logs in with. The directory is removed on exit so the
 * repository never accumulates test data.
 */
const repoRoot = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'ccw-e2e-'))
const port = process.env.E2E_PORT ?? '8799'

const child = spawn(process.execPath, [join(repoRoot, 'dist/server/main.js')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: port,
    DATA_DIR: dataDir,
    ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? 'e2e-password-123',
    WEB_DIST: join(repoRoot, 'dist/web'),
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn'
  },
  stdio: 'inherit'
})

let stopping = false
const cleanup = (code) => {
  if (stopping) return
  stopping = true
  try {
    child.kill('SIGTERM')
  } catch {
    // Already gone.
  }
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code)
}

process.once('SIGINT', () => cleanup(0))
process.once('SIGTERM', () => cleanup(0))
child.once('exit', (code) => cleanup(code ?? 0))
child.once('error', (error) => {
  process.stderr.write(`Failed to start E2E server: ${String(error)}\n`)
  cleanup(1)
})
