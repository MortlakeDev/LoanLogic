// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { ExplainSheet } from '../explain/ExplainSheet';
import { InputsPanel } from '../inputs/InputsPanel';
import { MobileSummary } from '../results/MobileSummary';
import { ResultsPanel } from '../results/ResultsPanel';
import { t } from '../state/i18n';
import { Footer } from './Footer';
import { Header } from './Header';

/**
 * Application shell (DESIGN §7): header, the workspace and the footer. On mobile the
 * summary card comes first, then the inputs, then the results; on desktop the inputs
 * panel and the results column sit side by side and the summary card is hidden.
 */
export function App(): JSX.Element {
  return (
    <div class="app">
      <a class="skip-link" href="#main">
        {t('a11y.skipToContent')}
      </a>
      <Header />
      <main id="main" class="workspace" tabIndex={-1}>
        <MobileSummary />
        <InputsPanel />
        <ResultsPanel />
      </main>
      <Footer />
      <ExplainSheet />
    </div>
  );
}
