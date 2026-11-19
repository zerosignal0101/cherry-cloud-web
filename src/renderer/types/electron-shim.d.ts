/**
 * Type-only stand-ins for Electron and desktop-only packages still referenced by the
 * renderer. The Web build never loads them; the files that use these are desktop-only
 * surfaces scheduled for removal. Values are intentionally `any`.
 */
declare module 'electron' {
  export type WebviewTag = any
  export type ConsoleMessageEvent = any
  export type IpcRendererEvent = any
  export type DidStartNavigationEvent = any
  export type DidRedirectNavigationEvent = any
  export type DidFailLoadEvent = any
  export type DidNavigateEvent = any
  export type DidNavigateInPageEvent = any
  export type PageFaviconUpdatedEvent = any
  export type PageTitleUpdatedEvent = any
  export type IpcMessageEvent = any
  export const webContents: any
  export const ipcRenderer: any
}

declare namespace Electron {
  type WebviewTag = any
  type IpcMessageEvent = any
  type DidStartNavigationEvent = any
  type DidRedirectNavigationEvent = any
  type DidNavigateEvent = any
  type DidFailLoadEvent = any
  type FoundInPageResult = any
  type FindInPageOptions = any
  type OpenDialogOptions = any
  namespace WebContents {
    type ConsoleMessageEvent = any
  }
}

interface Window {
  electron: any
}
