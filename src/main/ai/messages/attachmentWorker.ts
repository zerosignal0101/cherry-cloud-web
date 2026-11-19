import { parentPort, workerData } from 'node:worker_threads'

import { decodeTextBufferIfText, decodeTextWithAutoEncoding } from '@main/utils/textEncoding'

import { allocateInlineCaps } from './attachmentInlineBudget'
import type { AttachmentWorkerInput, AttachmentWorkerTasks } from './attachmentWorkerTypes'

type WorkerLogger = { warn: (message: string) => void; error: (message: string) => void }

const silentLogger: WorkerLogger = { warn: () => {}, error: () => {} }

/**
 * The task body, callable in-process.
 *
 * Web adaptation: the desktop app always runs this in an Electron-node worker.
 * The server has no `?nodeWorker` bundler hook, so `attachmentWorkerClient`
 * calls this function directly instead of spawning a worker.
 */
export function runAttachmentTask<K extends keyof AttachmentWorkerTasks>(
  task: { type: K; input: AttachmentWorkerTasks[K]['input'] },
  logger: WorkerLogger = silentLogger
): AttachmentWorkerTasks[K]['result'] {
  switch (task.type) {
    case 'decode': {
      const input = task.input as AttachmentWorkerTasks['decode']['input']
      const buffer = Buffer.from(input.content)
      const text = input.conservative ? decodeTextBufferIfText(buffer) : decodeTextWithAutoEncoding(buffer, logger)
      return (text?.trim() ?? null) as AttachmentWorkerTasks[K]['result']
    }
    case 'allocate': {
      const input = task.input as AttachmentWorkerTasks['allocate']['input']
      return allocateInlineCaps(input.bodies, input.tokens) as AttachmentWorkerTasks[K]['result']
    }
    default:
      throw new Error(`Unknown attachment worker task: ${String((task as { type: string }).type)}`)
  }
}

// Worker entry: only runs when `?nodeWorker` launched this file in a worker.
if (parentPort) {
  const port = parentPort
  const task: AttachmentWorkerInput = workerData
  const logger: WorkerLogger = {
    warn: (message) => port.postMessage({ type: 'log', level: 'warn', message }),
    error: (message) => port.postMessage({ type: 'log', level: 'error', message })
  }
  port.postMessage({ type: 'result', value: runAttachmentTask(task, logger) })
}
