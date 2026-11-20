import { ThemeMode } from '@shared/data/preference/preferenceTypes'

const DARK_QUERY = '(prefers-color-scheme: dark)'

interface BootstrapBody {
  data?: {
    themeMode?: unknown
    language?: unknown
  }
}

let themeMode: ThemeMode = ThemeMode.system
let mediaQuery: MediaQueryList | null = null

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === ThemeMode.light || value === ThemeMode.dark || value === ThemeMode.system

function applyTheme(): void {
  const dark = themeMode === ThemeMode.dark || (themeMode === ThemeMode.system && window.matchMedia(DARK_QUERY).matches)
  for (const element of [document.documentElement, document.body]) {
    element.classList.toggle('dark', dark)
    element.classList.toggle('light', !dark)
  }
}

function trackSystemTheme(): void {
  mediaQuery?.removeEventListener('change', applyTheme)
  mediaQuery = null
  if (themeMode !== ThemeMode.system) return
  mediaQuery = window.matchMedia(DARK_QUERY)
  mediaQuery.addEventListener('change', applyTheme)
}

/**
 * The password gate renders before the application providers exist, so it
 * cannot read preferences through IPC. Fetch the public presentation bootstrap
 * first so the gate opens in the configured theme and language instead of
 * flashing the OS default; a failed request still leaves a usable page.
 */
export async function prepareLoginPage(): Promise<string | null> {
  try {
    const response = await fetch('/api/ui/bootstrap', { credentials: 'same-origin' })
    if (response.ok) {
      const body = (await response.json()) as BootstrapBody
      if (isThemeMode(body.data?.themeMode)) themeMode = body.data.themeMode

      trackSystemTheme()
      applyTheme()
      return typeof body.data?.language === 'string' ? body.data.language : null
    }
  } catch {
    // Offline or an older server: keep the system appearance.
  }

  trackSystemTheme()
  applyTheme()
  return null
}
