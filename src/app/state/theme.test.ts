// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockLocalStorage, createColorScheme, type FakeColorScheme } from '../__tests__/fakes';
import type * as ThemeModule from './theme';

const KEY = 'loanlogic:theme:v1';

const disposers: (() => void)[] = [];

/** Installs a fake system color scheme as `window.matchMedia` for this test. */
function installColorScheme(prefersLight: boolean): FakeColorScheme {
  const scheme = createColorScheme(prefersLight);
  vi.stubGlobal('matchMedia', scheme.matchMedia);
  return scheme;
}

/** Imports a fresh copy of the module, so its import-time reads see the prepared globals. */
async function loadTheme(): Promise<typeof ThemeModule> {
  vi.resetModules();
  return import('./theme');
}

/** Starts document syncing and stops it after the test. */
function sync(module: typeof ThemeModule): () => void {
  const stop = module.syncDocumentTheme();
  disposers.push(stop);
  return stop;
}

/** The theme on `<html data-theme>`, or `undefined` while none has been applied. */
function documentTheme(): string | undefined {
  return document.documentElement.dataset.theme;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  disposers.splice(0).forEach((stop) => {
    stop();
  });
});

describe('theme preference', () => {
  it('lists the switcher choices and guards them', async () => {
    const { THEME_PREFERENCES, isThemePreference } = await loadTheme();
    expect(THEME_PREFERENCES).toEqual(['system', 'dark', 'light']);
    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference)).toBe(true);
    }
    for (const value of ['', 'auto', 'Dark', null, undefined, 1, {}]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });

  it('uses the versioned storage key shared with the boot script', async () => {
    const { THEME_STORAGE_KEY } = await loadTheme();
    expect(THEME_STORAGE_KEY).toBe(KEY);
  });

  it('defaults to "system" when nothing is stored', async () => {
    const { themePreference } = await loadTheme();
    expect(themePreference.value).toBe('system');
  });

  it.each(['system', 'dark', 'light'] as const)(
    'restores the stored preference "%s"',
    async (stored) => {
      localStorage.setItem(KEY, JSON.stringify(stored));
      const { themePreference } = await loadTheme();
      expect(themePreference.value).toBe(stored);
    },
  );

  it.each(['"sepia"', '"Dark"', '1', 'null', '{not json'])(
    'ignores the invalid stored value %s',
    async (raw) => {
      localStorage.setItem(KEY, raw);
      const { themePreference } = await loadTheme();
      expect(themePreference.value).toBe('system');
    },
  );

  it('falls back to "system" when storage is blocked', async () => {
    const restore = blockLocalStorage();
    try {
      const { themePreference, setThemePreference } = await loadTheme();
      expect(themePreference.value).toBe('system');
      expect(() => {
        setThemePreference('light');
      }).not.toThrow();
      expect(themePreference.value).toBe('light');
    } finally {
      restore();
    }
  });

  it('persists the choice as a JSON string under the theme key', async () => {
    const { setThemePreference, themePreference } = await loadTheme();

    setThemePreference('light');
    expect(themePreference.value).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('"light"');

    setThemePreference('system');
    expect(localStorage.getItem(KEY)).toBe('"system"');

    const reloaded = await loadTheme();
    expect(reloaded.themePreference.value).toBe('system');
  });

  it('restores a persisted choice after a reload', async () => {
    (await loadTheme()).setThemePreference('dark');
    const reloaded = await loadTheme();
    expect(reloaded.themePreference.value).toBe('dark');
  });
});

describe('effective theme', () => {
  it('reads the system scheme at import time', async () => {
    installColorScheme(true);
    const light = await loadTheme();
    expect(light.systemTheme.value).toBe('light');
    expect(light.theme.value).toBe('light');

    installColorScheme(false);
    const dark = await loadTheme();
    expect(dark.systemTheme.value).toBe('dark');
    expect(dark.theme.value).toBe('dark');
  });

  it('can be imported where no window exists and then assumes dark', async () => {
    vi.stubGlobal('window', undefined);
    const { systemTheme, theme } = await loadTheme();
    expect(systemTheme.value).toBe('dark');
    expect(theme.value).toBe('dark');
  });

  it('uses a fixed preference regardless of the system scheme', async () => {
    installColorScheme(true);
    const { setThemePreference, theme } = await loadTheme();
    setThemePreference('dark');
    expect(theme.value).toBe('dark');
    setThemePreference('light');
    expect(theme.value).toBe('light');
  });
});

describe('syncDocumentTheme', () => {
  it('sets <html data-theme> from the preference', async () => {
    installColorScheme(false);
    const module = await loadTheme();
    sync(module);
    expect(documentTheme()).toBe('dark');

    module.setThemePreference('light');
    expect(documentTheme()).toBe('light');
    module.setThemePreference('dark');
    expect(documentTheme()).toBe('dark');
  });

  it('follows live system changes while the preference is "system"', async () => {
    const scheme = installColorScheme(false);
    const module = await loadTheme();
    sync(module);
    expect(documentTheme()).toBe('dark');

    scheme.setPrefersLight(true);
    expect(documentTheme()).toBe('light');
    scheme.setPrefersLight(false);
    expect(documentTheme()).toBe('dark');
  });

  it('ignores system changes while a theme is fixed, then catches up on "system"', async () => {
    const scheme = installColorScheme(false);
    const module = await loadTheme();
    sync(module);
    module.setThemePreference('dark');

    scheme.setPrefersLight(true);
    expect(documentTheme()).toBe('dark');

    module.setThemePreference('system');
    expect(documentTheme()).toBe('light');
  });

  it('re-reads the system scheme when syncing starts', async () => {
    const scheme = installColorScheme(false);
    const module = await loadTheme();
    // The scheme changes before anything listens (e.g. between import and startup).
    scheme.setPrefersLight(true);
    expect(module.systemTheme.value).toBe('dark');

    sync(module);
    expect(module.systemTheme.value).toBe('light');
    expect(documentTheme()).toBe('light');
  });

  it('uses the dark theme when matchMedia is unavailable', async () => {
    expect(typeof window.matchMedia).toBe('undefined');
    const module = await loadTheme();
    expect(() => sync(module)).not.toThrow();
    expect(documentTheme()).toBe('dark');

    module.setThemePreference('light');
    expect(documentTheme()).toBe('light');
  });

  it('syncs a window passed explicitly', async () => {
    const module = await loadTheme();
    const scheme = createColorScheme(true);
    const other = document.implementation.createHTMLDocument('other');
    const win = { matchMedia: scheme.matchMedia, document: other } as unknown as Window;

    const stop = module.syncDocumentTheme(win);
    disposers.push(stop);
    expect(other.documentElement.dataset.theme).toBe('light');
    expect(scheme.listenerCount()).toBe(1);
  });

  it('stops syncing and removes its listener when disposed', async () => {
    const scheme = installColorScheme(false);
    const module = await loadTheme();
    const stop = module.syncDocumentTheme();
    expect(scheme.listenerCount()).toBe(1);

    stop();
    expect(scheme.listenerCount()).toBe(0);

    module.setThemePreference('light');
    expect(documentTheme()).toBe('dark');

    module.setThemePreference('system');
    scheme.setPrefersLight(true);
    expect(module.systemTheme.value).toBe('dark');
    expect(documentTheme()).toBe('dark');
  });
});
