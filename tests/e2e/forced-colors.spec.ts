// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test } from '@playwright/test';
import { gotoApp, languageSelect, themeRadio } from './helpers.ts';

// Windows contrast themes (forced colors) drop author backgrounds, box-shadows and
// background images. Only Chromium emulates forced colors.
test.use({ locale: 'en-US', forcedColors: 'active', reducedMotion: 'reduce' });

for (const width of [360, 1280]) {
  test.describe(`forced colors at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test.beforeEach(({ browserName }) => {
      test.skip(browserName !== 'chromium', 'Only Chromium emulates forced-colors mode');
    });

    test('the selected theme segment stands out from the others', async ({ page }) => {
      await gotoApp(page);
      await themeRadio(page, 'dark').check({ force: true });
      const backgrounds = await page
        .locator('.segmented__face')
        .evaluateAll((faces) => faces.map((face) => getComputedStyle(face).backgroundColor));
      const checked = await page
        .locator('.segmented__input:checked + .segmented__face')
        .evaluate((face) => getComputedStyle(face).backgroundColor);
      const others = backgrounds.filter((color) => color !== checked);
      expect(others).toHaveLength(backgrounds.length - 1);
    });

    test('the language select keeps a native dropdown arrow', async ({ page }) => {
      await gotoApp(page);
      const appearance = await languageSelect(page, 'en').evaluate(
        (select) => getComputedStyle(select).appearance,
      );
      expect(appearance).not.toBe('none');
    });
  });
}
