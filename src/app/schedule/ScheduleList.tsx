// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { ComponentChildren, JSX } from 'preact';
import { Rich } from '../components/Rich';
import { amount, currency, date, money, monthYear } from '../state/display';
import { t } from '../state/i18n';
import { useFocusAfterRender } from './focus';
import { LIST_PREVIEW, type ScheduleModel, scheduleView, showWholeList } from './view';

/** The element id of the mobile list; the "Yearly summary" switch controls it. */
export const SCHEDULE_LIST_ID = 'schedule-list';

/** The id of the list item that takes focus after "Show all N payments". */
function itemId(index: number): string {
  return `schedule-item-${String(index)}`;
}

/** The parts of a payment or a year: principal, interest, and fees and insurance if any. */
interface Parts {
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
}

function Figure(props: { readonly value: string; readonly class?: string }): JSX.Element {
  return (
    <span class={props.class === undefined ? 'num' : `num ${props.class}`}>{props.value}</span>
  );
}

/** "Principal 294.04 · Interest 2,005.21" (· Fees … · Insurance … when the loan has them). */
function PartsLine(props: { readonly parts: Parts; readonly model: ScheduleModel }): JSX.Element {
  const { parts, model } = props;
  const items: ComponentChildren[] = [
    <Rich
      key="principal"
      message="schedule.itemPrincipal"
      nodes={{ amount: <Figure value={amount(parts.principal)} /> }}
    />,
    <Rich
      key="interest"
      message="schedule.itemInterest"
      nodes={{ amount: <Figure value={amount(parts.interest)} class="schedule__interest" /> }}
    />,
  ];
  if (model.showFees) {
    items.push(
      <Rich
        key="fees"
        message="schedule.itemFees"
        nodes={{ amount: <Figure value={amount(parts.fees)} /> }}
      />,
    );
  }
  if (model.showInsurance) {
    items.push(
      <Rich
        key="insurance"
        message="schedule.itemInsurance"
        nodes={{ amount: <Figure value={amount(parts.insurance)} /> }}
      />,
    );
  }
  return (
    <span class="schedule-list__parts">
      {items.map((item, position) => (
        <span key={position}>
          {position > 0 && ' · '}
          {item}
        </span>
      ))}
    </span>
  );
}

function Balance(props: { readonly value: string }): JSX.Element {
  return (
    <span class="schedule-list__balance">
      <Rich
        message="schedule.itemBalance"
        nodes={{ amount: <Figure value={amount(props.value)} /> }}
      />
    </span>
  );
}

/** One item per payment: the first `LIST_PREVIEW`, or all after "Show all". */
function PaymentItems(props: {
  readonly model: ScheduleModel;
  readonly onShowAll: () => void;
}): JSX.Element {
  const { model } = props;
  const whole = scheduleView.value.wholeList || model.rows.length <= LIST_PREVIEW;
  const rows = whole ? model.rows : model.rows.slice(0, LIST_PREVIEW);
  return (
    <>
      {/* WebKit drops the list role of a list without bullets; the role restores it. */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ol role="list" class="schedule-list__items" aria-label={caption()}>
        {rows.map((row, position) => (
          <li
            key={row.index}
            class="schedule-list__item"
            {...(position === LIST_PREVIEW ? { id: itemId(row.index), tabIndex: -1 } : {})}
          >
            <div class="schedule-list__line">
              <span class="schedule-list__title">
                {t('schedule.item', { number: row.index, date: date(row.date) })}
              </span>
              <Balance value={row.closing} />
            </div>
            <div class="schedule-list__line">
              <Figure value={money(row.payment)} class="schedule-list__amount" />
              <PartsLine
                model={model}
                parts={{
                  principal: row.principal,
                  interest: row.interestPaid,
                  fees: row.fees,
                  insurance: row.insurance,
                }}
              />
            </div>
          </li>
        ))}
      </ol>
      {!whole && (
        <div class="schedule-list__more">
          <button type="button" class="btn btn--accent" onClick={props.onShowAll}>
            {t('schedule.showAll', { count: model.rows.length })}
          </button>
        </div>
      )}
    </>
  );
}

/** One item per loan year (the "Yearly summary" view). */
function YearItems(props: { readonly model: ScheduleModel }): JSX.Element {
  const { model } = props;
  return (
    // WebKit drops the list role of a list without bullets; the role restores it.
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <ol role="list" class="schedule-list__items" aria-label={caption()}>
      {model.years.map((year) => (
        <li key={year.year} class="schedule-list__item">
          <div class="schedule-list__line">
            <span class="schedule-list__title">
              {t('schedule.year', { year: year.year })}
              {' · '}
              {t('schedule.yearRange', {
                from: monthYear(year.firstDate),
                to: monthYear(year.lastDate),
              })}
            </span>
            <Balance value={year.closing} />
          </div>
          <div class="schedule-list__line">
            <span class="schedule-list__paid">
              <Rich
                message="schedule.yearPaid"
                nodes={{
                  amount: <Figure value={money(year.payment)} class="schedule-list__amount" />,
                }}
              />
            </span>
            <PartsLine model={model} parts={year} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function caption(): string {
  return t('schedule.caption', { currency: currency.value });
}

/**
 * The schedule as a list (DESIGN §7.2), shown instead of the table below 64rem: per
 * payment "No. 1 · Dec 1, 2026" and the balance, then the payment and its parts; or, with
 * "Yearly summary" on, one item per loan year.
 *
 * "Show all N payments" disappears when pressed, so focus moves to the first newly shown
 * payment.
 */
export function ScheduleList(props: { readonly model: ScheduleModel }): JSX.Element {
  const focusAfterRender = useFocusAfterRender();

  return (
    <div id={SCHEDULE_LIST_ID} class="schedule-list">
      {scheduleView.value.yearly ? (
        <YearItems model={props.model} />
      ) : (
        <PaymentItems
          model={props.model}
          onShowAll={() => {
            focusAfterRender(itemId(LIST_PREVIEW + 1));
            showWholeList();
          }}
        />
      )}
    </div>
  );
}
