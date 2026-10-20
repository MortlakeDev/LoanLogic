// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { APP_NAME } from '../../src/config.ts';
import {
  collectPageErrors,
  expectTheme,
  languageSelect,
  message,
  panels,
  waitForFonts,
} from './helpers.ts';

const SINGLE_FILE_URL = new URL('../../dist-single/LoanLogic.html', import.meta.url);
const SINGLE_FILE_PATH = fileURLToPath(SINGLE_FILE_URL);

// Schemes that never touch the network.
const LOCAL_PROTOCOLS: ReadonlySet<string> = new Set(['file:', 'data:', 'blob:', 'about:']);

interface WebFontState {
  /** First family of the body font stack (the self-hosted UI font). */
  readonly family: string;
  /** `@font-face` rules declared for that family. */
  readonly declared: number;
  /** Faces of that family that finished loading. */
  readonly loaded: number;
  /** Loaded faces whose `unicode-range` covers every letter of the sample text. */
  readonly loadedForSample: number;
}

/**
 * Inspects the primary UI font (whatever the design tokens name first, so the test does
 * not depend on the placeholder font) and which of its faces are loaded.
 */
async function webFontState(page: Page, sample: string): Promise<WebFontState> {
  return page.evaluate((text) => {
    /** Trims a family name and drops a quote at either end, so quoted and bare spellings match. */
    const unquote = (name: string): string => name.trim().replace(/^["']|["']$/g, '');
    const family = unquote(getComputedStyle(document.body).fontFamily.split(',')[0] ?? '');
    /**
     * Whether a `unicode-range` value (comma-separated `U+20`, `U+0-7F` or wildcard `U+4??`
     * entries) includes the code point; entries it cannot parse count as not covering.
     */
    const covers = (range: string, codePoint: number): boolean =>
      range.split(',').some((part) => {
        const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
        if (match === null) {
          return false;
        }
        const first = match[1] ?? '';
        const low = Number.parseInt(first.replace(/\?/g, '0'), 16);
        const high = Number.parseInt(match[2] ?? first.replace(/\?/g, 'F'), 16);
        return codePoint >= low && codePoint <= high;
      });
    // Letters only: spaces and punctuation are served by whichever subset has them.
    const codePoints = Array.from(
      text.matchAll(/\p{L}/gu),
      ([letter]) => letter.codePointAt(0) ?? 0,
    );
    const faces = [...document.fonts].filter((face) => unquote(face.family) === family);
    const loaded = faces.filter((face) => face.status === 'loaded');
    return {
      family,
      declared: faces.length,
      loaded: loaded.length,
      loadedForSample: loaded.filter((face) =>
        codePoints.every((codePoint) => covers(face.unicodeRange, codePoint)),
      ).length,
    };
  }, sample);
}

test.use({ locale: 'en-US', colorScheme: 'dark' });

test.describe('single-file build (dist-single/LoanLogic.html)', () => {
  test.skip(
    !existsSync(SINGLE_FILE_PATH),
    `${SINGLE_FILE_PATH} does not exist; run "npm run build:single" first (npm run e2e does)`,
  );

  test('opens from file:// offline, with its web font, and switches language', async ({
    context,
    page,
  }) => {
    // Every request that could reach the network is recorded and refused.
    const network: string[] = [];
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (LOCAL_PROTOCOLS.has(new URL(url).protocol)) {
        await route.continue();
        return;
      }
      network.push(url);
      await route.abort('internetdisconnected');
    });
    context.on('request', (request) => {
      const url = request.url();
      if (!LOCAL_PROTOCOLS.has(new URL(url).protocol) && !network.includes(url)) {
        network.push(url);
      }
    });
    const errors = collectPageErrors(page);

    await page.goto(SINGLE_FILE_URL.href);
    expect(new URL(page.url()).protocol).toBe('file:');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(APP_NAME);
    const { parameters, results } = panels(page);
    await expect(parameters).toBeVisible();
    await expect(results).toBeVisible();
    await expect(page).toHaveTitle(message('en', 'meta.title'));
    await expectTheme(page, 'dark');

    // Everything is inline: no external scripts, stylesheets or images.
    const external = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[rel="stylesheet"], img[src]')].map(
        (element) => element.outerHTML.slice(0, 120),
      ),
    );
    expect(external, 'elements loading separate files').toEqual([]);

    await waitForFonts(page);
    const latin = await webFontState(page, message('en', 'panels.parameters.title'));
    test.info().annotations.push({ type: 'UI font', description: latin.family });
    expect(latin.family, 'the body uses a named font family').not.toBe('');
    expect(latin.declared, `${latin.family} @font-face rules are embedded`).toBeGreaterThan(0);
    expect(
      latin.loadedForSample,
      `a ${latin.family} face for Latin text is loaded`,
    ).toBeGreaterThan(0);

    await languageSelect(page, 'en').selectOption('uk');
    await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
    await expect(page).toHaveTitle(message('uk', 'meta.title'));
    await expect(panels(page, 'uk').parameters).toBeVisible();
    await expect(panels(page, 'uk').results).toBeVisible();
    // Cyrillic text loads another subset of the same font, still without the network.
    await expect
      .poll(
        async () =>
          (await webFontState(page, message('uk', 'panels.parameters.title'))).loadedForSample,
        { message: `a ${latin.family} face for Cyrillic text is loaded` },
      )
      .toBeGreaterThan(0);

    expect(network, 'network requests attempted by the single-file build').toEqual([]);
    expect(errors, 'console errors and uncaught exceptions').toEqual([]);
  });
});
