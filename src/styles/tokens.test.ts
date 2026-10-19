// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/*
 * The design-token contract of tokens.css: token names, the dark/light structure and
 * WCAG 2.2 AA contrast in both themes. Every colour VALUE is a placeholder until
 * docs/DESIGN.md, so nothing here hard-codes a token's colour: the checks resolve whatever
 * values the file holds and keep working when DESIGN.md replaces them.
 */

import { describe, expect, it } from 'vitest';

interface TextFileReader {
  readFileSync(path: URL, encoding: 'utf8'): string;
}

/** Narrows the untyped `node:fs` import below to the one method this test calls. */
function isTextFileReader(module: unknown): module is TextFileReader {
  return (
    typeof module === 'object' &&
    module !== null &&
    'readFileSync' in module &&
    typeof module.readFileSync === 'function'
  );
}

// Vitest stubs CSS imports (even `?raw`) with empty strings, so the stylesheet is read from
// disk. The app tsconfig has browser types only, hence the untyped import, narrowed here.
const NODE_FS = 'node:fs';
const fileSystem: unknown = await import(/* @vite-ignore */ NODE_FS);
if (!isTextFileReader(fileSystem)) {
  throw new Error('tokens.test.ts needs node:fs');
}
const tokensCss = fileSystem.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Declarations = ReadonlyMap<string, string>;
type Theme = 'dark' | 'light';

const THEMES: readonly Theme[] = ['dark', 'light'];

/** Selectors of the three blocks, normalized (single spaces, single quotes). */
const SELECTORS = {
  primitives: ':root',
  dark: ":root, :root[data-theme='dark']",
  light: ":root[data-theme='light']",
} as const;

/** Semantic tokens the T01 brief requires in each theme. */
const REQUIRED_THEME_TOKENS = [
  '--color-bg',
  '--color-surface-1',
  '--color-surface-2',
  '--color-surface-3',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-border',
  '--color-border-strong',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-subtle',
  '--color-on-accent',
  '--color-success',
  '--color-warning',
  '--color-danger',
  '--color-info',
  '--color-focus-ring',
  '--shadow-1',
  '--shadow-2',
  '--shadow-3',
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)\s*\)/g;

/**
 * Trims, collapses whitespace, writes commas as `, ` and double quotes as single ones, so a
 * selector matches SELECTORS whatever its line breaks, comma spacing or quote style.
 */
function normalizeSelector(selector: string): string {
  return selector
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/"/g, "'");
}

/** Custom properties per rule block, keyed by normalized selector, in source order. */
function parseBlocks(css: string): ReadonlyMap<string, Declarations> {
  const blocks = new Map<string, Map<string, string>>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, rawSelector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = normalizeSelector(rawSelector);
    const declarations = blocks.get(selector) ?? new Map<string, string>();
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      const name = declaration.slice(0, colon).trim();
      if (colon !== -1 && name.startsWith('--')) {
        declarations.set(
          name,
          declaration
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
    }
    blocks.set(selector, declarations);
  }
  return blocks;
}

const blocks = parseBlocks(tokensCss);

/** The custom properties of one of the three blocks; throws if tokens.css lacks it. */
function block(name: keyof typeof SELECTORS): Declarations {
  const declarations = blocks.get(SELECTORS[name]);
  if (declarations === undefined) {
    throw new Error(`tokens.css has no "${SELECTORS[name]} { … }" block`);
  }
  return declarations;
}

/**
 * The custom properties in effect for a theme, mirroring the cascade: the dark block also
 * matches plain `:root`, so the light theme is primitives + dark + light overrides.
 */
function themeScope(theme: Theme): Declarations {
  const dark = [...block('primitives'), ...block('dark')];
  return new Map(theme === 'dark' ? dark : [...dark, ...block('light')]);
}

/** Resolves a custom property through its var() chain. Fails on dangling or cyclic refs. */
function resolve(name: string, scope: Declarations, trail: readonly string[] = []): string {
  if (trail.includes(name)) {
    throw new Error(`cyclic var() chain: ${[...trail, name].join(' → ')}`);
  }
  const value = scope.get(name);
  if (value === undefined) {
    const owner = trail.at(-1);
    throw new Error(
      owner === undefined ? `${name} is not defined` : `${owner} refers to undefined ${name}`,
    );
  }
  const resolved = value.replace(VAR_REFERENCE, (_match, reference: string) =>
    resolve(reference, scope, [...trail, name]),
  );
  if (resolved.includes('var(')) {
    throw new Error(`${name}: unsupported var() form in "${value}" (no fallbacks expected)`);
  }
  return resolved;
}

/**
 * Resolves a colour token in a theme to its final value; throws unless that is #rrggbb, the
 * only form the contrast helpers read.
 */
function resolveColor(name: string, theme: Theme): string {
  const value = resolve(name, themeScope(theme));
  if (!HEX_COLOR.test(value)) {
    throw new Error(`${theme} theme: ${name} resolves to "${value}", expected #rrggbb`);
  }
  return value;
}

/** WCAG 2.x relative luminance of an sRGB #rrggbb colour. */
function relativeLuminance(hex: string): number {
  const linear = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white). Never rounded. */
