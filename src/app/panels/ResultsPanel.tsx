// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { EmptyState } from '../components/EmptyState';
import { t } from '../state/i18n';

const TITLE_ID = 'results-title';

/**
 * Decorative art of an amortization chart: shrinking principal bars under a falling
 * balance curve.
 */
function ChartArt(): JSX.Element {
  const bars = [62, 56, 50, 44, 37, 30, 23, 15];
  return (
    <svg viewBox="0 0 160 96" focusable="false">
      <g class="art-line">
        {bars.map((height, index) => (
          <rect key={index} x={18 + index * 16} y={88 - height} width="10" height={height} rx="2" />
        ))}
      </g>
      <path class="art-accent-stroke" d="M16 20 C 60 24, 100 44, 146 78" fill="none" />
    </svg>
  );
}

/**
 * Workspace panel for the calculation results, labelled by its heading. For now it shows
 * an empty state; payments, the schedule and charts replace it in later tasks.
 */
export function ResultsPanel(): JSX.Element {
  return (
    <section class="panel panel--results" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID} class="panel__title">
        {t('panels.results.title')}
      </h2>
      <EmptyState
        title={t('panels.results.emptyTitle')}
        text={t('panels.results.emptyText')}
        illustration={<ChartArt />}
      />
    </section>
  );
}
