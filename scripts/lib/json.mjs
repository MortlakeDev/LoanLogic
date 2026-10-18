// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { readFileSync } from 'node:fs';

/**
 * Reads and parses a JSON file. Returns `unknown` so callers narrow or cast explicitly.
 *
 * @param {string} file Path of the JSON file.
 * @returns {unknown}
 */
export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
