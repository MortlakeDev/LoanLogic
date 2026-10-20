// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import type { LedgerRow } from '../../engine';
import { Icon } from '../components/Icon';
import type { ScheduleYear } from '../state/derived';
import { amount, count, currency, date, monthYear } from '../state/display';
import { t } from '../state/i18n';
import { useFocusAfterRender } from './focus';
import {
  INITIAL_YEARS,
  PREVIEW_ROWS,
  type ScheduleModel,
  scheduleView,
  showAllYears,
  showRestOfFirstYear,
  toggleYear,
} from './view';

const CAPTION_ID = 'schedule-caption';

/** The id of a payment row's header cell that takes focus after "Show more". */
function rowHeaderId(index: number): string {
  return `schedule-row-${String(index)}`;
}

function yearId(year: number): string {
  return `schedule-year-${String(year)}`;
}

function yearToggleId(year: number): string {
  return `schedule-year-${String(year)}-toggle`;
}

function PaymentRow(props: {
  readonly row: LedgerRow;
  readonly model: ScheduleModel;
  readonly focusTarget: boolean;
}): JSX.Element {
  const { row, model } = props;
  return (
    <tr>
      <th
        scope="row"
        class="schedule-table__start schedule-table__index num"
        {...(props.focusTarget ? { id: rowHeaderId(row.index), tabIndex: -1 } : {})}
      >
        {count(row.index)}
      </th>
      <td class="schedule-table__start num">{date(row.date)}</td>
      <td class="num">{amount(row.payment)}</td>
      <td class="num">{amount(row.principal)}</td>
      <td class="num schedule__interest">{amount(row.interestPaid)}</td>
      {model.showFees && <td class="num">{amount(row.fees)}</td>}
      {model.showInsurance && <td class="num">{amount(row.insurance)}</td>}
      <td class="num">{amount(row.closing)}</td>
    </tr>
  );
}

/**
 * One loan year: the group row (a button that opens or closes the year, the principal and
 * interest subtotals and the closing balance) and, when open, its payment rows. The rows
 * of a closed year are not rendered, so a 1 200-payment loan stays fast.
 */
function YearGroup(props: {
  readonly year: ScheduleYear;
  readonly model: ScheduleModel;
  readonly columns: number;
  readonly onShowMore: () => void;
}): JSX.Element {
  const { year, model } = props;
  const view = scheduleView.value;
  const open = view.expanded.has(year.year);
  const preview = year.year === 1 && view.firstYearPreview && year.rows.length > PREVIEW_ROWS;
  const rows = !open ? [] : preview ? year.rows.slice(0, PREVIEW_ROWS) : year.rows;
  const id = yearId(year.year);
  return (
    <tbody id={id}>
      <tr class="schedule-table__group">
        <th scope="rowgroup" colSpan={3} class="schedule-table__start">
          <button
            type="button"
            id={yearToggleId(year.year)}
            class="schedule-table__toggle"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => {
              toggleYear(year.year);
            }}
          >
            <span class="schedule-table__year">{t('schedule.year', { year: year.year })}</span>{' '}
            <span class="schedule-table__range">
              {'· '}
              {t('schedule.yearRange', {
                from: monthYear(year.firstDate),
                to: monthYear(year.lastDate),
              })}
            </span>
            <Icon name="chevron-down" class="schedule-table__chevron" />
          </button>
        </th>
        <td class="num">{amount(year.principal)}</td>
        <td class="num schedule__interest">{amount(year.interest)}</td>
        {model.showFees && <td />}
        {model.showInsurance && <td />}
        <td class="num">{amount(year.closing)}</td>
      </tr>
      {rows.map((row, position) => (
        <PaymentRow
          key={row.index}
          row={row}
          model={model}
          focusTarget={year.year === 1 && position === PREVIEW_ROWS}
        />
      ))}
      {open && preview && (
        <tr class="schedule-table__more">
          <td colSpan={props.columns} class="schedule-table__start">
            <button type="button" class="btn btn--accent" onClick={props.onShowMore}>
              {t('schedule.showMore', { count: year.rows.length - PREVIEW_ROWS })}
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/**
 * The desktop schedule table (DESIGN §8.10): loan-year groups with subtotals, the totals
 * row and the column headers; Fees and Insurance columns only when their totals are not
 * zero. It scrolls inside its own focusable region when the window is too narrow.
 *
 * Focus after a control that disappears: "Show N more payments" moves focus to the first
 * newly shown payment (its row header), "N more years" to the toggle of the first newly
 * listed year, so keyboard users continue where the new content starts.
 */
export function ScheduleTable(props: { readonly model: ScheduleModel }): JSX.Element {
  const { model } = props;
  const view = scheduleView.value;
  const focusAfterRender = useFocusAfterRender();

  const columns = 6 + (model.showFees ? 1 : 0) + (model.showInsurance ? 1 : 0);
  const years = view.allYears ? model.years : model.years.slice(0, INITIAL_YEARS);
  const hiddenYears = model.years.length - years.length;
  const { totals } = model;

  return (
    <div
      class="schedule-table"
      role="region"
      aria-labelledby={CAPTION_ID}
      // A keyboard user must be able to scroll the table when it is wider than the card.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <table class="schedule-table__table">
        <caption id={CAPTION_ID} class="visually-hidden">
          {t('schedule.caption', { currency: currency.value })}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="schedule-table__start">
              <span aria-hidden="true">#</span>
              <span class="visually-hidden">{t('schedule.colNumber')}</span>
            </th>
            <th scope="col" class="schedule-table__start">
              {t('schedule.colDate')}
            </th>
            <th scope="col">{t('schedule.colPayment')}</th>
            <th scope="col">{t('schedule.colPrincipal')}</th>
            <th scope="col">{t('schedule.colInterest')}</th>
            {model.showFees && <th scope="col">{t('schedule.colFees')}</th>}
            {model.showInsurance && <th scope="col">{t('schedule.colInsurance')}</th>}
            <th scope="col">{t('schedule.colBalance')}</th>
          </tr>
        </thead>
        {years.map((year) => (
          <YearGroup
            key={year.year}
            year={year}
            model={model}
            columns={columns}
            onShowMore={() => {
              focusAfterRender(rowHeaderId(PREVIEW_ROWS + 1));
              showRestOfFirstYear();
            }}
          />
        ))}
        {hiddenYears > 0 && (
          <tbody>
            <tr class="schedule-table__more">
              <td colSpan={columns} class="schedule-table__start">
                <button
                  type="button"
                  class="schedule-table__more-years"
                  onClick={() => {
                    focusAfterRender(yearToggleId(INITIAL_YEARS + 1));
                    showAllYears();
                  }}
                >
                  {t('schedule.moreYears', { count: hiddenYears })}
                </button>
              </td>
            </tr>
          </tbody>
        )}
        <tfoot>
          <tr class="schedule-table__totals">
            <th scope="row" colSpan={2} class="schedule-table__start">
              {t('schedule.total', { count: totals.count })}
            </th>
            <td class="num">{amount(totals.payment)}</td>
            <td class="num">{amount(totals.principal)}</td>
            <td class="num schedule__interest">{amount(totals.interest)}</td>
            {model.showFees && <td class="num">{amount(totals.fees)}</td>}
            {model.showInsurance && <td class="num">{amount(totals.insurance)}</td>}
            <td class="num schedule-table__settled">{amount(totals.closing)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
