/**
 * Light/dark theme.
 *
 * `index.html` applies the initial class before first paint — a stored
 * preference if there is one, else the OS preference. That has to happen in the
 * document head rather than here: React mounts after the first paint, so
 * deciding it in a component is a white flash on every load for anyone using
 * dark mode.
 *
 * This module owns changes after that. Toggling stores an explicit preference;
 * clearing the key would fall back to the OS on the next load.
 */

export const THEME_STORAGE_KEY = 'engrafo-theme';

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function setDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    // Storage blocked. The class is already set, so the choice holds for this
    // page; it just will not be remembered.
  }
}
