import { IpcRouter } from '@main/ipc/IpcRouter'
import type { RouteDef } from '@shared/ipc/define'
import { IpcError, IpcErrorCode, type IpcResult } from '@shared/ipc/errors/IpcError'
import type { IpcContext, IpcHandlersFor } from '@shared/ipc/types'

interface RouteEntry {
  def: RouteDef
  invoke: (input: unknown, ctx: IpcContext) => Promise<unknown>
}

/**
 * Server-side IpcApi registry. Reuses the upstream {@link IpcRouter} for per-domain
 * dispatch and adds the transport envelope the browser bridge expects: every call
 * resolves to an {@link IpcResult}, never throws.
 */
export class RpcRegistry {
  private readonly routes = new Map<string, RouteEntry>()

  register<S extends Record<string, RouteDef>>(schemas: S, handlers: IpcHandlersFor<S>): void {
    const router = new IpcRouter(schemas, handlers)
    for (const route of Object.keys(schemas)) {
      if (this.routes.has(route)) {
        throw new Error(`Duplicate IpcApi route registration: ${route}`)
      }
      this.routes.set(route, {
        def: schemas[route],
        invoke: (input, ctx) => router.dispatch(route, input, ctx)
      })
    }
  }

  async dispatch(route: string, input: unknown, ctx: IpcContext): Promise<IpcResult<unknown>> {
    const entry = this.routes.get(route)
    if (!entry) {
      return this.failure(new IpcError(IpcErrorCode.ROUTE_NOT_FOUND, `Unknown IpcApi route: ${route}`))
    }

    try {
      return { ok: true, data: await entry.invoke(input, ctx) }
    } catch (error) {
      return this.failure(IpcError.from(error))
    }
  }

  has(route: string): boolean {
    return this.routes.has(route)
  }

  routeNames(): string[] {
    return [...this.routes.keys()].sort()
  }

  private failure(error: IpcError): IpcResult<unknown> {
    return { ok: false, error: error.toJSON() }
  }
}
