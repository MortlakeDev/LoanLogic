// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { EmptyState } from '../components/EmptyState';
import { t } from '../state/i18n';

const TITLE_ID = 'parameters-title';

// Abstract form fields: three labelled rows and a slider.
function FieldsArt(): JSX.Element {
  return (
    <svg viewBox="0 0 160 96" focusable="false">
      <g class="art-line">
        <rect x="16" y="10" width="44" height="6" rx="3" />
        <rect x="16" y="22" width="128" height="14" rx="5" class="art-outline" />
        <rect x="16" y="46" width="32" height="6" rx="3" />
        <rect x="16" y="58" width="128" height="14" rx="5" class="art-outline" />
        <rect x="16" y="84" width="128" height="3" rx="1.5" />
      </g>
      <circle cx="96" cy="85.5" r="6" class="art-accent" />
    </svg>
  );
}

export function ParametersPanel(): JSX.Element {
  return (
    <section class="panel panel--parameters" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID} class="panel__title">
        {t('panels.parameters.title')}
      </h2>
      <EmptyState
        title={t('panels.parameters.emptyTitle')}
        text={t('panels.parameters.emptyText')}
        illustration={<FieldsArt />}
      />
    </section>
  );
}
