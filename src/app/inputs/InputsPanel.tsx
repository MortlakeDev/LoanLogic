// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './inputs.css';
import type { JSX } from 'preact';
import { Disclosure } from '../components/Disclosure';
import { t } from '../state/i18n';
import { form } from '../state/loan';
import { moreOpen } from '../state/ui';
import { AdvancedSection } from './AdvancedSection';
import { FeesSection } from './FeesSection';
import { LoanSection } from './LoanSection';
import { moreStatus } from './view';

/**
 * The inputs panel (DESIGN §8.2–§8.5, T03 brief §3): the loan, then fees and the
 * advanced settings. On a phone those two sit behind one disclosure with a status line
 * (DESIGN §7.2); on a desktop its content is always shown, without the disclosure frame
 * (inputs.css).
 */
export function InputsPanel(): JSX.Element {
  return (
    <section class="card inputs" aria-labelledby="inputs-title">
      <h2 id="inputs-title" class="visually-hidden">
        {t('panels.parameters.title')}
      </h2>
      <LoanSection />
      <MoreDisclosure />
    </section>
  );
}

function MoreDisclosure(): JSX.Element {
  return (
    <Disclosure
      id="more"
      class="inputs__more"
      title={t('inputs.more')}
      status={moreStatus(form.value)}
      open={moreOpen.value}
      onToggle={(open) => {
        moreOpen.value = open;
      }}
    >
      <FeesSection />
      <AdvancedSection />
    </Disclosure>
  );
}
