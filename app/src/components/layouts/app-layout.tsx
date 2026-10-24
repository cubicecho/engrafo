import { useLinkClickHandler, useMatch } from 'react-router';
import { LogOut } from '@/components/domain/app-icons';
import { ArchiveSidebarSection } from '@/components/domain/archive-sidebar';
import { SavedSearchesSidebarSection } from '@/components/domain/saved-searches';
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Button } from '@/components/ui/button';
import { FileText, type IconProps, Settings, Trash2 } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { ROUTES } from '@/lib/routes';
import { useSignOut } from '@/lib/sign-out';
import { useTrashCount } from '@/lib/trash';
import type { SlotNode } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  end: boolean;
  /** Where the sidebar draws it: with the places, or at the foot with sign-out, as cubeui apps put Settings. */
  placement: 'main' | 'footer';
  /** Whether the row wears the trash's count. */
  counted?: boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  // `end` so "Documents" is not also marked active on /documents/:id — that
  // route is a document, not the list, and two lit rows read as a bug.
  { to: ROUTES.documents, label: 'Documents', icon: FileText, end: true, placement: 'main' },
  { to: ROUTES.trash, label: 'Trash', icon: Trash2, end: true, placement: 'main', counted: true },
  { to: ROUTES.settings, label: 'Settings', icon: Settings, end: false, placement: 'footer' },
];

const MAIN_ITEMS = NAV_ITEMS.filter((item) => item.placement === 'main');
const FOOTER_ITEMS = NAV_ITEMS.filter((item) => item.placement === 'footer');

/**
 * react-router hands out a click handler rather than a link to wrap the row in,
 * so the row keeps its own `href` and takes the handler beside it.
 */
function useNavLink({ to, end }: NavItem) {
  const onClick = useLinkClickHandler<HTMLButtonElement>(to);
  const active = useMatch({ path: to, end }) !== null;
  return { href: to, onClick, active };
}

/** One row of the nav, with the count it wears, if any. */
interface NavLinkProps {
  item: NavItem;
  count?: number | undefined;
}

function RailLink({ item, count }: NavLinkProps) {
  const Icon = item.icon;
  return <SidebarNavItem {...useNavLink(item)} label={item.label} iconSlot={<Icon />} count={count} />;
}

function BarLink({ item, count }: NavLinkProps) {
  const Icon = item.icon;
  return <BarNavItem {...useNavLink(item)} label={item.label} iconSlot={<Icon />} count={count} />;
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 font-semibold text-foreground">
      <FileText className="size-5" aria-hidden />
      <span>Engrafo</span>
    </div>
  );
}

interface AppLayoutProps {
  /** The page to draw beside the sidebar. It is given a real height to scroll within. */
  contentSlot: SlotNode;
}

/**
 * The shell around every signed-in page: cubeui's `Sidebar` on the left, the
 * page on the right, and under `md` a bar over the page in the sidebar's place.
 *
 * This owns what `PageLayout` deliberately does not: the navigation, the theme
 * control and signing out. Pages own their own headers and keep using
 * `PageLayout` inside this.
 */
export function AppLayout({ contentSlot }: AppLayoutProps) {
  const signOut = useSignOut();
  // Refetched by name after every delete, restore and purge, so it needs no poll of its own.
  const trashCount = useTrashCount();
  const countOf = (item: NavItem) => (item.counted ? trashCount : undefined);

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
          // Wider than the rail's default, for the archive's tree.
          className="w-80"
          headerSlot={<Brand />}
          contentSlot={
            <>
              <SidebarSection
                as="nav"
                label="Main"
                contentSlot={MAIN_ITEMS.map((item) => <RailLink key={item.to} item={item} count={countOf(item)} />)}
              />
              <ArchiveSidebarSection />
              <SavedSearchesSidebarSection />
            </>
          }
          footerSlot={
            <>
              {FOOTER_ITEMS.map((item) => (
                <RailLink key={item.to} item={item} />
              ))}
              <ThemePicker variant="compact" />
              <SidebarNavItem label="Sign out" iconSlot={<LogOut />} onClick={signOut} />
            </>
          }
        />
      }
      navLabel="Main"
      // The bar has no foot, so every place is an icon in it, Settings included.
      navSlot={NAV_ITEMS.map((item) => <BarLink key={item.to} item={item} count={countOf(item)} />)}
      // No theme picker in the bar: the compact one is 130px wide and pushes the bar past a 320px
      // viewport. On a phone the theme is one tap away, on the Settings screen.
      actionSlot={
        <Button aria-label="Sign out" variant="outline" size="icon-sm" iconSlot={<LogOut />} onClick={signOut} />
      }
      contentSlot={<main className="flex min-h-0 min-w-0 flex-1 flex-col">{contentSlot}</main>}
    />
  );
}
