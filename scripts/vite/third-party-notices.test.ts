// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { htmlComment, packageDirOf, thirdPartyNotices } from './third-party-notices';

interface FakeAsset {
  type: 'asset';
  fileName: string;
  source: string;
}

interface RunResult {
  readonly emitted: Map<string, string>;
  readonly bundle: Record<string, FakeAsset>;
}

let root = '';

function writePackage(
  relativeDir: string,
  manifest: Record<string, unknown>,
  files: Readonly<Record<string, string>> = { LICENSE: `License of ${String(manifest.name)}` },
): string {
  const dir = path.join(root, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), text, 'utf8');
  }
  writeFileSync(path.join(dir, 'index.js'), 'export {};', 'utf8');
  return path.join(dir, 'index.js');
}

/** Runs the plugin's generateBundle hook with a minimal fake plugin context. */
function run(
  moduleIds: readonly string[],
  options: { embedInHtml?: string; html?: string } = {},
): RunResult {
  const plugin = thirdPartyNotices({
    fileName: 'THIRD-PARTY-NOTICES.txt',
    ...(options.embedInHtml === undefined ? {} : { embedInHtml: options.embedInHtml }),
  });
  const hook = plugin.generateBundle;
  if (typeof hook !== 'object' || !('handler' in hook)) {
    throw new Error('expected generateBundle to be an object hook');
  }
  const emitted = new Map<string, string>();
  const bundle: Record<string, FakeAsset> = {};
  if (options.html !== undefined && options.embedInHtml !== undefined) {
    bundle[options.embedInHtml] = {
      type: 'asset',
      fileName: options.embedInHtml,
      source: options.html,
    };
  }
  const context = {
    getModuleIds: (): IterableIterator<string> => moduleIds[Symbol.iterator](),
    emitFile: (file: { fileName: string; source: string }): string => {
      emitted.set(file.fileName, file.source);
      return file.fileName;
    },
    error: (message: string): never => {
      throw new Error(message);
    },
  };
  Reflect.apply(hook.handler, context, [{}, bundle, false]);
  return { emitted, bundle };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'loanlogic-notices-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('thirdPartyNotices', () => {
  it('lists every bundled package once, sorted, with its license text', () => {
    const preact = writePackage('node_modules/preact', {
      name: 'preact',
      version: '10.0.0',
      license: 'MIT',
    });
    const nested = writePackage('node_modules/preact/node_modules/@scope/inner', {
      name: '@scope/inner',
      version: '2.0.0',
      license: 'ISC',
    });
    const firstParty = path.join(root, 'src', 'main.ts');

    const { emitted } = run([preact, `${preact}?commonjs-proxy`, nested, firstParty]);
    const text = emitted.get('THIRD-PARTY-NOTICES.txt') ?? '';

    expect(text).toContain('Copyright (C) 2026 Mortlake');
    expect(text).toContain('@scope/inner@2.0.0 — ISC');
    expect(text).toContain('preact@10.0.0 — MIT');
    expect(text.indexOf('@scope/inner@2.0.0')).toBeLessThan(text.indexOf('preact@10.0.0'));
    expect(text).toContain('--- LICENSE ---\nLicense of preact');
    expect(text).toContain('License of @scope/inner');
    expect(text.match(/preact@10\.0\.0/g)).toHaveLength(1);
  });

  it('fails the build on a license outside the runtime allowlist', () => {
    const gpl = writePackage('node_modules/copyleft', {
      name: 'copyleft',
      version: '1.0.0',
      license: 'GPL-3.0-only',
    });
    expect(() => run([gpl])).toThrow(/copyleft@1\.0\.0: GPL-3\.0-only/);
  });

  it('fails the build when a package declares no license', () => {
    const unlicensed = writePackage('node_modules/mystery', { name: 'mystery', version: '0.1.0' });
    expect(() => run([unlicensed])).toThrow(/mystery@0\.1\.0: no license declared/);
  });

  it('fails the build when a package ships no license text to reproduce', () => {
    const bare = writePackage(
      'node_modules/bare',
      { name: 'bare', version: '1.0.0', license: 'MIT' },
      { 'README.md': 'no license file' },
    );
    expect(() => run([bare])).toThrow(/without a LICENSE\/COPYING\/NOTICE file[\s\S]*bare@1\.0\.0/);
  });

  it('accepts OFL-1.1 for a listed font package only', () => {
    const font = writePackage('node_modules/@fontsource-variable/inter', {
      name: '@fontsource-variable/inter',
      version: '5.0.0',
      license: 'OFL-1.1',
    });
    expect(run([font]).emitted.get('THIRD-PARTY-NOTICES.txt')).toContain('OFL-1.1');

    const notAFont = writePackage('node_modules/ofl-code', {
      name: 'ofl-code',
      version: '1.0.0',
      license: 'OFL-1.1',
    });
    expect(() => run([notAFont])).toThrow(/ofl-code@1\.0\.0: OFL-1\.1/);
  });

  it('embeds the notices verbatim as one HTML comment before </html>', () => {
    const preact = writePackage('node_modules/preact', {
      name: 'preact',
      version: '10.0.0',
      license: 'MIT',
    });
    const { emitted, bundle } = run([preact], {
      embedInHtml: 'LoanLogic.html',
      html: '<!doctype html><html><body>$& $1</body></html>\n',
    });
    const html = bundle['LoanLogic.html']?.source ?? '';
    const text = emitted.get('THIRD-PARTY-NOTICES.txt') ?? '';

    expect(html.startsWith('<!doctype html><html><body>$& $1</body>')).toBe(true);
    expect(html.endsWith('-->\n</html>\n')).toBe(true);
    expect(html).toContain(`<!--\n${text}\n-->`);
    expect(html.match(/<!--/g)).toHaveLength(1);
  });

  it('refuses to embed a license text that would end the HTML comment early', () => {
    const arrow = writePackage(
      'node_modules/arrow',
      { name: 'arrow', version: '1.0.0', license: 'MIT' },
      { LICENSE: 'Permission ---> granted' },
    );
    expect(() =>
      run([arrow], { embedInHtml: 'LoanLogic.html', html: '<html><body></body></html>' }),
    ).toThrow(/would end the HTML comment/);
  });

  it('fails when the HTML file to embed into is missing or has no </html>', () => {
    const preact = writePackage('node_modules/preact', {
      name: 'preact',
      version: '10.0.0',
      license: 'MIT',
    });
    expect(() => run([preact], { embedInHtml: 'LoanLogic.html' })).toThrow(/not in the bundle/);
    expect(() =>
      run([preact], { embedInHtml: 'LoanLogic.html', html: '<p>no closing tag</p>' }),
    ).toThrow(/does not end with <\/html>/);
  });
});

