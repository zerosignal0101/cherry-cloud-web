import { useLayoutEffect, useState } from 'react'

/**
 * How much of the layout viewport must be covered before we treat the shrink as
 * a soft keyboard instead of a collapsing browser toolbar (which is usually far
 * smaller). Keeping the normal `dvh` behaviour for toolbars avoids freezing the
 * shell at a stale height.
 */
const KEYBOARD_COVERAGE_THRESHOLD = 120

/**
 * Height to pin the app shell to while a soft keyboard is open, or `null` when
 * the layout viewport already matches the visible area.
 *
 * iOS Safari reports the keyboard only through `visualViewport`: the layout
 * viewport (and therefore `100dvh`) keeps its full height, so a bottom-anchored
 * composer stays hidden behind the keyboard. Android instead shrinks the layout
 * viewport when the page opts into `interactive-widget=resizes-content`, where
 * the overlap stays near zero and this hook stays out of the way.
 */
export function useKeyboardViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const syncHeight = () => {
      const overlap = window.innerHeight - visualViewport.height
      setHeight(overlap > KEYBOARD_COVERAGE_THRESHOLD ? Math.round(visualViewport.height) : null)
    }

    syncHeight()
    visualViewport.addEventListener('resize', syncHeight)
    window.addEventListener('orientationchange', syncHeight)
    return () => {
      visualViewport.removeEventListener('resize', syncHeight)
      window.removeEventListener('orientationchange', syncHeight)
    }
  }, [])

  return height
}
