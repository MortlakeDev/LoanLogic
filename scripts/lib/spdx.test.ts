// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADERS, hasHeader, requiredHeader } from './spdx.mjs';

const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const COPYRIGHT = 'Copyright (C) 2026 Mortlake';
const BOM = '﻿';

const LINE = HEADERS.line;
const BLOCK = HEADERS.block;
const HTML = HEADERS.html;
const HASH = HEADERS.hash;

/** Joins lines with LF, ending with a newline like a real source file. */
function file(...lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('HEADERS', () => {
  it('spells the CLAUDE.md rule 2 header in each comment style', () => {
    expect(LINE).toEqual([`// ${SPDX}`, `// ${COPYRIGHT}`]);
    expect(BLOCK).toEqual([`/* ${SPDX} */`, `/* ${COPYRIGHT} */`]);
    expect(HTML).toEqual([`<!-- ${SPDX} -->`, `<!-- ${COPYRIGHT} -->`]);
    expect(HASH).toEqual([`# ${SPDX}`, `# ${COPYRIGHT}`]);
  });
});

describe('requiredHeader', () => {
  it.each([
    'src/app/main.ts',
    'src/app/layout/App.tsx',
    'scripts/check-spdx.mjs',
    'src/vite-env.d.ts',
    'eslint.config.js',
    'tool.cjs',
    'tool.mts',
    'tool.cts',
    'Widget.jsx',
  ])('requires // comments in %s', (file) => {
    expect(requiredHeader(file)).toEqual(LINE);
  });

  it('requires /* */ comments in CSS and <!-- --> in HTML', () => {
    expect(requiredHeader('src/styles/tokens.css')).toEqual(BLOCK);
    expect(requiredHeader('index.html')).toEqual(HTML);
  });

  it.each(['tools/reference/generate.py', 'tools/reference/loanlogic_ref/__init__.py', 'Tool.PY'])(
    'requires # comments in %s',
    (file) => {
      expect(requiredHeader(file)).toEqual(HASH);
    },
  );

  it.each(['FOO.TS', 'App.Tsx', 'Build.MJS', 'Theme.CSS', 'Index.HTML'])(
    'matches the extension of %s case-insensitively',
    (file) => {
      expect(requiredHeader(file)).toBeDefined();
    },
  );

  it.each([
    'package.json',
    'src/i18n/locales/en.json',
    'README.md',
    '.github/workflows/ci.yml',
    '.coderabbit.yaml',
    'LICENSE',
    '.editorconfig',
    'public/favicon.svg',
    'notes.txt',
  ])('exempts %s', (file) => {
    expect(requiredHeader(file)).toBeUndefined();
  });
});

describe('hasHeader', () => {
  it('accepts the header on the first two lines', () => {
    expect(hasHeader(file(...LINE, '', 'export const x = 1;'), LINE)).toBe(true);
    expect(hasHeader(file(...BLOCK, ':root {}'), BLOCK)).toBe(true);
  });

  it('accepts a file that is only the header, with or without a final newline', () => {
    expect(hasHeader(LINE.join('\n'), LINE)).toBe(true);
    expect(hasHeader(file(...LINE), LINE)).toBe(true);
  });

  it('allows a shebang line before the header', () => {
    expect(hasHeader(file('#!/usr/bin/env node', ...LINE, 'run();'), LINE)).toBe(true);
    expect(hasHeader(file('#!/usr/bin/env python3', ...HASH, 'main()'), HASH)).toBe(true);
  });

  it('accepts a Python header followed by a docstring, and rejects it after the docstring', () => {
    expect(hasHeader(file(...HASH, '"""Module docstring."""'), HASH)).toBe(true);
    expect(hasHeader(file('"""Module docstring."""', ...HASH), HASH)).toBe(false);
    expect(hasHeader(file(...LINE, 'import os'), HASH)).toBe(false);
  });

  it('allows a <!doctype html> line before an HTML header, in any case', () => {
    expect(hasHeader(file('<!doctype html>', ...HTML, '<html lang="en">'), HTML)).toBe(true);
    expect(hasHeader(file('<!DOCTYPE html>', ...HTML, '<html lang="en">'), HTML)).toBe(true);
  });

  it('ignores a leading byte order mark', () => {
    expect(hasHeader(`${BOM}${file(...LINE, 'code();')}`, LINE)).toBe(true);
    expect(hasHeader(`${BOM}${file('<!doctype html>', ...HTML)}`, HTML)).toBe(true);
  });

  it('accepts CRLF line endings', () => {
    expect(hasHeader([...LINE, 'code();', ''].join('\r\n'), LINE)).toBe(true);
    expect(hasHeader(['#!/usr/bin/env node', ...LINE, ''].join('\r\n'), LINE)).toBe(true);
    expect(hasHeader(`${BOM}${['<!doctype html>', ...HTML, ''].join('\r\n')}`, HTML)).toBe(true);
  });

  it('rejects the two lines in the wrong order', () => {
    expect(hasHeader(file(LINE[1], LINE[0], 'code();'), LINE)).toBe(false);
  });

  it('rejects a missing copyright line', () => {
    expect(hasHeader(file(LINE[0], 'code();'), LINE)).toBe(false);
    expect(hasHeader(LINE[0], LINE)).toBe(false);
  });

  it('rejects a missing SPDX line or another license', () => {
    expect(hasHeader(file(LINE[1], 'code();'), LINE)).toBe(false);
    expect(hasHeader(file('// SPDX-License-Identifier: MIT', LINE[1]), LINE)).toBe(false);
  });

  it.each([
    '// Copyright (C) 2026 Someone Else',
    '// Copyright (C) 2026 Mortlake and contributors',
    '// Copyright (C) 2025 Mortlake',
    '// Copyright 2026 Mortlake',
  ])('rejects the copyright line "%s"', (copyright) => {
    expect(hasHeader(file(LINE[0], copyright, 'code();'), LINE)).toBe(false);
  });

  it('rejects a header that is not at the top of the file', () => {
    expect(hasHeader(file('', ...LINE), LINE)).toBe(false);
    expect(hasHeader(file("import 'x';", ...LINE), LINE)).toBe(false);
    expect(hasHeader(file('#!/usr/bin/env node', '', ...LINE), LINE)).toBe(false);
    expect(hasHeader(file(...HTML.map((line) => `  ${line}`)), HTML)).toBe(false);
  });

  it('rejects the header in the wrong comment style', () => {
    expect(hasHeader(file(...BLOCK, 'code();'), LINE)).toBe(false);
    expect(hasHeader(file(...LINE), HTML)).toBe(false);
  });

  it('only skips a bare doctype line, not one with more markup', () => {
    expect(hasHeader(file('<!doctype html><html>', ...HTML), HTML)).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(hasHeader('', LINE)).toBe(false);
    expect(hasHeader(BOM, LINE)).toBe(false);
  });

  it.each([
    'index.html',
    'src/styles/tokens.css',
    'scripts/check-spdx.mjs',
    'vite.config.ts',
    'tools/reference/generate.py',
    'tools/reference/cases.py',
  ])('accepts the repository file %s', (file) => {
    const header = requiredHeader(file);
    expect(header).toBeDefined();
    const text = readFileSync(path.resolve(import.meta.dirname, '..', '..', file), 'utf8');
    expect(header !== undefined && hasHeader(text, header)).toBe(true);
  });
});
