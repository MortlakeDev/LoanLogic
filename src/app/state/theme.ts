// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { computed, effect, signal } from '@preact/signals';
import { createStorageSlot } from '../storage';

/** Theme choices offered to the user, in switcher order. */
export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** The theme actually applied to the page (`<html data-theme>`). */
export type Theme = 'dark' | 'light';

/** Type guard for stored theme preferences. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

const themeSlot = createStorageSlot<ThemePreference>('theme', 1, isThemePreference);

/**
 * Storage key of the theme preference. The inline script in index.html reads the same
 * key before first paint; a unit test keeps the two in sync.
 */
export const THEME_STORAGE_KEY = themeSlot.key;

// Dark-first: light is used only when the system explicitly asks for it.
const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * The window's `prefers-color-scheme: light` query, or `undefined` when there is no window
 * or it has no `matchMedia` (jsdom, for one, does not implement it).
 */
function lightMedia(win: Window | undefined): MediaQueryList | undefined {
  return typeof win?.matchMedia === 'function' ? win.matchMedia(LIGHT_QUERY) : undefined;
}

/** The user's choice: follow the system, or a fixed theme. */
export const themePreference = signal<ThemePreference>(themeSlot.read() ?? 'system');

/** The operating system's current color scheme. */
export const systemTheme = signal<Theme>(
  lightMedia(typeof window === 'undefined' ? undefined : window)?.matches === true
    ? 'light'
    : 'dark',
);

/** The theme in effect. */
export const theme = computed<Theme>(() =>
  themePreference.value === 'system' ? systemTheme.value : themePreference.value,
);

/** Changes the theme choice and remembers it. */
export function setThemePreference(next: ThemePreference): void {
  themePreference.value = next;
  themeSlot.write(next);
}

/**
 * Applies the theme to `<html data-theme>` and follows live system changes while the
 * preference is "system". Returns a function that stops syncing.
 */
export function syncDocumentTheme(win: Window = window): () => void {
  const media = lightMedia(win);
  const onChange = (event: MediaQueryListEvent): void => {
    systemTheme.value = event.matches ? 'light' : 'dark';
  };
  if (media !== undefined) {
    systemTheme.value = media.matches ? 'light' : 'dark';
    media.addEventListener('change', onChange);
  }
  const stop = effect(() => {
    win.document.documentElement.dataset.theme = theme.value;
  });
  return () => {
    media?.removeEventListener('change', onChange);
    stop();
  };
}
