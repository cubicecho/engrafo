import type { CSSProperties } from "react";
import { DayPicker, getDefaultClassNames, type PropsBase } from "react-day-picker";
import type { CalendarProps } from "@/components/ui/calendar-base";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";

/**
 * react-day-picker's colour variables, pointed at the theme tokens. Its stylesheet ships them as
 * `blue`, `#f0f0ff` and `white`, so without this the chevrons, today and the selected ring are
 * blue on every theme, dark included. The tokens are read live, so `.dark` needs nothing more.
 *
 * An inline style rather than a class, and here rather than in the `tokens` item. `style.css`
 * declares these on `.rdp-root` unlayered, and an unlayered rule beats everything in
 * `@layer utilities`, so a `[--rdp-accent-color:…]` class would lose in a DOM app. And this file
 * is what renders on both paths, a DOM app on `tokens.web.css` and an Expo web app on
 * `cubeui-tokens.css`, which define the same `--active`, `--neutral` and `--hover`.
 */
const THEME = {
  "--rdp-accent-color": "var(--active)",
  "--rdp-accent-background-color": "var(--hover)",
  // Today is current, so it is `active`. It was `neutral`, 1.1:1 against the other days' ink.
  "--rdp-today-color": "var(--active)",
  // A picked day is filled (below), not ringed.
  "--rdp-selected-border": "2px solid transparent",
  // A range is chosen, so its inside is the chosen-row tint, `active` at /40 — what
  // `bg-active/40` compiles to. It was `hover`, which reads as a hover that stuck.
  "--rdp-range_middle-background-color": "color-mix(in oklab, var(--active) 40%, transparent)",
  "--rdp-weekday-opacity": "1",
  "--rdp-range_middle-color": "var(--foreground)",
  "--rdp-range_start-color": "var(--active-foreground)",
  "--rdp-range_start-date-background-color": "var(--active)",
  "--rdp-range_end-color": "var(--active-foreground)",
  "--rdp-range_end-date-background-color": "var(--active)",
} as CSSProperties;

/**
 * A day under the pointer or the keyboard. The library's stylesheet draws neither, and its
 * unlayered `background: none` beats a utility, so these are `!important`. The ends of a range are
 * left alone: their fill is `active`, and says more than a hover does.
 */
const DAY_BUTTON_CLASS = cn(
  getDefaultClassNames().day_button,
  "focus-visible:outline-none",
  "[:not(.rdp-range_start,.rdp-range_end,.rdp-selected:not(.rdp-range_middle))>&]:hover:bg-hover!",
  "[:not(.rdp-range_start,.rdp-range_end,.rdp-selected:not(.rdp-range_middle))>&]:focus-visible:bg-hover!",
  // A picked day has no hover look of its own; focused, it looks hovered, as everything does.
  "[.rdp-selected:not(.rdp-range_middle)>&]:focus-visible:bg-hover!",
  "[.rdp-selected:not(.rdp-range_middle)>&]:focus-visible:text-foreground!",
);

const DEFAULTS = getDefaultClassNames();

/**
 * The parts react-day-picker's stylesheet sizes off the scale, put on it, and the picked day
 * filled as native's is. Each keeps its default class, which the rules above select on. `!` for
 * the same reason as above: the stylesheet is unlayered.
 */
const CLASS_NAMES = {
  day_button: DAY_BUTTON_CLASS,
  // The library sets `large` and bold here: the picked day stays the size and weight of the rest.
  selected: cn(
    DEFAULTS.selected,
    "text-sm! font-normal!",
    "[&:not(.rdp-range_middle)>button]:bg-active! [&:not(.rdp-range_middle)>button]:text-active-foreground!",
  ),
  // Not colour alone: today is semibold as well.
  today: cn(DEFAULTS.today, "font-semibold"),
  month_caption: cn(DEFAULTS.month_caption, "text-sm! font-semibold!"),
  weekday: cn(DEFAULTS.weekday, "text-xs! font-normal! text-foreground/60"),
  // The arrows were drawn in the accent, `active`, which means chosen.
  chevron: cn(DEFAULTS.chevron, "fill-foreground!"),
};

/** What `DayPicker` takes beyond the shared contract, passed through as it is. */
type DayPickerExtras = Omit<
  PropsBase,
  | "disabled"
  | "defaultMonth"
  | "numberOfMonths"
  | "startMonth"
  | "weekStartsOn"
  | "className"
  | "mode"
  | "selected"
  | "onSelect"
  | "required"
>;

/** A month grid for picking one day or a range of days. */
export function Calendar(props: CalendarProps & DayPickerExtras) {
  const {
    mode: _mode,
    selected: _selected,
    onSelect: _onSelect,
    disabled,
    defaultMonth,
    numberOfMonths,
    startMonth,
    weekStartsOn,
    className,
    style,
    ...extras
  } = props;

  // Spread rather than passed: under `exactOptionalPropertyTypes` an explicit
  // `undefined` is not the same as an absent prop, and react-day-picker reads
  // several of these as "the caller set this".
  const shared = {
    ...extras,
    ...(disabled === undefined ? {} : { disabled }),
    ...(defaultMonth === undefined ? {} : { defaultMonth }),
    ...(numberOfMonths === undefined ? {} : { numberOfMonths }),
    ...(startMonth === undefined ? {} : { startMonth }),
    ...(weekStartsOn === undefined ? {} : { weekStartsOn }),
    className: cn("p-3 text-sm", className),
    classNames: { ...CLASS_NAMES, ...extras.classNames },
    // The caller's style last, so a call site can still override any of them.
    style: { ...THEME, ...style },
  };

  if (props.mode === "range") {
    return (
      <DayPicker
        mode="range"
        {...shared}
        {...(props.selected === undefined ? {} : { selected: props.selected })}
        onSelect={props.onSelect}
      />
    );
  }

  return (
    <DayPicker
      mode="single"
      {...shared}
      {...(props.selected === undefined ? {} : { selected: props.selected })}
      onSelect={props.onSelect}
    />
  );
}
