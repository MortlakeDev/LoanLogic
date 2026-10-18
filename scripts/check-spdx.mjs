#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Fails if a source file lacks the SPDX + copyright header (CLAUDE.md rule 2).
 * Checks every tracked or new (not ignored) source file; see scripts/lib/spdx.mjs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hasHeader, requiredHeader } from './lib/spdx.mjs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => file !== '' && existsSync(file));

/** @type {string[]} */
const missing = [];
let checked = 0;
for (const file of files) {
  const header = requiredHeader(file);
  if (header === undefined) {
    continue;
  }
  checked += 1;
  if (!hasHeader(readFileSync(file, 'utf8'), header)) {
    missing.push(`  ${file}  (expected: ${header.join(' / ')})`);
  }
}

if (missing.length > 0) {
  console.error(`SPDX header missing or malformed in ${String(missing.length)} file(s):`);
  console.error(missing.join('\n'));
  process.exit(1);
}
console.log(`SPDX headers OK in ${String(checked)} source files.`);
