import { application } from '@application'
import { CacheService } from '@data/CacheService'
import { PreferenceService } from '@data/PreferenceService'
import { AiService } from '@main/ai/AiService'
import { McpCatalogService } from '@main/ai/mcp/McpCatalogService'
import { McpPackageService } from '@main/ai/mcp/McpPackageService'
import { McpRuntimeService } from '@main/ai/mcp/McpRuntimeService'
import { AiStreamManager } from '@main/ai/streamManager'
import { RuntimeActivityService } from '@main/core/application/RuntimeActivityService'
import { JobManager } from '@main/core/job/JobManager'
import { LifecycleManager, Phase, ServiceContainer, type ServiceConstructor } from '@main/core/lifecycle'
import { PowerService } from '@main/core/power/PowerService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { FileManager } from '@main/services/file/FileManager'
import { loggerService } from '@logger'

import { WebDbService } from '../data/dbService'
import {
  WebAnalyticsService,
  WebAutomationReplService,
  WebBrowserSessionService,
  WebIpcApiService,
  WebWindowManager
} from './webServices'

const logger = loggerService.withContext('AiRuntime')

/**
 * Chat-core subset of the upstream service registry.
 *
 * The desktop list also carries windows, trays, updaters, screenshot, channels
 * and knowledge. Those are either out of scope for the web build or have a web
 * replacement registered by the server itself (`WebDbService`,
 * `WebWindowManager`). Everything here is needed by `AiService`.
 */
const webServices = [
  WebDbService,
  CacheService,
  PreferenceService,
  WebWindowManager,
  WebIpcApiService,
  WebBrowserSessionService,
  WebAutomationReplService,
  PowerService,
  RuntimeActivityService,
  SchedulerService,
  JobManager,
  FileManager,
  McpPackageService,
  McpRuntimeService,
  McpCatalogService,
  AiStreamManager,
  AiService,
  WebAnalyticsService
  // `ServiceConstructor` takes `unknown[]` args; classes with narrower
  // constructors (e.g. `AiStreamManager(config?)`) only line up through the
  // same cast upstream uses for its `serviceList`.
] as unknown as ServiceConstructor[]

/**
 * Starts the AI stack through the upstream lifecycle so service order, phase
 * placement and `@DependsOn` contracts stay identical to the desktop app.
 *
 * The Electron-specific parts of `Application.bootstrap()` (ready promise,
 * signal handlers, quit guards) are deliberately left out: the server owns its
 * own shutdown and already has a listening Fastify instance.
 */
export async function startAiRuntime(): Promise<void> {
  const container = ServiceContainer.getInstance()
  for (const service of webServices) {
    container.register(service)
  }
  container.excludeDependentsOfExcluded()

  // Services resolve each other both through the container and through
  // `application.get(name)`; the resolver makes the two views the same objects.
  // Conditional and unconditional services have separate getters upstream, so
  // pick the matching one from the registration metadata.
  application.setResolver((name) => {
    const metadata = container.getMetadata(name)
    if (!metadata) return undefined
    return metadata.conditions?.length ? container.getOptional(name) : container.get(name)
  })

  const lifecycle = LifecycleManager.getInstance()
  await lifecycle.startPhase(Phase.Background)
  await lifecycle.startPhase(Phase.BeforeReady)
  await lifecycle.startPhase(Phase.WhenReady)
  lifecycle.allReady()

  logger.info('AI runtime started')
}

export async function stopAiRuntime(): Promise<void> {
  await LifecycleManager.getInstance().stopAll()
}
