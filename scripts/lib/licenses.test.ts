// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_DIRECT_LICENSES,
  DEV_TRANSITIVE_EXTRA_LICENSES,
  DEV_TRANSITIVE_LICENSES,
  FONT_LICENSES,
  FONT_PACKAGES,
  RUNTIME_LICENSES,
  declaredLicense,
  isLicenseAllowed,
  licenseTexts,
  runtimeLicensesFor,
} from './licenses.mjs';

/** A small allowlist so each case shows exactly which ids are acceptable. */
const ALLOWED = ['MIT', 'Apache-2.0', 'ISC'];

describe('isLicenseAllowed', () => {
  it.each([
    ['MIT', true],
    ['Apache-2.0', true],
    ['ISC', true],
    ['GPL-3.0-only', false],
    ['LGPL-2.1-or-later', false],
    ['LicenseRef-Proprietary', false],
    ['UNLICENSED', false],
  ])('judges the single id %s → %s', (expression, expected) => {
    expect(isLicenseAllowed(expression, ALLOWED)).toBe(expected);
  });

  it('compares ids case-insensitively, on both sides', () => {
    expect(isLicenseAllowed('mit', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('APACHE-2.0', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('MIT', ['mit'])).toBe(true);
    expect(isLicenseAllowed('mit or gpl-3.0-only', ALLOWED)).toBe(true);
  });

  it('passes OR when either side passes and AND only when both do', () => {
    expect(isLicenseAllowed('MIT OR GPL-3.0-only', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('GPL-3.0-only OR MIT', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('GPL-2.0-only OR GPL-3.0-only', ALLOWED)).toBe(false);
    expect(isLicenseAllowed('MIT AND ISC', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-3.0-only', ALLOWED)).toBe(false);
    expect(isLicenseAllowed('MIT AND ISC AND Apache-2.0', ALLOWED)).toBe(true);
  });

  it('binds AND tighter than OR', () => {
    // MIT OR (GPL AND LGPL): true. Left-to-right evaluation would give false.
    expect(isLicenseAllowed('MIT OR GPL-3.0-only AND LGPL-2.1-only', ALLOWED)).toBe(true);
    // (GPL AND MIT) OR ISC: true.
    expect(isLicenseAllowed('GPL-3.0-only AND MIT OR ISC', ALLOWED)).toBe(true);
    // (MIT AND GPL) OR LGPL: false.
    expect(isLicenseAllowed('MIT AND GPL-3.0-only OR LGPL-2.1-only', ALLOWED)).toBe(false);
  });

  it('lets parentheses override precedence and nest', () => {
    expect(isLicenseAllowed('(MIT OR GPL-3.0-only) AND LGPL-2.1-only', ALLOWED)).toBe(false);
    expect(isLicenseAllowed('(MIT OR GPL-3.0-only) AND (ISC OR LGPL-2.1-only)', ALLOWED)).toBe(
      true,
    );
    expect(isLicenseAllowed('((MIT))', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('(GPL-3.0-only OR (LGPL-2.1-only AND MIT))', ALLOWED)).toBe(false);
    expect(isLicenseAllowed('(GPL-3.0-only OR (ISC AND (MIT OR GPL-2.0-only)))', ALLOWED)).toBe(
      true,
    );
  });

  it('judges A WITH exception by A', () => {
    expect(isLicenseAllowed('Apache-2.0 WITH LLVM-exception', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('GPL-2.0-only WITH Classpath-exception-2.0', ALLOWED)).toBe(false);
    expect(isLicenseAllowed('GPL-2.0-only WITH Classpath-exception-2.0 OR MIT', ALLOWED)).toBe(
      true,
    );
    expect(isLicenseAllowed('(Apache-2.0 WITH LLVM-exception) AND ISC', ALLOWED)).toBe(true);
  });

  it('ignores a trailing "+" (or later)', () => {
    expect(isLicenseAllowed('Apache-2.0+', ALLOWED)).toBe(true);
    expect(isLicenseAllowed('GPL-2.0+', ALLOWED)).toBe(false);
  });

  it.each([
    '',
    '   ',
    '(MIT',
    'MIT)',
    '((MIT)',
    '()',
    'MIT OR',
    'OR MIT',
    'MIT AND',
    'MIT MIT',
    'MIT OR (ISC',
    'MIT WITH',
    'SEE LICENSE IN LICENSE.txt',
    'MIT OR SEE LICENSE IN LICENSE.txt',
  ])('rejects the malformed or non-SPDX expression "%s"', (expression) => {
    expect(isLicenseAllowed(expression, ALLOWED)).toBe(false);
  });

  it.each(['MIT WITH (', 'MIT WITH )', 'MIT WITH OR', '(MIT WITH ))'])(
    'rejects "%s", where WITH is not followed by an exception id',
    (expression) => {
      expect(isLicenseAllowed(expression, ALLOWED)).toBe(false);
    },
  );

  it('accepts the legacy OR form produced by declaredLicense', () => {
    const declared = declaredLicense({
      licenses: [{ type: 'MIT' }, { type: 'GPL-3.0-only' }],
    });
    expect(declared).toBeDefined();
    expect(declared !== undefined && isLicenseAllowed(declared, ALLOWED)).toBe(true);
  });
});

describe('declaredLicense', () => {
  it('reads an SPDX string, trimmed', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT');
    expect(declaredLicense({ license: '  (MIT OR Apache-2.0) ' })).toBe('(MIT OR Apache-2.0)');
  });

  it('reads the { type } object form', () => {
    expect(declaredLicense({ license: { type: 'ISC', url: 'https://example.test' } })).toBe('ISC');
  });

  it('turns a legacy licenses array into an OR expression', () => {
    expect(declaredLicense({ licenses: [{ type: 'MIT' }] })).toBe('MIT');
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT OR Apache-2.0)',
    );
  });

  it('skips malformed entries of a legacy licenses array', () => {
    expect(declaredLicense({ licenses: [null, 'MIT', { type: 7 }, { type: 'ISC' }] })).toBe('ISC');
  });

  it('prefers license over licenses', () => {
    expect(declaredLicense({ license: 'MIT', licenses: [{ type: 'GPL-3.0-only' }] })).toBe('MIT');
  });

  it.each([
    ['no license fields', {}],
    ['an empty string', { license: '' }],
    ['a blank string', { license: '   ' }],
    ['null', { license: null }],
    ['a non-string type', { license: { type: 42 } }],
    ['an object without type', { license: { name: 'MIT' } }],
    ['an empty licenses array', { licenses: [] }],
    ['licenses that is not an array', { licenses: { type: 'MIT' } }],
  ])('returns undefined for %s', (_label, manifest) => {
    expect(declaredLicense(manifest)).toBeUndefined();
  });
});

describe('license policy', () => {
  it('allows MPL-2.0 for direct dev tools only, never at runtime', () => {
    expect(RUNTIME_LICENSES).not.toContain('MPL-2.0');
    expect(DEV_DIRECT_LICENSES).toContain('MPL-2.0');
    expect(DEV_TRANSITIVE_LICENSES).toContain('MPL-2.0');
  });

  it('allows the CLAUDE.md rule 11 code licenses at runtime', () => {
    for (const id of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']) {
      expect(RUNTIME_LICENSES).toContain(id);
    }
  });

  it('allows OFL-1.1 only for the listed font packages (CLAUDE.md: OFL for fonts)', () => {
    expect(RUNTIME_LICENSES).not.toContain('OFL-1.1');
    expect(FONT_LICENSES).toEqual(['OFL-1.1']);
    expect(FONT_PACKAGES).toContain('@fontsource-variable/inter');
    for (const font of FONT_PACKAGES) {
      expect(isLicenseAllowed('OFL-1.1', runtimeLicensesFor(font))).toBe(true);
      expect(isLicenseAllowed('MIT', runtimeLicensesFor(font))).toBe(true);
    }
    for (const code of ['preact', '@preact/signals', 'some-icon-font-lookalike']) {
      expect(isLicenseAllowed('OFL-1.1', runtimeLicensesFor(code))).toBe(false);
      expect(runtimeLicensesFor(code)).toBe(RUNTIME_LICENSES);
    }
  });

  it('does not allow copyleft licenses anywhere', () => {
    for (const id of ['GPL-3.0-only', 'AGPL-3.0-only', 'LGPL-2.1-only', 'EUPL-1.2']) {
      expect(isLicenseAllowed(id, DEV_TRANSITIVE_LICENSES)).toBe(false);
    }
  });

  it('nests the lists: runtime ⊆ dev direct ⊆ dev transitive', () => {
    for (const id of RUNTIME_LICENSES) {
      expect(DEV_DIRECT_LICENSES).toContain(id);
    }
    for (const id of DEV_DIRECT_LICENSES) {
      expect(DEV_TRANSITIVE_LICENSES).toContain(id);
    }
  });

  it('includes every documented transitive extra, and only there', () => {
    const extras = Object.entries(DEV_TRANSITIVE_EXTRA_LICENSES);
    expect(extras.length).toBeGreaterThan(0);
    for (const [id, reason] of extras) {
      expect(DEV_TRANSITIVE_LICENSES).toContain(id);
      expect(DEV_DIRECT_LICENSES).not.toContain(id);
      expect(reason, `${id} needs a documented reason`).toMatch(/\S/);
    }
  });

  it('freezes the lists so the policy cannot be changed at run time', () => {
    expect(Object.isFrozen(RUNTIME_LICENSES)).toBe(true);
    expect(Object.isFrozen(DEV_DIRECT_LICENSES)).toBe(true);
    expect(Object.isFrozen(DEV_TRANSITIVE_LICENSES)).toBe(true);
    expect(Object.isFrozen(DEV_TRANSITIVE_EXTRA_LICENSES)).toBe(true);
  });
});

describe('licenseTexts', () => {
  let packageDir = '';

  beforeEach(() => {
    packageDir = mkdtempSync(path.join(tmpdir(), 'loanlogic-licenses-'));
  });

  afterEach(() => {
    rmSync(packageDir, { recursive: true, force: true });
  });

  const write = (file: string, text: string): void => {
    writeFileSync(path.join(packageDir, file), text, 'utf8');
  };

  it('collects LICENSE, LICENCE.md, COPYING and NOTICE files, sorted by name', () => {
    write('LICENSE', 'MIT License\n');
    write('LICENCE.md', '# Licence\n');
    write('COPYING', 'Copying terms\n');
    write('NOTICE', 'Notice text\n');
    write('README.md', 'not a license');
    write('package.json', '{}');
    write('CHANGELOG.md', 'not a license');
    write('LICENSE.js', 'not a license');
    mkdirSync(path.join(packageDir, 'licenses'));

    expect(licenseTexts(packageDir)).toEqual([
      { file: 'COPYING', text: 'Copying terms' },
      { file: 'LICENCE.md', text: '# Licence' },
      { file: 'LICENSE', text: 'MIT License' },
      { file: 'NOTICE', text: 'Notice text' },
    ]);
  });

  it('matches names case-insensitively, with .txt and .markdown extensions', () => {
    write('license.txt', 'lower case');
    write('Notice.markdown', 'mixed case');

    expect(licenseTexts(packageDir).map((entry) => entry.file)).toEqual([
      'Notice.markdown',
      'license.txt',
    ]);
  });

  it('collects split license files such as LICENSE-MIT and LICENSE-APACHE.txt', () => {
    write('LICENSE-MIT', 'MIT part');
    write('LICENSE-APACHE.txt', 'Apache part');
    write('license-checker.js', 'not a license');
    write('LICENSE-2.0.js', 'not a license');

    expect(licenseTexts(packageDir).map((entry) => entry.file)).toEqual([
      'LICENSE-APACHE.txt',
      'LICENSE-MIT',
    ]);
  });

  it('normalizes CRLF line endings and trims the text', () => {
    write('LICENSE', '\r\nMIT License\r\n\r\nPermission is hereby granted\r\n\r\n');

    expect(licenseTexts(packageDir)).toEqual([
      { file: 'LICENSE', text: 'MIT License\n\nPermission is hereby granted' },
    ]);
  });

  it('returns nothing for a package without license files', () => {
    write('README.md', 'no license here');
    expect(licenseTexts(packageDir)).toEqual([]);
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(licenseTexts(path.join(packageDir, 'missing'))).toEqual([]);
  });
});
