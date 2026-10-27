import type { ReactNode } from "react";
import { IconClassContext } from "@/components/ui/icons-base";
import { cn, type SlotNode } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type StatTileProps = {
  /** What the figure is called: "Turns", "Daily average". Drawn above it, muted. */
  label: ReactNode;
  /**
   * The figure: a string or a number, drawn large in tabular numerals so a row of tiles lines up
   * as it ticks. A node works too — a `ColorDot` beside a category's name — and is placed as is.
   */
  value: ReactNode;
  /**
   * One muted line under the figure: what it is out of, or where it comes from — "over 7 days",
   * "schema v4". Read after the value, as part of the tile.
   */
  hint?: ReactNode | undefined;
  /** Before the label. A bare `<Clock />`; the tile sizes it and mutes it. */
  iconSlot?: SlotNode | undefined;
  /**
   * Whether the figure is still being fetched. On, a bar stands in for the value and the label
   * stays — the tile is as tall as it will be, so a row of them does not jump when the data lands.
   */
  loading?: boolean | undefined;
  /**
   * Makes the whole tile a button: a filter to toggle, a page to open. The tile's text is its
   * accessible name, so a count and its label are read together.
   */
  onClick?: (() => void) | undefined;
  /**
   * With `onPress`, the tile is a toggle and this is whether it is on — the filter tile over a
   * list. Left out, the tile is a plain button. Without `onPress` it is ignored.
   */
  selected?: boolean | undefined;
  className?: string | undefined;
  /** The figure's class: the colour a count takes when it is one worth noticing. */
  valueClassName?: string | undefined;
};

/** The icon's box: sized from outside on the web, and by `IconClassContext` on device. */
const ICON_BOX = cn("shrink-0", "[&_svg]:size-4 [&_svg]:shrink-0");

/** A bar standing in for the figure — `Skeleton`'s look, on both platforms, at one line of it. */
const BAR = cn("h-8 w-20 rounded-md bg-foreground/10", "animate-pulse");

/**
 * What a pressable tile adds on the web: a compiled `Pressable` is a `<button>`, which centres its
 * text and draws no focus ring of its own. None of it is a class the device can read.
 */
const PRESSABLE =
  "text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";

/**
 * A wrapper around a caller's node, not layout of its own: a block box on the web, where a compiled
 * view would otherwise be a flex column and lay a dot and a name out as two rows.
 */
const SLOT = "block";

/**
 * One number on a card: a label, the figure and a hint, pressable as a filter when given `onPress`.
 */
export function StatTile({
  label,
  value,
  hint,
  iconSlot,
  loading = false,
  onClick: onPress,
  selected,
  className,
  valueClassName,
}: StatTileProps) {
  const toggle = onPress !== undefined && selected !== undefined;
  // The pressed state in each platform's spelling. react-native-web forwards `aria-*` and drops
  // `accessibilityState`; the device reads `accessibilityState` and has no `aria-pressed`.
  const pressedState = { "aria-pressed": selected };
  const pressed = toggle ? pressedState : {};

  // The label, hint and icon. A selected tile keeps its card fill and is marked by its border
  // alone, so this ink is the same whether or not it is chosen.
  const ink = "text-foreground/60";
  const classes = cn(
    "min-w-0 gap-1 p-4",
    onPress !== undefined && PRESSABLE,
    toggle && selected && "border-active",
    className,
  );

  const figure =
    typeof value === "string" || typeof value === "number" ? (
      <span
        data-slot="stat-tile-value"
        className={cn(
          "cube-rn-text",
          "font-semibold text-2xl text-foreground tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </span>
    ) : (
      <div
        data-slot="stat-tile-value"
        className={cn("cube-rn-view", SLOT, "min-w-0", valueClassName)}
      >
        {value}
      </div>
    );

  const body = (
    <>
      <div
        data-slot="stat-tile-label-row"
        className="cube-rn-view min-w-0 flex-row items-center gap-2"
      >
        {iconSlot ? (
          <div data-slot="stat-tile-icon" aria-hidden className={cn("cube-rn-view", ICON_BOX, ink)}>
            <IconClassContext.Provider value={cn("size-4 shrink-0", ink)}>
              {iconSlot}
            </IconClassContext.Provider>
          </div>
        ) : null}
        <span
          data-slot="stat-tile-label"
          // Normal weight, as PropertyRow's label: the label supports the figure under it, and
          // a grey semibold label competed with it.
          className={cn("cube-rn-text", "min-w-0 flex-1 truncate text-sm", ink)}
        >
          {label}
        </span>
      </div>
      {loading ? (
        <div data-slot="stat-tile-skeleton" aria-hidden className={cn("cube-rn-view", BAR)} />
      ) : (
        figure
      )}
      {hint ? (
        <span data-slot="stat-tile-hint" className={cn("cube-rn-text", "text-xs", ink)}>
          {hint}
        </span>
      ) : null}
    </>
  );

  // `Card` is the one that turns into a `Pressable` when it is handed `onPress`, and stays a view
  // when it is handed `undefined` — so a tile nobody can press is not a button.
  return (
    <Card
      data-slot="stat-tile"
      onClick={onPress}
      aria-busy={loading || undefined}
      className={classes}
      {...pressed}
    >
      {body}
    </Card>
  );
}
