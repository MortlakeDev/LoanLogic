// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { FREQUENCY_IDS, type RepaymentType } from '../../engine';
import { ChoiceCards, type ChoiceOption } from '../components/ChoiceCards';
import {
  describedBy,
  errorIdFor,
  Field,
  FieldError,
  hasError,
  NumberInput,
} from '../components/Field';
import { Icon } from '../components/Icon';
import { SegmentedControl } from '../components/SegmentedControl';
import { currency, currencyDigits, currencySymbol, date, money } from '../state/display';
import { formatLocale, t } from '../state/i18n';
import { type FieldPath, type LoanForm, form, okResult, updateForm } from '../state/loan';
import { frequencyName } from '../state/messages';
import { DateControl, optional } from './controls';
import {
  COMMON_CURRENCIES,
  currencyOptionLabel,
  OTHER_CURRENCIES,
  scheduledPayments,
} from './view';

/** The "Loan" section of the inputs panel (DESIGN §8.2–§8.4, T03 brief §3). */
export function LoanSection(): JSX.Element {
  const wide = form.value.termMode === 'endDate';
  return (
    <div class="inputs__section">
      <h3 class="section-label">{t('inputs.loanSection')}</h3>
      <AmountField />
      {/* A date needs the full width; years and months or a count fit next to the rate. */}
      <div class={wide ? 'inputs__pair inputs__pair--wide' : 'inputs__pair'}>
        <RateField />
        <TermField />
      </div>
      <FrequencyField />
      <RepaymentField />
      <DisbursementField />
    </div>
  );
}

function AmountField(): JSX.Element {
  return (
    <Field
      label={t('inputs.amount')}
      inputId="field-amount"
      fields={['amount', 'currency']}
      class="amount"
    >
      <div class="amount__row">
        <NumberInput
          id="field-amount"
          field="amount"
          kind="money"
          size="lg"
          value={form.value.amount}
          onValue={(amount) => {
            updateForm({ amount });
          }}
          prefix={currencySymbol()}
          fractionDigits={currencyDigits.value}
        />
        <CurrencySelect />
      </div>
    </Field>
  );
}

/**
 * The currency: a native select over a compact face that shows the code, so the amount
 * keeps its width on a 360 px screen; the select itself (transparent, on top) takes the
 * pointer, the keyboard and the accessible name, and lists "USD · US dollar".
 */
