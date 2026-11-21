export const platform = window.electron?.process?.platform
/** Browser build: the preload shim reports `web` instead of a desktop platform. */
export const isWeb = platform === 'web'
export const isMac = platform === 'darwin'
export const isWin = platform === 'win32' || platform === 'win64'
export const isLinux = platform === 'linux'
export const isDev = window.electron?.process?.env?.NODE_ENV === 'development'
export const isProd = window.electron?.process?.env?.NODE_ENV === 'production'
