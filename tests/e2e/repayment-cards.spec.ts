// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { expect, test, type Page } from '@playwright/test';
import { gotoApp, seedStorage, type Language } from './helpers.ts';

test.use({ locale: 'en-US', colorScheme: 'dark' });

/** The languages whose title of equal principal is longer than a card (DESIGN §8.4). */
const LANGUAGES_WITH_LONG_TITLES: readonly Language[] = ['ru', 'uk'];

/** Phone widths and the two desktop widths where the live site broke the titles. */
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

/** Where the checker looks: the title and the description of every repayment card. */
const CARD_TEXT = '#field-repayment .choice__title, #field-repayment .choice__text';

/**
 * Words in `selector` that run onto another line anywhere but right after a soft hyphen
 * (U+00AD), described for a failure message. The line of every visible character comes
 * from the box of a DOM Range over that one character, so the check sees where the browser
 * actually broke the text, whatever wrapping rule caused it. With `stripSoftHyphens` the
 * soft hyphens are removed first: the control case that proves the checker sees the
 * defect the soft hyphens fix.
 */
async function unhyphenatedBreaks(
  page: Page,
  selector: string,
  stripSoftHyphens = false,
): Promise<string[]> {
  return page.evaluate(
    ({ selector: query, strip }) => {
      const SOFT_HYPHEN = '\u00AD';
      const problems: string[] = [];
      for (const element of document.querySelectorAll(query)) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (strip) {
            node.textContent = (node.textContent ?? '').replaceAll(SOFT_HYPHEN, '');
          }
          const text = node.textContent ?? '';
          for (const match of text.matchAll(/\S+/gu)) {
            const word = match[0];
            let previousTop: number | undefined;
            let previousHeight = 0;
            for (let index = match.index; index < match.index + word.length; index += 1) {
              if (text[index] === SOFT_HYPHEN) {
                continue;
              }
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + 1);
              // A character sits on one line, but the character after a soft hyphen where
              // the line breaks also reports the rendered hyphen at the end of the line
              // before (Chromium). Its own glyph is the lowest of its boxes.
              const box = [...range.getClientRects()].reduce<DOMRect | undefined>(
                (lowest, rect) => (lowest === undefined || rect.top > lowest.top ? rect : lowest),
                undefined,
              );
              if (box === undefined) {
                problems.push(`"${word}": character ${String(index)} has no box`);
                break;
              }
              // A new line: the character sits lower by more than half a line.
              const newLine =
                previousTop !== undefined && box.top - previousTop > previousHeight / 2;
              if (newLine && text[index - 1] !== SOFT_HYPHEN) {
                const plain = (from: number, to: number): string =>
                  text.slice(from, to).replaceAll(SOFT_HYPHEN, '');
                problems.push(
                  `"${plain(match.index, match.index + word.length)}" breaks as ` +
                    `"${plain(match.index, index)}" / "${plain(index, match.index + word.length)}"`,
                );
              }
              previousTop = box.top;
              previousHeight = box.height;
            }
          }
        }
      }
      return problems;
    },
    { selector, strip: stripSoftHyphens },
  );
}

for (const language of LANGUAGES_WITH_LONG_TITLES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${language}, ${String(viewport.width)}px`, () => {
      test.use({ viewport });

      test.beforeEach(async ({ page }) => {
        await seedStorage(page, { language });
        await gotoApp(page);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        // The cards sit in the Loan section, open on phones and desktops alike.
        await expect(page.locator(CARD_TEXT).first()).toBeVisible();
      });

      test('no word of the repayment cards breaks across lines without a hyphen', async ({
        page,
      }) => {
        await expect(page.locator(CARD_TEXT)).toHaveCount(8);
        expect(await unhyphenatedBreaks(page, CARD_TEXT)).toEqual([]);
      });

      test('the title of equal principal would break mid-word without its soft hyphens', async ({
        page,
      }) => {
        const title = '#field-repayment .choice:has(input[value="equal-principal"]) .choice__title';
        expect(await page.locator(title).textContent()).toContain('\u00AD');
        expect(await unhyphenatedBreaks(page, title, true)).not.toEqual([]);
      });
    });
  }
}