function CurrencySelect(): JSX.Element {
  const code = currency.value;
  const locale = formatLocale.value;
  // About 180 options: rebuild them only when the language changes.
  const options = useMemo(
    () => ({
      common: COMMON_CURRENCIES.map((item) => ({ code: item, label: currencyOptionLabel(item) })),
      other: OTHER_CURRENCIES.map((item) => ({ code: item, label: currencyOptionLabel(item) })),
    }),
    // `currencyOptionLabel` reads the language through `t`; the locale follows it.
    [locale],
  );
  const invalid = hasError('currency');
  return (
    <div class="currency">
      <select
        id="field-currency"
        class="currency__select"
        value={code}
        aria-label={t('inputs.currency')}
        aria-invalid={invalid}
        aria-describedby={describedBy('currency')}
        onChange={(event) => {
          updateForm({ currency: event.currentTarget.value });
        }}
      >
        <optgroup label={t('inputs.currencyCommon')}>
          {options.common.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('inputs.currencyAll')}>
          {options.other.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </optgroup>
      </select>
      <span class={`currency__face${invalid ? ' currency__face--invalid' : ''}`} aria-hidden="true">
        <span class="num">{code}</span>
        <Icon name="chevron-down" />
      </span>
    </div>
  );
}

function RateField(): JSX.Element {
  const hintId = 'field-annualRatePct-hint';
  return (
    <Field
      label={t('inputs.rate')}
      inputId="field-annualRatePct"
      hint={t('inputs.rateHint')}
      hintId={hintId}
      fields={['annualRatePct']}
    >
      <NumberInput
        id="field-annualRatePct"
        field="annualRatePct"
        kind="percent"
        value={form.value.annualRatePct}
        onValue={(annualRatePct) => {
          updateForm({ annualRatePct });
        }}
        suffix={t('units.percent')}
        hintId={hintId}
      />
    </Field>
  );
}

/** The fields whose errors the term shows, by term mode (SPEC §2.4, §13). */
function termFields(value: LoanForm): readonly FieldPath[] {
  switch (value.termMode) {
    case 'years':
      return ['term.years', 'term.months', 'term'];
    case 'payments':
      return ['term.payments', 'term'];
    case 'endDate':
      return ['term.endDate', 'term'];
  }
}

/**
 * The term in the mode chosen in Advanced: years and months in one box, a number of
 * payments, or the date of the last payment. The fieldset carries the id of the `term`
 * field (errors on the whole term, such as `TERM_TOO_SHORT`), so an error there can move
 * focus to the group, which then announces the error.
 */
function TermField(): JSX.Element {
  const value = form.value;
  const count = scheduledPayments(okResult.value);
  const hintId = 'field-term-hint';
  const legendId = 'field-term-legend';
  const fields = termFields(value);
  const termInvalid = hasError('term');
  // The inputs are described by the shared hint and by the error of the whole term.
  const shared =
    [count === null ? undefined : hintId, termInvalid ? errorIdFor('term') : undefined]
      .filter((id): id is string => id !== undefined)
      .join(' ') || undefined;
  const legend =
    value.termMode === 'years'
      ? t('inputs.term')
      : value.termMode === 'payments'
        ? t('inputs.termPayments')
        : t('inputs.termEndDate');
  const boxInvalid = fields.some((field) => hasError(field));
  return (
    <fieldset
      id="field-term"
      class="field term"
      tabIndex={-1}
      {...optional('aria-describedby', termInvalid ? errorIdFor('term') : undefined)}
    >
      <legend id={legendId} class="field__label">
        {legend}
      </legend>
      {value.termMode === 'years' && (
        <div class={`term__box${boxInvalid ? ' term__box--invalid' : ''}`}>
          <NumberInput
            id="field-term-years"
            field="term.years"
            kind="integer"
            value={value.termYears}
            onValue={(termYears) => {
              updateForm({ termYears });
            }}
            // The name contains the unit shown next to the digits (WCAG 2.5.3 label in name).
            ariaLabel={t('inputs.termUnitLabel', {
              name: t('inputs.termYears'),
              unit: t('units.years'),
            })}
            suffix={t('units.years')}
            invalid={termInvalid}
            {...optional('hintId', shared)}
          />
          <NumberInput
            id="field-term-months"
            field="term.months"
            kind="integer"
            value={value.termMonths}
            onValue={(termMonths) => {
              updateForm({ termMonths });
            }}
            ariaLabel={t('inputs.termUnitLabel', {
              name: t('inputs.termMonths'),
              unit: t('units.months'),
            })}
            suffix={t('units.months')}
            invalid={termInvalid}
            {...optional('hintId', shared)}
          />
        </div>
      )}
      {value.termMode === 'payments' && (
        <NumberInput
          id="field-term-payments"
          field="term.payments"
          kind="integer"
          value={value.termPayments}
          onValue={(termPayments) => {
            updateForm({ termPayments });
          }}
          ariaLabel={legend}
          invalid={termInvalid}
          {...optional('hintId', shared)}
        />
      )}
      {value.termMode === 'endDate' && (
        <DateControl
          id="field-term-endDate"
          field="term.endDate"
          value={value.termEndDate}
          onValue={(termEndDate) => {
            updateForm({ termEndDate });
          }}
          labelledBy={legendId}
          describedBy={shared}
          invalid={termInvalid}
        />
      )}
      {count !== null && (
        <p id={hintId} class="field__hint">
          {t('inputs.paymentsCount', { count })}
        </p>
      )}
      {fields.map((field) => (
        <FieldError key={field} field={field} />
      ))}
    </fieldset>
  );
}

function FrequencyField(): JSX.Element {
  return (
    <div class="field">
      <SegmentedControl
        name="frequency"
        legend={t('inputs.frequency')}
        options={FREQUENCY_IDS.map((id) => ({ value: id, label: frequencyName(id) }))}
        value={form.value.frequency}
        onChange={(frequency) => {
          updateForm({ frequency });
        }}
        variant="solid"
        columns={3}
        id="field-frequency"
        {...optional('describedBy', describedBy('frequency'))}
      />
      <FieldError field="frequency" />
    </div>
  );
}

function repaymentOptions(): readonly ChoiceOption<RepaymentType>[] {
  return [
    {
      value: 'annuity',
      title: t('repayment.annuity'),
      description: t('repayment.annuityText'),
    },
    {
      value: 'equal-principal',
      title: t('repayment.equalPrincipal'),
      description: t('repayment.equalPrincipalText'),
    },
    { value: 'bullet', title: t('repayment.bullet'), description: t('repayment.bulletText') },
    { value: 'balloon', title: t('repayment.balloon'), description: t('repayment.balloonText') },
  ];
}

/**
 * The repayment type (DESIGN §8.4). The wrapper carries the field's id, so an error on
 * the field can move focus to the cards.
 */
function RepaymentField(): JSX.Element {
  const repayment = form.value.repayment;
  return (
    <div
      id="field-repayment"
      class="field"
      tabIndex={-1}
      {...optional('aria-describedby', hasError('repayment') ? errorIdFor('repayment') : undefined)}
    >
      <ChoiceCards
        name="repayment"
        legend={t('inputs.repayment')}
        options={repaymentOptions()}
        value={repayment}
        onChange={(next) => {
          updateForm({ repayment: next });
        }}
      />
      <FieldError field="repayment" />
      {repayment === 'balloon' && <BalloonField />}
    </div>
  );
}

/** The balloon residual (SPEC §5.5): an amount or a percentage of the principal. */
function BalloonField(): JSX.Element {
  const value = form.value;
  const percent = value.balloonKind === 'percent';
  const balloon = okResult.value?.summary.balloon ?? null;
  const hintId = 'field-balloon-value-hint';
  return (
    <Field
      label={t('inputs.balloon')}
      inputId="field-balloon-value"
      {...optional(
        'hint',
        balloon === null ? undefined : t('inputs.balloonHint', { amount: money(balloon) }),
      )}
      hintId={hintId}
      fields={['balloon.value', 'balloon.kind']}
      class="balloon"
    >
      <div class="balloon__row">
        <NumberInput
          // A new kind starts from the stored value, not from text typed for the other kind.
          key={value.balloonKind}
          id="field-balloon-value"
          field="balloon.value"
          kind={percent ? 'percent' : 'money'}
          value={value.balloonValue}
          onValue={(balloonValue) => {
            updateForm({ balloonValue });
          }}
          {...(percent
            ? { suffix: t('units.percent') }
            : { prefix: currencySymbol(), fractionDigits: currencyDigits.value })}
          {...optional('hintId', balloon === null ? undefined : hintId)}
        />
        <SegmentedControl
          name="balloonKind"
          legend={t('inputs.balloonKind')}
          hideLegend
          options={[
            { value: 'amount', label: t('inputs.balloonAsAmount') },
            { value: 'percent', label: t('inputs.balloonAsPercent') },
          ]}
          value={value.balloonKind}
          onChange={(balloonKind) => {
            updateForm({ balloonKind });
          }}
          variant="solid"
          columns={2}
          id="field-balloon-kind"
          {...optional('describedBy', describedBy('balloon.kind'))}
        />
      </div>
    </Field>
  );
}

function DisbursementField(): JSX.Element {
  const first = okResult.value?.summary.firstPaymentDate;
  const hintId = 'field-disbursementDate-hint';
  return (
    <Field
      label={t('inputs.disbursementDate')}
      inputId="field-disbursementDate"
      {...optional(
        'hint',
        first === undefined ? undefined : t('inputs.firstPayment', { date: date(first) }),
      )}
      hintId={hintId}
      fields={['disbursementDate']}
    >
      <DateControl
        id="field-disbursementDate"
        field="disbursementDate"
        value={form.value.disbursementDate}
        onValue={(disbursementDate) => {
          updateForm({ disbursementDate });
        }}
        describedBy={first === undefined ? undefined : hintId}
      />
    </Field>
  );
}
