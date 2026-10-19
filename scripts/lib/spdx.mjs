// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/** SPDX + copyright header rules (CLAUDE.md rule 2), shared by check-spdx.mjs and its tests. */

import path from 'node:path';

const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const COPYRIGHT = 'Copyright (C) 2026 Mortlake';
const BYTE_ORDER_MARK = 0xfeff;
const LINE_BREAK = /\r?\n/;

/** @type {Readonly<Record<'line' | 'block' | 'html', readonly [string, string]>>} */
export const HEADERS = {
  line: [`// ${SPDX}`, `// ${COPYRIGHT}`],
  block: [`/* ${SPDX} */`, `/* ${COPYRIGHT} */`],
  html: [`<!-- ${SPDX} -->`, `<!-- ${COPYRIGHT} -->`],
};

/** @type {Readonly<Record<string, 'line' | 'block' | 'html'>>} */
const STYLE_BY_EXTENSION = {
  '.ts': 'line',
  '.tsx': 'line',
  '.mts': 'line',
  '.cts': 'line',
  '.js': 'line',
  '.jsx': 'line',
  '.mjs': 'line',
  '.cjs': 'line',
  '.css': 'block',
  '.html': 'html',
};

/**
 * The header a file must start with, or `undefined` if the file type is exempt (JSON,
 * Markdown, YAML, …).
 *
 * @param {string} file Path of the file.
 * @returns {readonly [string, string] | undefined}
 */
export function requiredHeader(file) {
  const style = STYLE_BY_EXTENSION[path.extname(file).toLowerCase()];
  return style === undefined ? undefined : HEADERS[style];
}

/**
 * Whether `text` starts with `header` — the first two lines, after an optional shebang or
 * `<!doctype html>` line. A leading byte order mark is ignored.
 *
 * @param {string} text File contents.
 * @param {readonly [string, string]} header Expected first two lines.
 * @returns {boolean}
 */
export function hasHeader(text, header) {
  const body = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  const lines = body.split(LINE_BREAK);
  const first = lines[0] ?? '';
  const start = first.startsWith('#!') || /^<!doctype html>$/i.test(first) ? 1 : 0;
  return lines[start] === header[0] && lines[start + 1] === header[1];
}
