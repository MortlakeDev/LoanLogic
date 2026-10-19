// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { blockLocalStorage, createColorScheme, createMemoryStorage } from './__tests__/fakes';
import { THEME_PREFERENCES, THEME_STORAGE_KEY } from './state/theme';

/**
 * The inline script in index.html applies the theme before first paint. It cannot import
 * the app's modules, so these tests run it in isolation and pin it to src/app/state/theme.ts.
 */

const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
const inlineScripts = [...parsed.head.querySelectorAll('script')].filter(
  (script) => !script.hasAttribute('src') && script.type !== 'module',
);
const bootScript = inlineScripts[0]?.textContent ?? '';

/** What the boot script reads: `window.localStorage` and `window.matchMedia`. */
interface BootEnvironment {
  readonly localStorage?: Storage;
  readonly matchMedia?: (query: string) => MediaQueryList;
}

/**
 * The boot script compiled as a function of `window` and `document`, so each test can hand
 * it a fake environment and a fresh document. The source is static, trusted text from
 * index.html; executing it is the point of the test.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const executeBootScript = new Function('window', 'document', bootScript) as (
  win: BootEnvironment,
  doc: Document,
) => void;

type StoredCase = { readonly kind: 'none' } | { readonly kind: 'raw'; readonly raw: string };

interface BootCase {
  readonly title: string;
  readonly stored: StoredCase | { readonly kind: 'blocked' };
  /** `undefined` means `matchMedia` is missing. */
  readonly prefersLight: boolean | undefined;
  readonly expected: 'dark' | 'light';
}

/** Runs the boot script against a fresh document and returns the theme it applied. */
function runBootScript(env: {
  readonly stored: BootCase['stored'];
  readonly prefersLight: boolean | undefined;
}): string | null {
  const storage = createMemoryStorage(
    env.stored.kind === 'raw' ? { [THEME_STORAGE_KEY]: env.stored.raw } : {},
  );
  const win: BootEnvironment = {};
  Object.defineProperty(win, 'localStorage', {
    /** Throws like a browser that blocks storage; otherwise returns the in-memory storage. */
    get(): Storage {
      if (env.stored.kind === 'blocked') {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
      return storage;
    },
  });
  if (env.prefersLight !== undefined) {
    Object.defineProperty(win, 'matchMedia', {
      value: createColorScheme(env.prefersLight).matchMedia,
    });
  }
  const doc = document.implementation.createHTMLDocument('boot');
  doc.documentElement.removeAttribute('data-theme');
  executeBootScript(win, doc);
  return doc.documentElement.getAttribute('data-theme');
}

/**
 * Storage holding exactly `value` under the theme key, not JSON-encoded, so a case can plant
 * corrupt or unquoted text.
 */
const raw = (value: string): StoredCase => ({ kind: 'raw', raw: value });

const CASES: readonly BootCase[] = [
  { title: 'stored "light"', stored: raw('"light"'), prefersLight: false, expected: 'light' },
  { title: 'stored "dark"', stored: raw('"dark"'), prefersLight: true, expected: 'dark' },
  {
    title: 'stored "system", OS light',
    stored: raw('"system"'),
    prefersLight: true,
    expected: 'light',
  },
  {
    title: 'stored "system", OS dark',
    stored: raw('"system"'),
    prefersLight: false,
    expected: 'dark',
  },
  {
    title: 'corrupt JSON, OS light',
    stored: raw('{"light'),
    prefersLight: true,
    expected: 'light',
  },
  { title: 'corrupt JSON, OS dark', stored: raw('{"light'), prefersLight: false, expected: 'dark' },
  {
    title: 'unknown value, OS light',
    stored: raw('"sepia"'),
    prefersLight: true,
    expected: 'light',
  },
  { title: 'unquoted value', stored: raw('light'), prefersLight: false, expected: 'dark' },
  {
    title: 'nothing stored, OS light',
    stored: { kind: 'none' },
    prefersLight: true,
    expected: 'light',
  },
  {
    title: 'nothing stored, OS dark',
    stored: { kind: 'none' },
    prefersLight: false,
    expected: 'dark',
  },
  {
    title: 'storage blocked, OS light',
    stored: { kind: 'blocked' },
    prefersLight: true,
    expected: 'light',
  },
  {
    title: 'storage blocked, OS dark',
    stored: { kind: 'blocked' },
    prefersLight: false,
    expected: 'dark',
  },
  {
    title: 'no matchMedia, "system"',
    stored: raw('"system"'),
    prefersLight: undefined,
    expected: 'dark',
  },
  {
    title: 'no matchMedia, nothing stored',
    stored: { kind: 'none' },
    prefersLight: undefined,
    expected: 'dark',
  },
  {
    title: 'no matchMedia, stored "light"',
    stored: raw('"light"'),
    prefersLight: undefined,
    expected: 'light',
  },
];

describe('index.html theme boot script', () => {
  it('is a single classic inline script in <head>, ahead of the app module', () => {
    expect(inlineScripts).toHaveLength(1);
    expect(bootScript.trim()).not.toBe('');
    const moduleScript = parsed.querySelector('script[type="module"]');
    expect(moduleScript).not.toBeNull();
    expect(parsed.head.contains(moduleScript)).toBe(false);
  });

  it('reads the storage key defined in src/app/state/theme.ts', () => {
    expect(bootScript).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('accepts exactly the stored values of THEME_PREFERENCES', () => {
    const accepted = [...bootScript.matchAll(/stored === '([^']*)'/g)].map((match) => match[1]);
    expect([...accepted].sort()).toEqual([...THEME_PREFERENCES].sort());
  });

  it.each(CASES)('$title → data-theme="$expected"', ({ stored, prefersLight, expected }) => {
    expect(runBootScript({ stored, prefersLight })).toBe(expected);
  });

  it('asks matchMedia only when following the system', () => {
    const scheme = createColorScheme(true);
    const storage = createMemoryStorage({ [THEME_STORAGE_KEY]: '"dark"' });
    executeBootScript(
      { localStorage: storage, matchMedia: scheme.matchMedia },
      document.implementation.createHTMLDocument(''),
    );
    expect(scheme.queries).toEqual([]);
  });
});

describe('boot script and theme.ts agree', () => {
  const restores: (() => void)[] = [];

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restores.splice(0).forEach((restore) => {
      restore();
    });
  });

  it('queries the same media feature as theme.ts', async () => {
    const scheme = createColorScheme(true);
    vi.stubGlobal('matchMedia', scheme.matchMedia);
    vi.resetModules();
    const module = await import('./state/theme');
    restores.push(module.syncDocumentTheme());
    const appQueries = new Set(scheme.queries);

    const bootScheme = createColorScheme(true);
    executeBootScript(
      { localStorage: createMemoryStorage(), matchMedia: bootScheme.matchMedia },
      document.implementation.createHTMLDocument(''),
    );
    expect(new Set(bootScheme.queries)).toEqual(appQueries);
  });

  it.each(CASES)(
    '$title: the first paint matches the app theme',
    async ({ stored, prefersLight }) => {
      if (stored.kind === 'raw') {
        localStorage.setItem(THEME_STORAGE_KEY, stored.raw);
      }
      if (stored.kind === 'blocked') {
        restores.push(blockLocalStorage());
      }
      if (prefersLight !== undefined) {
        vi.stubGlobal('matchMedia', createColorScheme(prefersLight).matchMedia);
      }
      vi.resetModules();
      const { theme } = await import('./state/theme');

      expect(runBootScript({ stored, prefersLight })).toBe(theme.value);
    },
  );
});
