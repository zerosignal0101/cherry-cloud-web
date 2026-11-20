import { useLayoutEffect, useState } from 'react'

/**
 * How much of the layout viewport must be covered before we treat the shrink as
 * a soft keyboard instead of a collapsing browser toolbar (which is usually far
 * smaller). Ignoring toolbars keeps the inset from jumping while the page is
 * scrolled.
 */
const KEYBOARD_COVERAGE_THRESHOLD = 120

/**
 * Pixels of the app shell currently covered by the soft keyboard, or `0` when it
 * is closed.
 *
 * The shell deliberately keeps its `dvh` height while the keyboard is open.
 * Resizing it lifted the phone's bottom bar above the keyboard and reflowed
 * every page — including forms whose fields sit near the top and therefore never
 * needed to move. Only the conversation stage consumes this value, so the
 * composer still clears the keyboard while the rest of the layout stays put.
 *
 * `visualViewport` is the only signal available on iOS Safari, and it also
 * reports Android's keyboard once the page stops opting into
 * `interactive-widget=resizes-content`.
 */
export function useKeyboardViewportInset(): number {
  const [inset, setInset] = useState(0)

  useLayoutEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const syncInset = () => {
      const overlap = window.innerHeight - visualViewport.height
      setInset(overlap > KEYBOARD_COVERAGE_THRESHOLD ? Math.round(overlap) : 0)
    }

    syncInset()
    visualViewport.addEventListener('resize', syncInset)
    window.addEventListener('orientationchange', syncInset)
    return () => {
      visualViewport.removeEventListener('resize', syncInset)
      window.removeEventListener('orientationchange', syncInset)
    }
  }, [])

  return inset
}
