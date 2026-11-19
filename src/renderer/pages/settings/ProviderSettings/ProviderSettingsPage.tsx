import { useNavigate, useSearch } from '@tanstack/react-router'
import { omit } from 'es-toolkit/compat'
import { ArrowLeft } from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Spinner } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { useProviders } from '@renderer/hooks/useProvider'
import type { AppRouter } from '@renderer/types/router'
import { isProviderSettingsListVisibleProvider } from '@renderer/utils/providerSettings'
import { cn } from '@renderer/utils/style'
import type { Provider } from '@shared/data/types/provider'

import type { ProviderApiSetupInitialStep } from './ConnectionSettings/ProviderApiSetupDialog'
import { useProviderDeepLinkImport } from './hooks/useProviderDeepLinkImport'
import { ProviderList } from './ProviderList'
import ProviderSetting from './ProviderSetting'

interface PendingApiSetup {
  providerId: string
  initialStep: ProviderApiSetupInitialStep
}

interface ProviderSettingsContentProps {
  rawProviders: Provider[]
}

function ProviderSettingsContent({ rawProviders }: ProviderSettingsContentProps) {
  const { t } = useTranslation()
  const search = useSearch<AppRouter, undefined, false>({ strict: false })
  const navigate = useNavigate()
  // Phones show either the provider list or the selected provider, never both.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [lastSelectedProviderId, setLastSelectedProviderId] = usePersistCache(
    'settings.provider.last_selected_provider_id'
  )
  const [selectedProviderId, setSelectedProviderIdState] = useState<string | undefined>(
    () => lastSelectedProviderId ?? undefined
  )
  const [pendingApiSetup, setPendingApiSetup] = useState<PendingApiSetup | null>(null)
  const setLastSelectedProviderIdRef = useRef(setLastSelectedProviderId)

  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])
  const visibleProviders = useMemo(() => providers.filter(isProviderSettingsListVisibleProvider), [providers])
  const filterModeHint = search.filter === 'agent' ? 'agent' : undefined

  useEffect(() => {
    setLastSelectedProviderIdRef.current = setLastSelectedProviderId
  }, [setLastSelectedProviderId])

  useEffect(() => {
    const persistedProviderId = lastSelectedProviderId ?? undefined
    setSelectedProviderIdState((currentProviderId) =>
      currentProviderId === persistedProviderId ? currentProviderId : persistedProviderId
    )
  }, [lastSelectedProviderId])

  const setSelectedProviderId = useCallback((providerId: string | undefined) => {
    setPendingApiSetup((current) => (current?.providerId === providerId ? current : null))
    setLastSelectedProviderIdRef.current(providerId ?? null)
    startTransition(() => setSelectedProviderIdState(providerId))
  }, [])

  /** A tap on the phone list is also a navigation into that provider's page. */
  const handleSelectProvider = useCallback(
    (providerId: string | undefined) => {
      setSelectedProviderId(providerId)
      if (providerId) setMobileDetailOpen(true)
    },
    [setSelectedProviderId]
  )

  // Deep links (`?id=`) are an explicit request for one provider's page.
  useEffect(() => {
    if (search.id) setMobileDetailOpen(true)
  }, [search.id])

  const handleCustomProviderCreated = useCallback((providerId: string, hasApiKey: boolean) => {
    setPendingApiSetup({ providerId, initialStep: hasApiKey ? 'models' : 'api-key' })
  }, [])

  const handleApiSetupClosed = useCallback((providerId: string) => {
    setPendingApiSetup((current) => (current?.providerId === providerId ? null : current))
  }, [])

  useProviderDeepLinkImport(search.addProviderData, setSelectedProviderId)

  useEffect(() => {
    let shouldConsume = false

    if (search.filter === 'agent') {
      shouldConsume = true
    }

    if (search.id) {
      const provider = visibleProviders.find((item) => item.id === search.id)
      if (provider) {
        setSelectedProviderId(provider.id)
        shouldConsume = true
      } else if (visibleProviders.length > 0) {
        // Loaded and genuinely unknown — degrade to the first like before
        setSelectedProviderId(visibleProviders[0]?.id)
        shouldConsume = true
      } else {
        // Still loading: keep the param until the list resolves, else the
        // selection is consumed with no provider mounted to own it
        return
      }
    }

    if (shouldConsume) {
      const restSearch = omit(search, ['filter', 'id'])
      void navigate({ to: '/settings/provider', search: restSearch, replace: true })
    }
  }, [navigate, search, setSelectedProviderId, visibleProviders])

  useEffect(() => {
    // A pending ?id= deep link owns the initial selection while providers
    // load; the fallback must not race it to visibleProviders[0]
    if (search.id) return
    if (!selectedProviderId && visibleProviders[0]) {
      setSelectedProviderId(visibleProviders[0].id)
      return
    }

    if (selectedProviderId && !visibleProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0]?.id)
    }
  }, [search.id, selectedProviderId, setSelectedProviderId, visibleProviders])

  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === selectedProviderId),
    [selectedProviderId, visibleProviders]
  )

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div
        className={cn(
          'min-h-0 w-full [&>aside]:w-full [&>aside]:min-w-0',
          'md:flex md:w-auto md:shrink-0 md:[&>aside]:w-[248px]',
          mobileDetailOpen && 'hidden md:flex'
        )}>
        <ProviderList
          selectedProviderId={selectedProviderId}
          filterModeHint={filterModeHint}
          onSelectProvider={handleSelectProvider}
          onCustomProviderCreated={handleCustomProviderCreated}
        />
      </div>
      {selectedProvider && (
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !mobileDetailOpen && 'hidden md:flex')}>
          <div className="flex h-10 shrink-0 items-center gap-1 border-b-[0.5px] border-border px-2 md:hidden">
            <button
              type="button"
              aria-label={t('common.back')}
              onClick={() => setMobileDetailOpen(false)}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground">
              <ArrowLeft className="size-5" />
            </button>
            <span className="truncate font-medium text-sm">{selectedProvider.name}</span>
          </div>
          <ProviderSetting
            providerId={selectedProvider.id}
            key={selectedProvider.id}
            initialApiSetupStep={
              pendingApiSetup?.providerId === selectedProvider.id ? pendingApiSetup.initialStep : undefined
            }
            onApiSetupClosed={() => handleApiSetupClosed(selectedProvider.id)}
          />
        </div>
      )}
    </div>
  )
}

export default function ProviderSettingsPage() {
  const { t } = useTranslation()
  const { providers, hasLoaded, isLoading, error, refetch } = useProviders()

  if (error && !hasLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Alert
          type="error"
          showIcon
          message={t('common.error')}
          description={error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
          className="max-w-lg rounded-md px-4 py-3 shadow-none"
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <Spinner text={t('common.loading')} />
      </div>
    )
  }

  return <ProviderSettingsContent rawProviders={providers} />
}
