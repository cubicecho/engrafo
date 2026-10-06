import { LogOut } from 'lucide-react';
import { useLinkClickHandler, useMatch, useNavigate } from 'react-router';
import { ActionButton } from '@/components/action-button';
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { FileText, type IconProps, Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken } from '@/lib/auth';
import type { SlotNode } from '@/lib/utils';

/**
 * The shell around every signed-in page: cubeui's `Sidebar` on the left, the
 * page on the right, and under `md` a bar over the page in the sidebar's place.
 *
 * This owns what `PageLayout` deliberately does not: the navigation, the theme
 * control and signing out. Pages own their own headers and keep using
 * `PageLayout` inside this.
 */

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  end: boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  // `end` so "Documents" is not also marked active on /documents/:id — that
  // route is a document, not the list, and two lit rows read as a bug.
  { to: '/', label: 'Documents', icon: FileText, end: true },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

/**
 * react-router hands out a click handler rather than a link to wrap the row in,
 * so the row keeps its own `href` and takes the handler beside it.
 */
function useNavLink({ to, end }: NavItem) {
  const onClick = useLinkClickHandler<HTMLButtonElement>(to);
  const active = useMatch({ path: to, end }) !== null;
  return { href: to, onClick, active };
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return <SidebarNavItem {...useNavLink(item)} label={item.label} iconSlot={<Icon />} />;
}

function BarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return <BarNavItem {...useNavLink(item)} label={item.label} iconSlot={<Icon />} />;
}

function useSignOut() {
  const navigate = useNavigate();
  return () => {
    clearToken();
    navigate('/login', { replace: true });
  };
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 font-semibold text-foreground">
      <FileText className="size-5" aria-hidden />
      <span>Engrafo</span>
    </div>
  );
}

export function AppLayout({ contentSlot }: { contentSlot: SlotNode }) {
  const signOut = useSignOut();

  return (
    // `h-svh`, not `min-h-svh`: PageLayout is a sticky chassis that scrolls its
    // own body, and it can only do that if something above it has a real height
    // to measure against.
    <SidebarLayout
      className="h-svh"
      sidebarPosition="start"
      sidebarWidth="auto"
      sidebarHideBelow="md"
      divider="none"
      sidebarSlot={
        <Sidebar
          headerSlot={<Brand />}
          contentSlot={
            <SidebarSection
              as="nav"
              label="Main"
              contentSlot={NAV_ITEMS.map((item) => <RailLink key={item.to} item={item} />)}
            />
          }
          footerSlot={
            <>
              <ThemePicker variant="compact" />
              <SidebarNavItem label="Sign out" iconSlot={<LogOut />} onClick={signOut} />
            </>
          }
        />
      }
      navLabel="Main"
      navSlot={NAV_ITEMS.map((item) => <BarLink key={item.to} item={item} />)}
      // No theme picker in the bar: the compact one is 130px wide and pushes the bar past a 320px
      // viewport. On a phone the theme is one tap away, on the Settings screen.
      actionSlot={
        <ActionButton label="Sign out" variant="outline" size="icon-sm" iconSlot={<LogOut />} onClick={signOut} />
      }
      contentSlot={<main className="flex min-h-0 min-w-0 flex-1 flex-col">{contentSlot}</main>}
    />
  );
}
