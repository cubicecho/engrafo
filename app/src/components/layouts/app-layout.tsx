import { FileText, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { ActionButton } from '@/components/action-button';
import { clearToken } from '@/lib/auth';
import { isDark, setDark } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * The shell around every signed-in page: a sidebar on the left, the page on the
 * right.
 *
 * Hand-rolled rather than shadcn's `sidebar`, which is the sibling apps'
 * choice too. That component brings a provider, a cookie, a rail, a mobile
 * sheet and collapsible icon mode — machinery for a navigation tree, where this
 * is a flat list that fits on the screen twice over. The whole thing here is an
 * `<aside>` and a `<nav>`.
 *
 * This owns what `PageLayout` deliberately does not: the sidebar, the theme
 * toggle and signing out. Pages own their own headers and keep using
 * `PageLayout` inside this.
 */

const NAV_ITEMS = [
  // `end` so "Documents" is not also marked active on /documents/:id — that
  // route is a document, not the list, and two lit rows read as a bug.
  { to: '/', label: 'Documents', icon: FileText, end: true },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

function ThemeToggle() {
  // Seeded from the class index.html already set, so the icon matches the
  // screen on the first render rather than after an effect.
  const [dark, setDarkState] = useState(isDark);

  return (
    <ActionButton
      label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        setDark(!dark);
        setDarkState(!dark);
      }}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </ActionButton>
  );
}

function SignOutButton() {
  const navigate = useNavigate();

  return (
    <ActionButton
      label="Sign out"
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        clearToken();
        navigate('/login', { replace: true });
      }}
    >
      <LogOut className="size-4" aria-hidden />
    </ActionButton>
  );
}

/** Shared by both navs so the active row is decided in one place. */
function navLinkClass(compact: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 rounded-md text-sm transition-colors',
      compact ? 'p-2' : 'px-3 py-2',
      isActive
        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    );
}

/** Icon-only, in the header, for the widths where the sidebar is hidden. */
function MobileNav() {
  return (
    <nav className="flex items-center gap-1 md:hidden" aria-label="Main">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} aria-label={label} className={navLinkClass(true)}>
          <Icon className="size-4" aria-hidden />
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    // `h-screen`, not `min-h-screen`: PageLayout is a sticky chassis that
    // scrolls its own body, and it can only do that if something above it has a
    // real height to measure against. Every flex ancestor between here and it
    // needs `min-h-0` too — a flex item's floor is its content, so without it
    // the body grows instead of scrolling and the header stops being sticky.
    <div className="flex h-screen">
      <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-sidebar-border border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-4 py-4 font-semibold">
          <FileText className="size-5" aria-hidden />
          Engrafo
        </div>
        <nav className="flex flex-col gap-1 px-2" aria-label="Main">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass(false)}>
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-end gap-1 px-4 py-3">
          <SignOutButton />
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Only earns its height where the sidebar is gone: on a wide screen the
            controls live in the sidebar and this would be an empty bar. */}
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:hidden">
          <MobileNav />
          <div className="flex items-center gap-1">
            <SignOutButton />
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
