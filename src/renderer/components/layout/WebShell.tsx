import {
  BookOpen,
  Bot,
  CalendarClock,
  Code2,
  FolderOpen,
  Languages,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Palette,
  Settings,
  Store
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, Tooltip } from '@cherrystudio/ui'
import { ResourceViewSourceProvider } from '@renderer/components/ResourceViewSourceProvider'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { cn } from '@renderer/utils/style'
import { useRouter, useRouterState } from '@tanstack/react-router'

interface NavItem {
  href: string
  icon: React.ComponentType<{ className?: string }>
}

/** The four surfaces that fit a phone's bottom bar. */
const PRIMARY_ITEMS: NavItem[] = [
  { href: '/app/chat', icon: MessageSquare },
  { href: '/app/agents', icon: Bot },
  { href: '/app/files', icon: FolderOpen },
  { href: '/settings', icon: Settings }
]

/** Everything else moved into the phone drawer. */
const SECONDARY_ITEMS: NavItem[] = [
  { href: '/app/knowledge', icon: BookOpen },
  { href: '/app/notes', icon: NotebookPen },
  { href: '/app/translate', icon: Languages },
  { href: '/app/paintings', icon: Palette },
  { href: '/app/code', icon: Code2 },
  { href: '/app/marketplace', icon: Store },
  { href: '/app/scheduled-tasks', icon: CalendarClock },
  { href: '/app/launchpad', icon: LayoutGrid }
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

/**
 * Desktop: a fixed icon rail on the left, page on the right.
 * Phone: the page fills the viewport, primary navigation sits in a bottom bar and
 * the rest lives behind a "more" drawer.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  const pathname = useActivePath()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div data-ui="app.shell" className="flex h-dvh w-full flex-row overflow-hidden bg-sidebar text-foreground">
      <DesktopRail pathname={pathname} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main
          data-ui="app.content"
          className="relative min-h-0 flex-1 overflow-hidden bg-background md:m-1.5 md:ml-0 md:rounded-xl md:border-[0.5px] md:border-border">
          {/* Mounted here for the same reason as in the desktop AppShell: the chat
              page reads the assistant/agent session sources through context, and
              one provider above the pages keeps a single source per window. */}
          <ResourceViewSourceProvider>{children}</ResourceViewSourceProvider>
        </main>
        <MobileBar pathname={pathname} onMore={() => setDrawerOpen(true)} />
      </div>
      <MobileDrawer pathname={pathname} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  )
}

function useLabels(items: NavItem[]): Array<NavItem & { title: string }> {
  return useMemo(() => items.map((item) => ({ ...item, title: getDefaultRouteTitle(item.href) })), [items])
}

function DesktopRail({ pathname }: { pathname: string }) {
  const items = useLabels([...PRIMARY_ITEMS, ...SECONDARY_ITEMS])
  return (
    <nav aria-label="主导航" className="hidden w-14 shrink-0 flex-col items-center gap-1 py-3 md:flex">
      <NavLink
        href="/app/chat"
        className="mb-2 flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <MessageSquare className="size-5" />
      </NavLink>
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

function MobileBar({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const items = useLabels(PRIMARY_ITEMS)
  return (
    <nav
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
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground">
        <MoreHorizontal className="size-5" />
        <span>更多</span>
      </button>
    </nav>
  )
}

function MobileDrawer({
  pathname,
  open,
  onOpenChange
}: {
  pathname: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const items = useLabels(SECONDARY_ITEMS)
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="md:hidden">
        <DrawerHeader>
          <DrawerTitle>更多</DrawerTitle>
        </DrawerHeader>
        <div className="grid grid-cols-4 gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {items.map(({ href, icon: Icon, title }) => (
            <NavLink
              key={href}
              href={href}
              onNavigate={() => onOpenChange(false)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl py-3 text-[11px]',
                isActive(pathname, href) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              )}>
              <Icon className="size-5" />
              <span className="max-w-full truncate">{title}</span>
            </NavLink>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
