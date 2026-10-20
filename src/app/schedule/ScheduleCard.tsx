// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './schedule.css';

import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { money } from '../state/display';
import { t } from '../state/i18n';
import { SCHEDULE_LIST_ID, ScheduleList } from './ScheduleList';
import { ScheduleTable } from './ScheduleTable';
import { scheduleModel, scheduleView, toggleYearlySummary } from './view';

/**
 * The schedule card (DESIGN §8.10, §7.2): the table at 64rem and wider, the list below
 * it (CSS switches them with `display: none`, so the hidden one leaves the accessibility
 * tree), and the reconciliation note.
 *
 * Only implemented tabs are shown (DESIGN §7.1), and the schedule is the only one in T03,
 * so the card has a title instead of a tab list; the exports arrive in T14–T15.
 *
 * Renders nothing without a valid result: invalid input never leaves stale figures.
 */
export function ScheduleCard(): JSX.Element | null {
  const model = scheduleModel.value;

  useEffect(() => {
    if (model !== null && model.violations.length > 0) {
      // A ledger that does not reconcile is an engine bug: report it to developers, and
      // show no reconciliation note to users rather than a technical message.
      console.error(
        '[schedule] ledger invariants failed',
        model.violations.map((violation) => violation.message),
      );
    }
  }, [model]);

  if (model === null) {
    return null;
  }
  const yearly = scheduleView.value.yearly;
  return (
    <section class="card schedule" aria-labelledby="schedule-title">
      <div class="schedule__header">
        <h3 id="schedule-title" class="schedule__title">
          {t('schedule.title')}
        </h3>
        <button
          type="button"
          class="btn btn--secondary schedule__summary-toggle"
          aria-pressed={yearly}
          aria-controls={SCHEDULE_LIST_ID}
          onClick={toggleYearlySummary}
        >
          {t('schedule.yearlySummary')}
        </button>
      </div>
      <ScheduleTable model={model} />
      <ScheduleList model={model} />
      {model.violations.length === 0 && (
        <p class="schedule__note">
          <Icon name="check" class="schedule__note-icon" />
          <span>{t('schedule.reconciled', { principal: money(model.totalPrincipal) })}</span>
        </p>
      )}
    </section>
  );
}
