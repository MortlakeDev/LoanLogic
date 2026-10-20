// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test } from '@playwright/test';
import { APP_NAME, LICENSE_ID, LICENSE_URL, SOURCE_CODE_URL } from '../../src/config.ts';
import { collectPageErrors, gotoApp, menuButton, message, panels, themeButton } from './helpers.ts';

// Language and theme are detected from the browser; pin both so the run is deterministic.
test.use({ locale: 'en-US', colorScheme: 'dark' });

test.describe('app shell', () => {
  test('loads without console or page errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await gotoApp(page);
    await expect(page.getByRole('main')).toBeVisible();
    expect(errors, 'console errors and uncaught exceptions').toEqual([]);
  });

  test('makes no requests to other origins', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL ?? 'http://localhost/').origin;
    const requests: string[] = [];
    page.on('request', (request) => {
      requests.push(request.url());
    });
    await gotoApp(page);
    await page.waitForLoadState('networkidle');
    expect(requests.length, 'the app itself was requested').toBeGreaterThan(0);
    const foreign = requests.filter((url) => {
      const parsed = new URL(url);
      return parsed.protocol !== 'data:' && parsed.origin !== appOrigin;
    });
    expect(foreign, 'requests to other origins (CDNs, fonts, analytics)').toEqual([]);
  });

  test('shows the header: wordmark, byline and settings', async ({ page }) => {
    await gotoApp(page);
    const header = page.getByRole('banner');
    const heading = header.getByRole('heading', { level: 1 });
    await expect(heading).toHaveAccessibleName(APP_NAME);
    await expect(heading.locator('svg.wordmark')).toBeVisible();
    await expect(header).toContainText(message('en', 'header.byline'));
    await expect(header).toContainText('by Mortlake');
    const settings = header.getByRole('group', {
      name: message('en', 'header.settings'),
      exact: true,
    });
    await expect(
      settings.getByRole('combobox', { name: message('en', 'language.label'), exact: true }),
    ).toBeVisible();
    await expect(themeButton(page)).toBeVisible();
    // The region pill and Share arrive in T05/T15: no placeholders until then.
    await expect(settings.getByRole('button')).toHaveCount(1);
    await expect(menuButton(page)).toBeHidden();
  });

  test('shows the workspace regions with their headings', async ({ page }) => {
    await gotoApp(page);
    const { parameters, results } = panels(page);
    await expect(parameters).toBeVisible();
    await expect(results).toBeVisible();
    for (const [region, key] of [
      [parameters, 'panels.parameters.title'],
      [results, 'panels.results.title'],
    ] as const) {
      await expect(
        region.getByRole('heading', { level: 2, name: message('en', key), exact: true }),
      ).toBeAttached();
    }
  });

  test('shows the footer: copyright, license, source code and disclaimer', async ({ page }) => {
    await gotoApp(page);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText(message('en', 'footer.copyright'));
    await expect(footer).toContainText('© 2026 Mortlake');

    const newTab = message('en', 'footer.opensInNewTab');
    const license = footer.getByRole('link', { name: `${LICENSE_ID} ${newTab}`, exact: true });
    await expect(license).toHaveAttribute('href', LICENSE_URL);
    const source = footer.getByRole('link', {
      name: `${message('en', 'footer.sourceCode')} ${newTab}`,
      exact: true,
    });
    await expect(source).toHaveAttribute('href', SOURCE_CODE_URL);

    for (const link of [license, source]) {
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
    }

    const disclaimer = footer.getByText(message('en', 'footer.disclaimer'), { exact: true });
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText('not financial advice');
    await expect(footer).toContainText(message('en', 'footer.privacy'));
  });

  test('has an English title, description and html lang', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(message('en', 'meta.title'));
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      message('en', 'meta.description'),
    );
  });

  test('has an SVG favicon', async ({ page }) => {
    await gotoApp(page);
    const icon = page.locator('link[rel="icon"]');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('type', 'image/svg+xml');
    // Inlined as a data: URI, so it costs no request (docs/design/favicon.svg: lime on black).
    await expect(icon).toHaveAttribute('href', /^data:image\/svg\+xml,/);
    const href = (await icon.getAttribute('href')) ?? '';
    expect(decodeURIComponent(href)).toContain("fill='#C3F74C'");
  });
});
