import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements the document but not much of the window around it. These
// four are what Radix and the theme script reach for; without them a component
// test fails on a missing global rather than on the thing it is testing.

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
if (!Element.prototype.hasPointerCapture) {
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
});
