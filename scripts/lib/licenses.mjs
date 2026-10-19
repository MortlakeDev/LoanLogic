// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Shared license policy for the build (third-party notices) and `check-licenses.mjs`.
 * The allowlist mirrors CLAUDE.md rule 11; keep both in sync.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Licenses allowed for code that ships to users (runtime dependencies). */
export const RUNTIME_LICENSES = Object.freeze([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
]);

/** CLAUDE.md rule 11 allows OFL for fonts only, so it applies to the listed font packages. */
export const FONT_LICENSES = Object.freeze(['OFL-1.1']);

/** Font packages (reviewed one by one) that may use FONT_LICENSES. */
export const FONT_PACKAGES = Object.freeze(['@fontsource-variable/inter']);

/**
 * The runtime allowlist for one package: RUNTIME_LICENSES, plus FONT_LICENSES for fonts.
 *
 * @param {string} name Package name.
 * @returns {readonly string[]}
 */
export function runtimeLicensesFor(name) {
  return FONT_PACKAGES.includes(name) ? [...RUNTIME_LICENSES, ...FONT_LICENSES] : RUNTIME_LICENSES;
}

/** Direct devDependencies may additionally be MPL-2.0 (dev-only tools, CLAUDE.md rule 11). */
export const DEV_DIRECT_LICENSES = Object.freeze([...RUNTIME_LICENSES, 'MPL-2.0']);

/**
 * Transitive dev-only packages pulled in by the toolchain. These never ship in a build
 * (the build-time notices check guards that), and are permissive or data licenses.
 * Each entry is listed explicitly so any addition is a reviewed change.
 */
export const DEV_TRANSITIVE_EXTRA_LICENSES = Object.freeze({
  'BlueOak-1.0.0': 'permissive (isaacs packages: glob, minimatch, lru-cache, …)',
  'MIT-0': 'MIT without the attribution clause',
  'CC0-1.0': 'public-domain data (mdn-data, language-subtag-registry, …)',
  'CC-BY-4.0': 'browser support data (caniuse-lite), not code',
});

export const DEV_TRANSITIVE_LICENSES = Object.freeze([
  ...DEV_DIRECT_LICENSES,
  ...Object.keys(DEV_TRANSITIVE_EXTRA_LICENSES),
]);

/**
 * Evaluates an SPDX license expression against an allowlist.
 * `A OR B` passes if either side passes; `A AND B` needs both; `A WITH exception` is
 * judged by `A` (exceptions only grant extra permissions); a trailing `+` is ignored.
 *
 * @param {string} expression SPDX expression, e.g. "(MIT OR Apache-2.0)".
 * @param {readonly string[]} allowed SPDX ids that are acceptable.
 * @returns {boolean}
 */
export function isLicenseAllowed(expression, allowed) {
  const allowedSet = new Set(allowed.map((id) => id.toLowerCase()));
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;

  /** @returns {boolean} */
  const parseOr = () => {
    let result = parseAnd();
    while (tokens[position]?.toUpperCase() === 'OR') {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };

  /** @returns {boolean} */
  const parseAnd = () => {
    let result = parseWith();
    while (tokens[position]?.toUpperCase() === 'AND') {
      position += 1;
      const right = parseWith();
      result = result && right;
    }
    return result;
  };

  /** @returns {boolean} */
  const parseWith = () => {
    const result = parseAtom();
    if (tokens[position]?.toUpperCase() === 'WITH') {
      const exception = tokens[position + 1];
      if (
        exception === undefined ||
        exception === '(' ||
        exception === ')' ||
        ['AND', 'OR', 'WITH'].includes(exception.toUpperCase())
      ) {
        throw new Error(`Missing license exception after WITH in "${expression}"`);
      }
      position += 2;
    }
    return result;
  };

  /** @returns {boolean} */
  const parseAtom = () => {
    const token = tokens[position];
    position += 1;
    if (token === undefined) {
      throw new Error(`Unexpected end of SPDX expression "${expression}"`);
    }
    // Otherwise "MIT OR OR" would read the second OR as a (disallowed) license id, and the
    // OR would hide the malformed operand behind the allowed MIT.
    if (token === ')' || ['AND', 'OR', 'WITH'].includes(token.toUpperCase())) {
      throw new Error(`Unexpected "${token}" in SPDX expression "${expression}"`);
    }
    if (token === '(') {
      const inner = parseOr();
      if (tokens[position] !== ')') {
        throw new Error(`Unbalanced parentheses in SPDX expression "${expression}"`);
      }
      position += 1;
      return inner;
    }
    return allowedSet.has(token.replace(/\+$/, '').toLowerCase());
  };

  if (tokens.length === 0) {
    return false;
  }
  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

/**
 * Reads the declared license of a package from its package.json, normalizing the legacy
 * `licenses: [{ type }]` form into an SPDX `OR` expression.
 *
 * @param {Record<string, unknown>} manifest Parsed package.json.
 * @returns {string | undefined}
 */
export function declaredLicense(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string' && license.trim() !== '') {
    return license.trim();
  }
  if (license !== null && typeof license === 'object' && 'type' in license) {
    const type = /** @type {{ type: unknown }} */ (license).type;
    if (typeof type === 'string') {
      return type;
    }
  }
  if (Array.isArray(licenses)) {
    /** @type {string[]} */
    const types = [];
    for (const entry of /** @type {unknown[]} */ (licenses)) {
      if (entry !== null && typeof entry === 'object' && 'type' in entry) {
        const { type } = /** @type {{ type: unknown }} */ (entry);
        if (typeof type === 'string') {
          types.push(type);
        }
      }
    }
    if (types.length > 0) {
      return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
    }
  }
  return undefined;
}

// LICENSE, LICENCE.md, COPYING, NOTICE.txt, and split files such as LICENSE-MIT.
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(-[a-z0-9]+)*(\.(md|txt|markdown))?$/i;

/**
 * Returns the texts of LICENSE / COPYING / NOTICE files at the root of a package.
 *
 * @param {string} packageDir Absolute path of the package directory.
 * @returns {{ file: string; text: string }[]}
 */
export function licenseTexts(packageDir) {
  if (!existsSync(packageDir)) {
    return [];
  }
  return readdirSync(packageDir)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => ({
      file,
      text: readFileSync(path.join(packageDir, file), 'utf8').replace(/\r\n/g, '\n').trim(),
    }));
}