describe('packageDirOf', () => {
  const projectRoot = path.join(path.sep, 'project');

  it('maps a module path to its package directory', () => {
    expect(packageDirOf('/project/node_modules/preact/dist/preact.mjs', projectRoot)).toBe(
      path.normalize('/project/node_modules/preact'),
    );
  });

  it('keeps both segments of a scoped package name', () => {
    expect(packageDirOf('/project/node_modules/@preact/signals/dist/x.mjs', projectRoot)).toBe(
      path.normalize('/project/node_modules/@preact/signals'),
    );
  });

  it('uses the innermost node_modules for nested packages', () => {
    expect(
      packageDirOf('/project/node_modules/a/node_modules/@s/b/lib/index.js', projectRoot),
    ).toBe(path.normalize('/project/node_modules/a/node_modules/@s/b'));
  });

  it('handles Windows separators and query suffixes', () => {
    expect(packageDirOf('C:\\p\\node_modules\\preact\\hooks\\x.js?v=1#h', projectRoot)).toBe(
      path.normalize('C:/p/node_modules/preact'),
    );
  });

  it('attributes Vite runtime helpers to the vite package', () => {
    expect(packageDirOf('\0vite/preload-helper.js', projectRoot)).toBe(
      path.join(projectRoot, 'node_modules', 'vite'),
    );
  });

  it('ignores first-party code and other virtual modules', () => {
    expect(packageDirOf('/project/src/app/main.tsx', projectRoot)).toBeUndefined();
    expect(packageDirOf('\0commonjsHelpers.js', projectRoot)).toBeUndefined();
  });
});

describe('htmlComment', () => {
  it('wraps text verbatim, allowing a plain double dash', () => {
    expect(htmlComment('--- LICENSE ---\nA -- B')).toBe('<!--\n--- LICENSE ---\nA -- B\n-->');
  });

  it.each(['a --> b', 'a --!> b', 'a <!-- b', 'tail -->'])(
    'rejects %j, which would end or nest the comment',
    (text) => {
      expect(htmlComment(text)).toBeUndefined();
    },
  );
});
