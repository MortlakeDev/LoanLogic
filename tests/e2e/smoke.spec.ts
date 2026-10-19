// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test } from '@playwright/test';
import { APP_NAME, LICENSE_ID, LICENSE_URL, SOURCE_CODE_URL } from '../../src/config.ts';
import { collectPageErrors, gotoApp, message, panels } from './helpers.ts';

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
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(APP_NAME);
    await expect(header).toContainText(message('en', 'header.byline'));
    await expect(header).toContainText('by Mortlake');
    await expect(
      header.getByRole('combobox', { name: message('en', 'language.label'), exact: true }),
    ).toBeVisible();
    await expect(
      header.getByRole('group', { name: message('en', 'theme.label'), exact: true }),
    ).toBeVisible();
  });

  test('shows both workspace panels with their headings and empty states', async ({ page }) => {
    await gotoApp(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 })).toHaveText([
      message('en', 'panels.parameters.title'),
      message('en', 'panels.results.title'),
    ]);
    const { parameters, results } = panels(page);
    await expect(parameters).toBeVisible();
    await expect(results).toBeVisible();
    await expect(parameters).toContainText(message('en', 'panels.parameters.emptyTitle'));
    await expect(parameters).toContainText(message('en', 'panels.parameters.emptyText'));
    await expect(results).toContainText(message('en', 'panels.results.emptyTitle'));
    await expect(results).toContainText(message('en', 'panels.results.emptyText'));
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
    await expect(icon).toHaveAttribute('href', /^data:image\/svg\+xml[,;]|\.svg(?:[?#]|$)/);
  });
});
