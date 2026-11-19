import { mkdirSync } from 'node:fs'

import { buildApp } from './app'
import { assertWebDist, loadConfig } from './config'

async function main(): Promise<void> {
  const config = loadConfig()
  assertWebDist(config)
  mkdirSync(config.dataDir, { recursive: true })

  const app = await buildApp(config)

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  app.log.info({ dataDir: config.dataDir }, 'cherry-cloud-web server ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
