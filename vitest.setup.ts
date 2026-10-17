import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements the document but not much of the window around it. These
// are what Radix, the auth token and the theme reach for; without them a
// component test fails on a missing global rather than on the thing it is
// testing.

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Node 24 defines a `localStorage` global of its own, which is inert without
// `--localstorage-file` and which shadows the one jsdom builds — so in here
// `window.localStorage` is `undefined` rather than a Storage. Anything that
// remembers something on the device (the auth token, the theme) would then only
// ever exercise its storage-unavailable branch. This is a Storage in the ways a
// test cares about: it holds strings, it survives across a test, and a test can
// spy on a method of it to make that method throw.
if (!window.localStorage) {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Radix's popovers and dialogs ask an element whether it has pointer capture
// and then scroll it into view. jsdom has neither, and both are no-ops for a
// test that only asks what is on screen.
if (Element.prototype.hasPointerCapture === undefined) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Explicit rather than relying on the auto-cleanup that only runs when the
// globals are injected: the two must not be able to drift apart.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // A device preference outlives the test that set it otherwise, and the next
  // one reads it as its own starting state.
  window.localStorage.clear();
});
