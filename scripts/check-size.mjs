#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Bundle budget: the JavaScript loaded by dist/index.html (entry scripts and their
 * modulepreloads), gzip-compressed, must stay within budget. Lazy-loaded chunks
 * (e.g. exports) do not count. Run after `npm run build`.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** Initial-JS budget in KiB (gzip): 60 at the foundation stage (T01); PLAN §5.6 caps v1 at 150. */
const BUDGET_KIB = 60;

const distDir = path.resolve('dist');
const indexPath = path.join(distDir, 'index.html');
if (!existsSync(indexPath)) {
  console.error('dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
// Vite puts entry chunks and modulepreloads under `<base>assets/`, so the path inside dist/
// starts at `assets/` whatever base the build used.
const ASSETS_DIR = 'assets/';
const urls = [
  ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g),
  ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
].map((match) => match[1] ?? '');

if (urls.length === 0) {
  console.error('No entry scripts found in dist/index.html.');
  process.exit(1);
}

let totalBytes = 0;
const rows = [];
for (const url of new Set(urls)) {
  const assetsIndex = url.indexOf(ASSETS_DIR);
  const relative = assetsIndex >= 0 ? url.slice(assetsIndex) : url.replace(/^\.?\//, '');
  const file = path.join(distDir, relative);
  if (!existsSync(file)) {
    console.error(
      `dist/index.html references ${url}, but ${relative} is not in dist/ — rebuild with \`npm run build\`.`,
    );
    process.exit(1);
  }
  const gzipBytes = gzipSync(readFileSync(file), { level: 9 }).length;
  totalBytes += gzipBytes;
  rows.push(`| ${relative} | ${(gzipBytes / 1024).toFixed(2)} KiB |`);
}

const totalKiB = totalBytes / 1024;
const ok = totalKiB <= BUDGET_KIB;
const report = [
  '### Bundle size (initial JS, gzip)',
  '',
  '| File | Size |',
  '|---|---|',
  ...rows,
  `| **Total** | **${totalKiB.toFixed(2)} KiB** of ${String(BUDGET_KIB)} KiB budget ${ok ? '✅' : '❌'} |`,
  '',
].join('\n');

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
if (!ok) {
  console.error(
    `Initial JS exceeds the budget: ${totalKiB.toFixed(2)} KiB > ${String(BUDGET_KIB)} KiB.`,
  );
  process.exit(1);
}
