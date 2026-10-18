#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Checks the license of every installed package against the policy in
 * scripts/lib/licenses.mjs (CLAUDE.md rule 11):
 *
 * - runtime packages (shipped to users)  → MIT, ISC, BSD-2/3, Apache-2.0 (+ OFL-1.1 for the
 *                                          listed font packages)
 * - direct devDependencies               → the above + MPL-2.0
 * - transitive dev-only packages         → the above + an explicit list of permissive and
 *                                          data licenses used by the toolchain
 *
 * The bundle itself is checked again at build time (scripts/vite/third-party-notices.ts).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  declaredLicense,
  DEV_DIRECT_LICENSES,
  DEV_TRANSITIVE_LICENSES,
  isLicenseAllowed,
  runtimeLicensesFor,
} from './lib/licenses.mjs';
import { readJson } from './lib/json.mjs';

/**
 * @typedef {{ version?: string; license?: string; dev?: boolean; devOptional?: boolean;
 *   optional?: boolean; link?: boolean }} LockEntry
 * @typedef {{ packages: Record<string, LockEntry> }} Lockfile
 * @typedef {{ dependencies?: Record<string, string>;
 *   devDependencies?: Record<string, string> }} Manifest
 */

const root = process.cwd();
const manifest = /** @type {Manifest} */ (readJson(path.join(root, 'package.json')));
const lock = /** @type {Lockfile} */ (readJson(path.join(root, 'package-lock.json')));

const directDev = new Set(Object.keys(manifest.devDependencies ?? {}));

/** @type {string[]} */
const violations = [];
/** @type {string[]} */
const notes = [];
/** @type {Map<string, number>} */
const counts = new Map();

for (const [location, entry] of Object.entries(lock.packages)) {
  if (location === '' || entry.link === true) {
    continue;
  }
  const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const isDev = entry.dev === true || entry.devOptional === true;
  const isDirect = location === `node_modules/${name}`;

  let license = entry.license;
  if (license === undefined) {
    const installed = path.join(root, location, 'package.json');
    if (existsSync(installed)) {
      license = declaredLicense(/** @type {Record<string, unknown>} */ (readJson(installed)));
    } else if (entry.optional === true) {
      notes.push(`${name}: optional package for another platform, not installed — skipped`);
      continue;
    }
  }

  const tier = !isDev ? 'runtime' : isDirect && directDev.has(name) ? 'dev (direct)' : 'dev';
  const allowed =
    tier === 'runtime'
      ? runtimeLicensesFor(name)
      : tier === 'dev (direct)'
        ? DEV_DIRECT_LICENSES
        : DEV_TRANSITIVE_LICENSES;

  const key = `${tier.padEnd(12)} ${license ?? 'UNKNOWN'}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);

  if (license === undefined || !isLicenseAllowed(license, allowed)) {
    violations.push(
      `  ${name}@${entry.version ?? '?'} [${tier}]: ${license ?? 'no license declared'}`,
    );
  }
}

console.log('License summary (tier, license: packages):');
for (const [key, count] of [...counts.entries()].sort()) {
  console.log(`  ${key}: ${String(count)}`);
}
for (const note of notes) {
  console.log(`  note: ${note}`);
}

if (violations.length > 0) {
  console.error(`\n${String(violations.length)} package(s) violate the license policy:`);
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('\nAll package licenses are within policy.');
