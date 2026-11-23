import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle } from '@shared/utils/file'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('../ImageBlock', () => ({
  default: ({ images }: { images: string[] }) => <div data-testid="image-block" data-images={JSON.stringify(images)} />
}))

import MessageImageBlock from '../MessageImageBlock'

const images = () => JSON.parse(screen.getByTestId('image-block').getAttribute('data-images') ?? '[]') as string[]

describe('MessageImageBlock', () => {
  it('addresses managed images through the id-based media route, never a file url or physical path', () => {
    render(
      <MessageImageBlock
        sources={[
          { handle: createFileEntryHandle('entry-1'), url: 'file:///old/machine/Files/entry-1.png' },
          { url: 'https://img.test/a.png' },
          { handle: createFilePathHandle('/tmp/local.png' as AbsoluteFilePath), url: 'file:///tmp/local.png' }
        ]}
      />
    )

    expect(images()).toEqual(['/media/entry-1', 'https://img.test/a.png', 'file:///tmp/local.png'])
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('renders the stored url when the part has no managed entry', () => {
    render(<MessageImageBlock sources={[{ url: 'data:image/png;base64,AAAA' }]} />)
    expect(images()).toEqual(['data:image/png;base64,AAAA'])
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
