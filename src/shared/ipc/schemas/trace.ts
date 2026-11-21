import * as z from 'zod'

import type { TraceDataResult } from '@shared/data/types/trace'

import { defineRoute } from '../define'

const traceCursorSchema = z.object({
  historyVersion: z.string().nullable(),
  liveRevision: z.number().int().nonnegative()
})

/**
 * Developer-mode trace viewer. The desktop preload exposed this as
 * `window.api.trace.getData`; the web bridge forwards it as an IpcApi route so
 * the same `TraceStorageService` snapshot reaches the browser.
 */
export const traceRequestSchemas = {
  'trace.get_data': defineRoute({
    input: z.object({
      topicId: z.string().min(1),
      traceId: z.string().min(1),
      cursor: traceCursorSchema.optional()
    }),
    output: z.custom<TraceDataResult>()
  })
}
