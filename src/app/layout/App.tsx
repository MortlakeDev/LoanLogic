// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { ParametersPanel } from '../panels/ParametersPanel';
import { ResultsPanel } from '../panels/ResultsPanel';
import { t } from '../state/i18n';
import { Footer } from './Footer';
import { Header } from './Header';

/** Application shell: header, the two-panel workspace and the footer. */
export function App(): JSX.Element {
  return (
    <div class="app">
      <a class="skip-link" href="#main">
        {t('a11y.skipToContent')}
      </a>
      <Header />
      <main id="main" class="workspace" tabIndex={-1}>
        <ParametersPanel />
        <ResultsPanel />
      </main>
      <Footer />
    </div>
  );
}
