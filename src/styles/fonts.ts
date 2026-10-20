// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * The single place where web fonts are loaded (DESIGN §4.1): Onest for the interface and
 * JetBrains Mono for every figure, both self-hosted variable fonts (OFL-1.1). Only the
 * latin, latin-ext, cyrillic and cyrillic-ext subsets ship (the ₴ sign is in
 * cyrillic-ext); Chinese uses system fonts.
 *
 * The packages' own stylesheets would load every subset, so the faces are registered
 * here. The files are imported from JavaScript with `?url`: that keeps them in the build's
 * module graph, so the third-party notices credit both packages, and the single-file build
 * inlines them like any other asset.
 */

import jetbrainsCyrillicExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-ext-wght-normal.woff2?url';
import jetbrainsCyrillic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-cyrillic-wght-normal.woff2?url';
import jetbrainsLatinExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2?url';
import jetbrainsLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import onestCyrillicExt from '@fontsource-variable/onest/files/onest-cyrillic-ext-wght-normal.woff2?url';
import onestCyrillic from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';
import onestLatinExt from '@fontsource-variable/onest/files/onest-latin-ext-wght-normal.woff2?url';
import onestLatin from '@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url';

/** Unicode ranges of the four subsets, as the font packages define them. */
const RANGES = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  latinExt:
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  cyrillicExt: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
} as const;

/** One registered face: family, file, weight axis and unicode range. */
export interface FontFaceSpec {
  readonly family: string;
  readonly url: string;
  readonly weight: string;
  readonly unicodeRange: string;
}

const ONEST = 'Onest Variable';
const JETBRAINS = 'JetBrains Mono Variable';

/** Every face the UI uses (DESIGN §4.1). */
export const FONT_FACES: readonly FontFaceSpec[] = Object.freeze([
  { family: ONEST, url: onestLatin, weight: '100 900', unicodeRange: RANGES.latin },
  { family: ONEST, url: onestLatinExt, weight: '100 900', unicodeRange: RANGES.latinExt },
  { family: ONEST, url: onestCyrillic, weight: '100 900', unicodeRange: RANGES.cyrillic },
  { family: ONEST, url: onestCyrillicExt, weight: '100 900', unicodeRange: RANGES.cyrillicExt },
  { family: JETBRAINS, url: jetbrainsLatin, weight: '100 800', unicodeRange: RANGES.latin },
  { family: JETBRAINS, url: jetbrainsLatinExt, weight: '100 800', unicodeRange: RANGES.latinExt },
  { family: JETBRAINS, url: jetbrainsCyrillic, weight: '100 800', unicodeRange: RANGES.cyrillic },
  {
    family: JETBRAINS,
    url: jetbrainsCyrillicExt,
    weight: '100 800',
    unicodeRange: RANGES.cyrillicExt,
  },
]);

/**
 * Registers the faces with the document. Like `@font-face` rules, a face is downloaded
 * only when text in its unicode range is rendered; `display: swap` shows the fallback
 * stack meanwhile.
 *
 * @param fonts The document's font set (injectable for tests).
 */
export function registerFonts(fonts: FontFaceSet = document.fonts): void {
  for (const face of FONT_FACES) {
    fonts.add(
      new FontFace(face.family, `url(${face.url}) format('woff2')`, {
        weight: face.weight,
        style: 'normal',
        display: 'swap',
        unicodeRange: face.unicodeRange,
      }),
    );
  }
}
