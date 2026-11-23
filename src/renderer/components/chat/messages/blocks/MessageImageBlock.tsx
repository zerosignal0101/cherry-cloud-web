import React from 'react'

import type { FileHandle } from '@shared/data/types/file'
import { isFileEntryHandle } from '@shared/utils/file'

import ImageBlock from './ImageBlock'

/** An image part as the renderer sees it: its file handle plus the stored url as the fallback src. */
export interface MessageImageSource {
  handle?: FileHandle
  url: string
}

interface Props {
  sources: MessageImageSource[]
  isSingle?: boolean
  thumbnail?: boolean
  className?: string
}

/**
 * Browsers cannot read `file://` URLs, so the desktop habit of resolving an
 * entry to its current physical path is wrong here: that swap broke every
 * managed image *and* reflowed the virtualized list once the request landed.
 * The server already owns the id → file mapping, so `/media/:id` is the live
 * location the browser can actually render.
 */
function imageUrl(source: MessageImageSource): string {
  return source.handle && isFileEntryHandle(source.handle) ? `/media/${source.handle.entryId}` : source.url
}

const MessageImageBlock: React.FC<Props> = ({ sources, isSingle, thumbnail, className }) => {
  return <ImageBlock images={sources.map(imageUrl)} isSingle={isSingle} thumbnail={thumbnail} className={className} />
}

export default React.memo(MessageImageBlock)