function contrastRatio(first: string, second: string): number {
  const [darker, lighter] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => a - b,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

interface ContrastRule {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  readonly purpose: string;
}

/** WCAG 2.2 SC 1.4.3 (text) and SC 1.4.11 (non-text UI components). */
const TEXT = 4.5;
const NON_TEXT = 3;
const SURFACES = ['--color-bg', '--color-surface-1', '--color-surface-2', '--color-surface-3'];

/** One contrast rule per foreground and background pair, sharing one minimum and purpose. */
function rules(
  foregrounds: readonly string[],
  backgrounds: readonly string[],
  minimum: number,
  purpose: string,
): ContrastRule[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background, minimum, purpose })),
  );
}

const CONTRAST_RULES: readonly ContrastRule[] = [
  ...rules(
    ['--color-text-primary', '--color-text-secondary', '--color-text-muted'],
    SURFACES,
    TEXT,
    'text',
  ),
  ...rules(['--color-accent'], SURFACES, TEXT, 'link text'),
  ...rules(['--color-accent-hover'], SURFACES, TEXT, 'hovered link text'),
  ...rules(['--color-on-accent'], ['--color-accent'], TEXT, 'text on accent fills'),
  ...rules(['--color-text-primary'], ['--color-accent-subtle'], TEXT, 'selected segment text'),
  ...rules(['--color-border-strong'], SURFACES, NON_TEXT, 'control outlines'),
  ...rules(['--color-focus-ring'], SURFACES, NON_TEXT, 'focus ring'),
  ...rules(['--color-accent'], ['--color-accent-subtle'], NON_TEXT, 'selected segment outline'),
  ...rules(
    ['--color-success', '--color-warning', '--color-danger', '--color-info'],
    ['--color-bg', '--color-surface-1'],
    TEXT,
    'status text',
  ),
];

const CONTRAST_CASES = THEMES.flatMap((theme) =>
  CONTRAST_RULES.map((rule) => ({ theme, ...rule })),
);

describe('contrast helper', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#3366cc', '#3366cc')).toBe(1);
    // The well-known AA boundary greys on white: #767676 passes, #777777 does not.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('tokens.css structure', () => {
  it('has exactly the primitives, dark and light blocks', () => {
    expect([...blocks.keys()].sort()).toEqual(Object.values(SELECTORS).sort());
  });

  it.each(THEMES)('the %s theme declares every required semantic token itself', (theme) => {
    const declared = block(theme);
    const missing = REQUIRED_THEME_TOKENS.filter((token) => !declared.has(token));
    expect(missing, `${theme} theme is missing tokens`).toEqual([]);
  });

  it('light and dark themes define the same token names', () => {
    expect([...block('light').keys()].sort()).toEqual([...block('dark').keys()].sort());
  });

  it.each(THEMES)('the %s theme takes its colours from the primitive palette', (theme) => {
    const primitives = block('primitives');
    const offenders = [...block(theme)]
      .filter(([name]) => name.startsWith('--color-'))
      .filter(([, value]) => {
        const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1];
        return reference === undefined || !primitives.has(reference);
      })
      .map(([name, value]) => `${name}: ${value}`);
    expect(offenders, `${theme} colours must be var(--primitive)`).toEqual([]);
  });

  it.each(THEMES)('every custom property resolves in the %s theme', (theme) => {
    const scope = themeScope(theme);
    const failures: string[] = [];
    for (const [name, value] of scope) {
      try {
        if (resolve(name, scope) === '') {
          failures.push(`${name} resolves to an empty value`);
        }
      } catch (error) {
        failures.push(`${name} (${value}): ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(THEMES)('every colour in the %s theme resolves to #rrggbb', (theme) => {
    const scope = themeScope(theme);
    const colours = [...scope.keys()].filter((name) => name.startsWith('--color-'));
    expect(colours.length).toBeGreaterThanOrEqual(
      REQUIRED_THEME_TOKENS.filter((token) => token.startsWith('--color-')).length,
    );
    const offenders = colours
      .map((name) => [name, resolve(name, scope)] as const)
      .filter(([, value]) => !HEX_COLOR.test(value))
      .map(([name, value]) => `${name} = ${value}`);
    expect(offenders).toEqual([]);
  });

  it('defines the non-colour scales', () => {
    const primitives = block('primitives');
    for (const token of ['--font-sans', '--focus-ring-width']) {
      expect(primitives.get(token), `${token} is missing or empty`).toBeTruthy();
    }
    for (const prefix of ['--font-size-', '--space-', '--radius-']) {
      const scale = [...primitives.keys()].filter((name) => name.startsWith(prefix));
      expect(scale.length, `no ${prefix}* tokens`).toBeGreaterThan(0);
    }
  });
});

describe('WCAG 2.2 AA contrast', () => {
  it.each(CONTRAST_CASES)(
    '$theme: $foreground on $background ≥ $minimum:1 ($purpose)',
    ({ theme, foreground, background, minimum, purpose }) => {
      const foregroundHex = resolveColor(foreground, theme);
      const backgroundHex = resolveColor(background, theme);
      const ratio = contrastRatio(foregroundHex, backgroundHex);
      expect(
        ratio,
        `${theme} theme, ${purpose}: ${foreground} (${foregroundHex}) on ${background} ` +
          `(${backgroundHex}) is ${ratio.toFixed(3)}:1, needs ≥ ${String(minimum)}:1`,
      ).toBeGreaterThanOrEqual(minimum);
    },
  );
});
