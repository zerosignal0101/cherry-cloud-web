import { useRouter, useRouterState } from '@tanstack/react-router'
import { CalendarClock, FolderOpen, Languages, MessageSquare, Settings } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { Tooltip } from '@cherrystudio/ui'
import AppLogo from '@renderer/assets/images/logo.png'
import { ResourceViewSourceProvider } from '@renderer/components/ResourceViewSourceProvider'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'

interface NavItem {
  href: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * The surfaces enabled so far. Everything else that the desktop renderer could
 * open (knowledge, agents, paintings, notes, mini-apps) is still deferred, so it
 * stays absent from every shell instead of leading to a page the server does not
 * serve. Translate and scheduled tasks joined the first-version set in M10 (see
 * docs/architecture/feature-migration.md).
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/app/chat', icon: MessageSquare },
  { href: '/app/files', icon: FolderOpen },
  { href: '/app/translate', icon: Languages },
  { href: '/app/scheduled-tasks', icon: CalendarClock },
  { href: '/settings', icon: Settings }
]

const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(href.endsWith('/') ? href : `${href}/`)

function useActivePath(): string {
  return useRouterState({ select: (state) => state.location.pathname })
}

/**
 * A real anchor that routes in place.
 *
 * `Link` is avoided on purpose: these are the shell's fixed destinations and a
 * plain `<a>` keeps modifier-click / "open in new tab" behaviour, which a web
 * app should not take away.
 */
function NavLink({
  href,
  className,
  children,
  onNavigate
}: {
  href: string
  className?: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  const router = useRouter()
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Let the browser handle modifier clicks and middle clicks.
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      router.history.push(href)
      onNavigate?.()
    },
    [href, onNavigate, router]
  )

  return (
    <a href={href} className={className} onClick={handleClick}>
      {children}
    </a>
  )
}

function useLabels(): Array<NavItem & { title: string }> {
  return useMemo(() => NAV_ITEMS.map((item) => ({ ...item, title: getDefaultRouteTitle(item.href) })), [])
}

/**
 * Desktop: a fixed icon rail on the left, page on the right.
 * Phone: the page fills the viewport and the same destinations sit in a bottom
 * bar. Both shapes share one item list so the two shells cannot drift.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = useActivePath()

  return (
    <div data-ui="app.shell" className="flex h-dvh w-full flex-row overflow-hidden bg-sidebar text-foreground">
      <DesktopRail pathname={pathname} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main
          data-ui="app.content"
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:m-1.5 md:ml-0 md:rounded-xl md:border-[0.5px] md:border-border">
          {/* Mounted here for the same reason as in the desktop AppShell: the chat
              page reads the assistant/agent session sources through context, and
              one provider above the pages keeps a single source per window. */}
          <ResourceViewSourceProvider>{children}</ResourceViewSourceProvider>
        </main>
        <MobileBar pathname={pathname} />
      </div>
    </div>
  )
}

function DesktopRail({ pathname }: { pathname: string }) {
  const items = useLabels()
  return (
    <nav
      data-ui="app.desktop-nav"
      aria-label="主导航"
      className="hidden w-14 shrink-0 flex-col items-center gap-1 py-3 md:flex">
      <img src={AppLogo} alt="" aria-hidden="true" className="mb-3 size-8 rounded-xl" />
      {items.map(({ href, icon: Icon, title }) => {
        const active = isActive(pathname, href)
        return (
          <Tooltip key={href} title={title} placement="right" asChild>
            <NavLink
              href={href}
              aria-label={title}
              className={cn(
                'flex size-10 items-center justify-center rounded-xl transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}>
              <Icon className="size-5" />
            </NavLink>
          </Tooltip>
        )
      })}
    </nav>
  )
}

function MobileBar({ pathname }: { pathname: string }) {
  const items = useLabels()
  return (
    <nav
      data-ui="app.mobile-nav"
      aria-label="主导航"
      className="flex shrink-0 items-stretch justify-around border-t-[0.5px] border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map(({ href, icon: Icon, title }) => {
        const active = isActive(pathname, href)
        return (
          <NavLink
            key={href}
            href={href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]',
              active ? 'text-primary' : 'text-muted-foreground'
            )}>
            <Icon className="size-5" />
            <span>{title}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
