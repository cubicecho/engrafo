import { cn, type SlotNode } from "@/lib/utils";
import {
  HeaderContentFooter,
  type HeaderContentFooterWidth,
  PAGE_COLUMN,
  PROSE_COLUMN,
} from "@/components/header-content-footer";

/**
 * The bar's inner row, capped to the same column as the page below it, so the brand sits over the
 * page's first column rather than at the window's edge. The border and the fill stay full-bleed.
 */
const BAR_COLUMNS: Record<HeaderContentFooterWidth, string | undefined> = {
  full: undefined,
  page: PAGE_COLUMN,
  prose: PROSE_COLUMN,
};

/**
 * On the web the document scrolls and the bar sticks to the top of whatever scrolls it — the
 * window, or a pane the app already made scrollable. That is what both sticky bars this replaces
 * did, and it asks nothing of the ancestors: a fixed-height chassis only scrolls once every box up
 * to the viewport has a height, which is the failure a top-level shell is least placed to guard.
 *
 * `sticky` is on the header slot rather than the bar inside it, because a sticky box sticks only
 * within its parent, and the slot is exactly as tall as the bar.
 *
 * Yoga has no `sticky`, so on device the chassis divides the screen instead: the bar stays and the
 * body is a `ScrollView`.
 */
const STICKY = "sticky top-0 z-40";
const SCROLL = false;

const NAV = "min-w-0 flex-1";
const NAV_ROW = "flex-row items-center gap-1";

type NavProps = {
  navSlot: SlotNode;
  label: string | undefined;
  className: string | undefined;
};

/**
 * The navigation, and the bar's one answer to a narrow screen: it scrolls sideways.
 *
 * Every other part of the bar keeps its width — the brand and the actions are `shrink-0` — so the
 * links are what gives when the window runs out, and they give by moving rather than by wrapping
 * the bar to a second line or leaving the screen. A bar that wants the links gone below a width
 * says so with `navClassName="hidden md:flex"` and puts a menu in `actionSlot`, which is the other
 * pattern the survey found; that is one class, not a prop.
 *
 * Written as statements, like `HeaderContentFooter`'s body, because the two arms are different
 * elements: `overflow` scrolls nothing on device.
 */
function Nav({ navSlot, label, className }: NavProps) {
  return (
    <nav
      data-slot="top-bar-layout-nav"
      aria-label={label}
      className={cn("cube-rn-view", NAV, NAV_ROW, "overflow-x-auto", className)}
    >
      {navSlot}
    </nav>
  );
}

export type TopBarLayoutProps = {
  /** The page below the bar. The one part that scrolls. */
  contentSlot: SlotNode;
  /** The bar's start: the logo and the app's name, usually a link home. */
  brandSlot?: SlotNode | undefined;
  /**
   * The primary links, after the brand. Pass the links themselves; the shell draws the `<nav>`
   * around them, which is the part the hand-written bars left out.
   */
  navSlot?: SlotNode | undefined;
  /**
   * What the navigation landmark is called — "Main". Only needed when the page has a second
   * navigation landmark to tell it from.
   */
  navLabel?: string | undefined;
  /** The bar's far end: account, theme, sign out, a menu of the links on a narrow screen. */
  actionSlot?: SlotNode | undefined;
  /**
   * The column the bar's row is held to — `page` by default, `full` for a board that runs to the
   * window's edge. The page below owns its own column (a `PageLayout` has `width` too), so this
   * lines the bar up with it rather than capping it.
   */
  width?: HeaderContentFooterWidth | undefined;
  className?: string | undefined;
  /** On the bar itself: its fill, its border, its height. */
  headerClassName?: string | undefined;
  brandClassName?: string | undefined;
  navClassName?: string | undefined;
  actionClassName?: string | undefined;
  /** On the `<main>` around `contentSlot`. */
  contentClassName?: string | undefined;
};

/**
 * A bar across the top — brand, navigation, actions — over the page.
 *
 * The sibling of `SidebarLayout` + `Sidebar`: the same app shell with the navigation laid across
 * the top rather than down the side, for an app with a handful of top-level pages. A shell with
 * both is a `Sidebar` in a `SidebarLayout`, and this one's `contentSlot` can be that.
 *
 * **Two landmarks, on both halves.** The bar is `role="banner"` (`<header>` on the web) and the
 * page is `role="main"` (`<main>`), so a screen reader's landmark jump lands on the page and skips
 * the chrome. `navSlot` becomes the navigation landmark between them.
 *
 * **The safe area is the app's.** On device the bar is the top of the screen, and the status bar
 * sits over it unless something insets it. Nothing in this registry measures insets and a shell is
 * not the place to add the dependency that does — wrap the app in `react-native-safe-area-context`'s
 * `SafeAreaView edges={["top"]}` (Expo ships it) and this sits inside it.
 */
export function TopBarLayout({
  contentSlot,
  brandSlot,
  navSlot,
  navLabel,
  actionSlot,
  width = "page",
  className,
  headerClassName,
  brandClassName,
  navClassName,
  actionClassName,
  contentClassName,
}: TopBarLayoutProps) {
  const bar = (
    <header
      data-slot="top-bar-layout-header"
      className={cn("cube-rn-view", "border-foreground/10 border-b bg-background", headerClassName)}
    >
      <div
        className={cn(
          "cube-rn-view",
          "min-h-14 flex-row items-center gap-4 px-4 py-2",
          BAR_COLUMNS[width],
        )}
      >
        {brandSlot ? (
          <div
            data-slot="top-bar-layout-brand"
            className={cn("cube-rn-view", "shrink-0 flex-row items-center gap-2", brandClassName)}
          >
            {brandSlot}
          </div>
        ) : null}
        {navSlot ? <Nav navSlot={navSlot} label={navLabel} className={navClassName} /> : null}
        {actionSlot ? (
          // `ml-auto` holds the actions at the end when there is no nav to push them there.
          <div
            data-slot="top-bar-layout-action"
            className={cn(
              "cube-rn-view",
              "ml-auto shrink-0 flex-row items-center gap-2",
              actionClassName,
            )}
          >
            {actionSlot}
          </div>
        ) : null}
      </div>
    </header>
  );

  return (
    <HeaderContentFooter
      headerSlot={bar}
      contentSlot={
        <main
          data-slot="top-bar-layout-content"
          className={cn("cube-rn-view", "min-w-0", contentClassName)}
        >
          {contentSlot}
        </main>
      }
      scroll={SCROLL}
      className={cn(undefined, className)}
      headerClassName={STICKY}
    />
  );
}
