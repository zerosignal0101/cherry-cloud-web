import { useSyncExternalStore } from 'react'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

function getPointerQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(COARSE_POINTER_QUERY)
}

function subscribe(onStoreChange: () => void) {
  const query = getPointerQuery()
  if (!query) return () => {}

  query.addEventListener('change', onStoreChange)
  return () => query.removeEventListener('change', onStoreChange)
}

/**
 * True on touch-first devices. Hover previews never fire there, so callers that
 * pair a hover surface with an action need a tap-reachable alternative.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getPointerQuery()?.matches ?? false,
    () => false
  )
}
