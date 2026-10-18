// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  declaredLicense,
  FONT_LICENSES,
  isLicenseAllowed,
  licenseTexts,
  RUNTIME_LICENSES,
  runtimeLicensesFor,
} from '../lib/licenses.mjs';

export interface ThirdPartyNoticesOptions {
  /** File name of the emitted notices asset, relative to the output directory. */
  readonly fileName: string;
  /**
   * When set, the notices are also appended as an HTML comment to this HTML output file,
   * so a self-contained single-file build carries its own notices.
   */
  readonly embedInHtml?: string;
}

interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license: string | undefined;
  readonly dir: string;
}

const NODE_MODULES = '/node_modules/';

// Vite injects small runtime helpers as virtual modules (`\0vite/...`); their code is
// Vite's own, so it is attributed to the `vite` package.
const VIRTUAL_OWNERS: readonly (readonly [prefix: string, packageName: string])[] = [
  ['\0vite/', 'vite'],
];

/**
 * Collects every third-party package whose code or assets end up in the bundle, fails the
 * build on a license outside the runtime allowlist, and emits THIRD-PARTY-NOTICES.txt.
 */
export function thirdPartyNotices(options: ThirdPartyNoticesOptions): Plugin {
  const root = process.cwd();
  return {
    name: 'loanlogic:third-party-notices',
    apply: 'build',
    enforce: 'post',
    // Runs after vite-plugin-singlefile (also order "post", listed earlier) has produced the
    // final HTML file.
    generateBundle: {
      order: 'post',
      handler(_outputOptions, bundle): void {
        const packages = new Map<string, BundledPackage>();
        for (const id of this.getModuleIds()) {
          const dir = packageDirOf(id, root);
          if (dir === undefined || packages.has(dir)) {
            continue;
          }
          const manifestPath = path.join(dir, 'package.json');
          if (!existsSync(manifestPath)) {
            this.error(`Cannot attribute bundled module ${id}: no package.json in ${dir}`);
          }
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
            string,
            unknown
          >;
          packages.set(dir, {
            name: String(manifest.name),
            version: String(manifest.version),
            license: declaredLicense(manifest),
            dir,
          });
        }

        const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
        const violations = sorted.filter(
          (pkg) =>
            pkg.license === undefined ||
            !isLicenseAllowed(pkg.license, runtimeLicensesFor(pkg.name)),
        );
        if (violations.length > 0) {
          const list = violations
            .map((pkg) => `  ${pkg.name}@${pkg.version}: ${pkg.license ?? 'no license declared'}`)
            .join('\n');
          this.error(
            `Bundled dependencies with a license outside the allowlist ` +
              `(${RUNTIME_LICENSES.join(', ')}; ${FONT_LICENSES.join(', ')} for listed font ` +
              `packages):\n${list}`,
          );
        }

        // Every bundled package must ship its license text: the notices reproduce it.
        const withoutText = sorted.filter((pkg) => licenseTexts(pkg.dir).length === 0);
        if (withoutText.length > 0) {
          this.error(
            `Bundled dependencies without a LICENSE/COPYING/NOTICE file to reproduce:\n` +
              withoutText.map((pkg) => `  ${pkg.name}@${pkg.version}`).join('\n'),
          );
        }

        const text = renderNotices(sorted);
        this.emitFile({ type: 'asset', fileName: options.fileName, source: text });

        if (options.embedInHtml !== undefined) {
          const html = bundle[options.embedInHtml];
          if (html?.type !== 'asset' || typeof html.source !== 'string') {
            this.error(`Cannot embed notices: ${options.embedInHtml} is not in the bundle`);
          }
          const comment = htmlComment(text);
          if (comment === undefined) {
            this.error(
              'Cannot embed notices: a license text contains a sequence that would end the HTML comment',
            );
          }
          const embedded = html.source.replace(/(<\/html>\s*)$/i, (closing: string) => {
            return `${comment}\n${closing}`;
          });
          if (embedded === html.source) {
            this.error(`Cannot embed notices: ${options.embedInHtml} does not end with </html>`);
          }
          html.source = embedded;
        }
      },
    },
  };
}

/**
 * Maps a bundled module id to the directory of the package that owns it, or `undefined`
 * for first-party code and unattributed virtual modules.
 */
export function packageDirOf(id: string, root: string): string | undefined {
  for (const [prefix, packageName] of VIRTUAL_OWNERS) {
    if (id.startsWith(prefix)) {
      return path.join(root, 'node_modules', packageName);
    }
  }
  if (id.startsWith('\0')) {
    return undefined;
  }
  const normalized = id.replace(/\\/g, '/').replace(/[?#].*$/, '');
  const index = normalized.lastIndexOf(NODE_MODULES);
  if (index === -1) {
    return undefined;
  }
  const rest = normalized.slice(index + NODE_MODULES.length).split('/');
  const nameSegments = rest[0]?.startsWith('@') === true ? 2 : 1;
  return path.normalize(
    normalized.slice(0, index + NODE_MODULES.length) + rest.slice(0, nameSegments).join('/'),
  );
}

/**
 * Wraps text in an HTML comment, verbatim (license texts must not be altered). Returns
 * `undefined` if the text contains a sequence that would end or invalidate the comment
 * (WHATWG HTML: `<!--`, `-->`, `--!>`); plain `--` is allowed.
 */
export function htmlComment(text: string): string | undefined {
  if (/<!--|-->|--!>/.test(text)) {
    return undefined;
  }
  return `<!--\n${text}\n-->`;
}

function renderNotices(packages: readonly BundledPackage[]): string {
  const header = [
    'LoanLogic — third-party notices',
    '',
    'LoanLogic is Copyright (C) 2026 Mortlake and licensed under AGPL-3.0-or-later.',
    'It bundles the following third-party software, used under the licenses below.',
  ].join('\n');
  const sections = packages.map((pkg) => {
    const body = licenseTexts(pkg.dir)
      .map((entry) => `--- ${entry.file} ---\n${entry.text}`)
      .join('\n\n');
    return `${'='.repeat(78)}\n${pkg.name}@${pkg.version} — ${pkg.license ?? 'UNKNOWN'}\n${'='.repeat(78)}\n${body}`;
  });
  return `${header}\n\n${sections.join('\n\n')}\n`;
}
