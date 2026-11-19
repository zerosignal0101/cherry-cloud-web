import { ensureDataPaths, resolveDataPaths } from '@platform/dataPaths'

import { buildApp } from './app'
import { assertWebDist, loadConfig } from './config'

async function main(): Promise<void> {
  const config = loadConfig()
  assertWebDist(config)

  const paths = resolveDataPaths(config.dataDir)
  ensureDataPaths(paths)

  const app = await buildApp(config)

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  app.log.info({ dataDir: paths.root, database: paths.database }, 'cherry-cloud-web server ready')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
