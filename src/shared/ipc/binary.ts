/**
 * JSON-safe binary codec for the browser transport.
 *
 * Electron's structured clone carries `Uint8Array` natively; HTTP/WebSocket
 * frames are JSON, where a typed array degrades to a plain object. The server
 * and the browser therefore tag byte arrays with `__ccwBytes` (base64) before
 * stringifying and revive them on the other side. The tag is deliberately
 * unusual so an ordinary application object is unlikely to collide.
 */
const BYTES_TAG = '__ccwBytes'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function encodeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) return { [BYTES_TAG]: bytesToBase64(value) }
  if (Array.isArray(value)) return value.map(encodeBinary)
  if (value && typeof value === 'object') {
    const encoded: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) encoded[key] = encodeBinary(child)
    return encoded
  }
  return value
}

export function decodeBinary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeBinary)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record[BYTES_TAG] === 'string' && Object.keys(record).length === 1) {
      return base64ToBytes(record[BYTES_TAG])
    }
    const decoded: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) decoded[key] = decodeBinary(child)
    return decoded
  }
  return value
}
