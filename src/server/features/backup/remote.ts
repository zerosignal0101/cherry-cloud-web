import { createReadStream, createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

import { loggerService } from '@logger'
import type { BackupFileInfo, S3Config, WebDavConfig } from '@shared/types/backup'

const logger = loggerService.withContext('BackupRemote')

const REMOTE_IDLE_TIMEOUT_MS = 5 * 60_000

export function assertRemoteFileName(fileName: string): string {
  if (
    !fileName ||
    fileName.length > 255 ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    !fileName.toLowerCase().endsWith('.zip')
  ) {
    throw new Error('Remote backup name must be a plain .zip file name')
  }
  return fileName
}

function remoteSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_IDLE_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export class WebDavRemote {
  constructor(private readonly config: WebDavConfig) {}

  private async client() {
    const { default: WebDav } = await import('@main/services/WebDav')
    return new WebDav(this.config)
  }

  async check(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    const client = await this.client()
    return Boolean(await client.checkConnection())
  }

  async upload(filePath: string, fileName: string, signal?: AbortSignal): Promise<void> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    const uploadSignal = remoteSignal(signal)
    if (this.config.disableStream) {
      const contents = await readFile(filePath, { signal: uploadSignal })
      const uploaded = await client.putFileContents(fileName, contents, {
        overwrite: true,
        signal: uploadSignal
      })
      if (uploaded === false) throw new Error('WebDAV rejected the backup upload')
      return
    }

    const { size } = await import('node:fs/promises').then((fs) => fs.stat(filePath))
    const stream = createReadStream(filePath)
    try {
      const uploaded = await client.putFileContents(fileName, stream, {
        overwrite: true,
        contentLength: size,
        signal: uploadSignal
      })
      if (uploaded === false) throw new Error('WebDAV rejected the backup upload')
    } finally {
      stream.destroy()
    }
  }

  async list(signal?: AbortSignal): Promise<BackupFileInfo[]> {
    const client = await this.client()
    const files = await client.getDirectoryContents(remoteSignal(signal))
    return files
      .filter((file) => file.type === 'file' && file.basename.toLowerCase().endsWith('.zip'))
      .map((file) => ({ fileName: file.basename, modifiedTime: file.lastmod, size: file.size }))
      .sort((left, right) => new Date(right.modifiedTime).getTime() - new Date(left.modifiedTime).getTime())
  }

  async remove(fileName: string, signal?: AbortSignal): Promise<boolean> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    await client.deleteFile(fileName, remoteSignal(signal))
    return true
  }

  async download(fileName: string, destination: string, signal?: AbortSignal): Promise<void> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    await pipeline(
      client.createReadStream(fileName, { signal: remoteSignal(signal) }),
      createWriteStreamSafe(destination),
      {
        signal: remoteSignal(signal)
      }
    )
  }
}

export class S3Remote {
  constructor(private readonly config: S3Config) {}

  private async client() {
    const { default: S3Storage } = await import('@main/services/S3Storage')
    return new S3Storage(this.config)
  }

  async check(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    const client = await this.client()
    return Boolean(await client.checkConnection())
  }

  async upload(filePath: string, fileName: string, signal?: AbortSignal): Promise<void> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(filePath)
    const stream = createReadStream(filePath)
    try {
      await client.putFileContents(fileName, stream, size, { signal: remoteSignal(signal) })
    } finally {
      stream.destroy()
    }
  }

  async list(signal?: AbortSignal): Promise<BackupFileInfo[]> {
    const client = await this.client()
    const objects = await client.listFiles('', remoteSignal(signal))
    return objects
      .filter((object) => object.key.toLowerCase().endsWith('.zip'))
      .map((object) => ({
        fileName: object.key,
        modifiedTime: object.lastModified ?? '',
        size: object.size
      }))
      .sort((left, right) => new Date(right.modifiedTime).getTime() - new Date(left.modifiedTime).getTime())
  }

  async remove(fileName: string, signal?: AbortSignal): Promise<boolean> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    await client.deleteFile(fileName, remoteSignal(signal))
    return true
  }

  async download(fileName: string, destination: string, signal?: AbortSignal): Promise<void> {
    assertRemoteFileName(fileName)
    const client = await this.client()
    const source = await client.getFileStream(fileName)
    try {
      await pipeline(source, createWriteStreamSafe(destination), { signal: remoteSignal(signal) })
    } finally {
      source.destroy()
    }
  }
}

/** Lazy import keeps backup loading from pulling `fs/promises` into unrelated paths. */
function createWriteStreamSafe(destination: string) {
  return createWriteStream(destination, { mode: 0o600 })
}

export function cleanupOldBackups(
  maxBackups: number,
  files: BackupFileInfo[],
  remove: (fileName: string) => Promise<unknown>
): Promise<Error | null> {
  if (maxBackups <= 0) return Promise.resolve(null)
  return (async () => {
    try {
      for (const file of files.slice(maxBackups)) {
        await remove(file.fileName)
      }
      return null
    } catch (error) {
      logger.warn('Failed to clean up old remote backups', { error })
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
}
