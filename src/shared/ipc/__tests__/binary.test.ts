import { describe, expect, it } from 'vitest'

import { decodeBinary, encodeBinary } from '../binary'

describe('ipc binary codec', () => {
  it('round-trips nested Uint8Array values through JSON', () => {
    const input = {
      route: 'file.edit.write',
      data: new Uint8Array([0, 1, 127, 128, 255]),
      nested: { values: [new Uint8Array([9, 8]), 'text'] }
    }

    const encoded = encodeBinary(input)
    const revived = decodeBinary(JSON.parse(JSON.stringify(encoded))) as typeof input

    expect(revived.data).toBeInstanceOf(Uint8Array)
    expect([...revived.data]).toEqual([0, 1, 127, 128, 255])
    expect(revived.nested.values[0]).toBeInstanceOf(Uint8Array)
    expect([...(revived.nested.values[0] as Uint8Array)]).toEqual([9, 8])
    expect(revived.nested.values[1]).toBe('text')
  })

  it('leaves ordinary objects untouched', () => {
    const value = { ok: true, count: 2, nested: { text: 'hello' } }
    expect(decodeBinary(encodeBinary(value))).toEqual(value)
  })
})
