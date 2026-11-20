import type { FastifyInstance } from 'fastify'

import { application } from '@application'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

/**
 * The unauthenticated password gate still has to look like the app the user
 * configured. It cannot read preferences through IPC (that requires a session),
 * so this public endpoint exposes the two presentation values the gate needs —
 * nothing else from the preference store is readable without a session.
 */
interface PreferenceAccess {
  get(key: string): unknown
}

const preferences = (): PreferenceAccess => application.get('PreferenceService') as PreferenceAccess

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === ThemeMode.light || value === ThemeMode.dark || value === ThemeMode.system

export async function registerUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/ui/bootstrap', async (_request, reply) => {
    const themeMode = preferences().get('ui.theme_mode')
    const language = preferences().get('app.language')

    return reply.header('cache-control', 'no-store').send({
      ok: true,
      data: {
        themeMode: isThemeMode(themeMode) ? themeMode : ThemeMode.system,
        language: typeof language === 'string' ? language : null
      }
    })
  })
}
