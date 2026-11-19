declare global {
  interface Window {
    /** Web transport facade; replaced by the IPC bridge implementation in `src/renderer/ipc`. */
    api: any
  }
}

export {}
