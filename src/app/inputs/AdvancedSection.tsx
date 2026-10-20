// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import {
  type CompoundingId,
  DAY_COUNT_IDS,
  FREQUENCY_IDS,
  type PaymentRounding,
  RATE_METHOD_IDS,
  type RateMethodId,
  type RoundingMode,
} from '../../engine';
import { Disclosure } from '../components/Disclosure';
import { describedBy, FieldError, hasError } from '../components/Field';
import { SegmentedControl } from '../components/SegmentedControl';
import { t } from '../state/i18n';
import { type LoanForm, type TermMode, form, okResult, updateForm } from '../state/loan';
import {
  automaticMethod,
  dayCountName,
  frequencyName,
  methodName,
  roundingModeName,
} from '../state/messages';
import { advancedOpen } from '../state/ui';
import { optional, type SelectOption, SelectField } from './controls';
import {
  advancedStatus,
  headlineOptionLabel,
  isMonthEnd,
  paymentRoundingLabel,
  termModePatch,
} from './view';

const ROUNDING_MODES: readonly RoundingMode[] = ['half-up', 'half-even', 'ceil', 'floor'];

const PAYMENT_ROUNDINGS: readonly PaymentRounding[] = [
  'minor-half-up',
  'minor-ceil',
  'unit-half-up',
  'unit-ceil',
];

function termModeOptions(): readonly SelectOption<TermMode>[] {
  return [
    { value: 'years', label: t('termMode.years') },
    { value: 'payments', label: t('termMode.payments') },
    { value: 'endDate', label: t('termMode.endDate') },
  ];
}

function compoundingOptions(): readonly SelectOption<CompoundingId | 'payment'>[] {
  return [
    { value: 'payment', label: t('compounding.payment') },
    ...FREQUENCY_IDS.map((id) => ({ value: id, label: frequencyName(id) })),
    { value: 'continuous', label: t('compounding.continuous') },
  ];
}

function roundingOptions(): readonly SelectOption<RoundingMode>[] {
  return ROUNDING_MODES.map((mode) => ({ value: mode, label: roundingModeName(mode) }));
}

function headlineOptions(): readonly SelectOption<RateMethodId | 'auto'>[] {
  return [
    { value: 'auto', label: t('advanced.headlineAuto', { method: methodName(automaticMethod()) }) },
    ...RATE_METHOD_IDS.map((method) => ({ value: method, label: headlineOptionLabel(method) })),
  ];
}

/**
 * The Advanced disclosure (DESIGN §8.5, T03 brief §3): term mode, interest model,
 * rounding, the end-of-month rule and the headline rate method, with a status line.
 * Controls that do not apply to the loan are hidden, unless the engine reports an error
 * on them, so every error stays visible under its field.
 */
export function AdvancedSection(): JSX.Element {
  const value = form.value;
  return (
    <Disclosure
      id="advanced"
      class="advanced"
      title={t('advanced.title')}
      status={advancedStatus(value)}
      open={advancedOpen.value}
      onToggle={(open) => {
        advancedOpen.value = open;
      }}
    >
      <SelectField
        id="field-termMode"
        label={t('advanced.termMode')}
        options={termModeOptions()}
        value={value.termMode}
        onChange={(mode) => {
          updateForm(termModePatch(mode, okResult.value));
        }}
      />
      <InterestFields value={value} />
      <RoundingFields value={value} />
      {(isMonthEnd(value.disbursementDate) || hasError('endOfMonth')) && (
        <div class="field">
          <label class="check">
            <input
              id="field-endOfMonth"
              type="checkbox"
              checked={value.endOfMonth}
              aria-invalid={hasError('endOfMonth')}
              aria-describedby={describedBy('endOfMonth', 'field-endOfMonth-hint')}
              onChange={(event) => {
                updateForm({ endOfMonth: event.currentTarget.checked });
              }}
            />
            {t('advanced.endOfMonth')}
          </label>
          <p id="field-endOfMonth-hint" class="field__hint">
            {t('advanced.endOfMonthHint')}
          </p>
          <FieldError field="endOfMonth" />
        </div>
      )}
      <SelectField
        id="field-rateMethods"
        field="rateMethods"
        label={t('advanced.headline')}
        options={headlineOptions()}
        value={value.headlineMethod}
        onChange={(headlineMethod) => {
          updateForm({ headlineMethod });
        }}
      />
    </Disclosure>
  );
}

/** The interest model: periodic with compounding, or day count with method and basis. */
function InterestFields(props: { readonly value: LoanForm }): JSX.Element {
  const { value } = props;
  return (
    <>
      <div class="field">
        <SegmentedControl
          name="accrualMode"
          legend={t('advanced.interestModel')}
          options={[
            { value: 'periodic', label: t('interestModel.periodic') },
            { value: 'daycount', label: t('interestModel.daycount') },
          ]}
          value={value.accrualMode}
          onChange={(accrualMode) => {
            updateForm({ accrualMode });
          }}
          variant="solid"
          columns={2}
          id="field-accrual-mode"
          {...optional('describedBy', describedBy('accrual.mode'))}
        />
        <FieldError field="accrual.mode" />
      </div>
      {value.accrualMode === 'periodic' ? (
        <SelectField
          id="field-accrual-compounding"
          field="accrual.compounding"
          label={t('advanced.compounding')}
          options={compoundingOptions()}
          value={value.compounding}
          onChange={(compounding) => {
            updateForm({ compounding });
          }}
        />
      ) : (
        <>
          <SelectField
            id="field-accrual-method"
            field="accrual.method"
            label={t('advanced.dayCount')}
            options={DAY_COUNT_IDS.map((id) => ({ value: id, label: dayCountName(id) }))}
            value={value.dayCount}
            onChange={(dayCount) => {
              updateForm({ dayCount });
            }}
          />
          <SelectField
            id="field-accrual-paymentBasis"
            field="accrual.paymentBasis"
            label={t('advanced.paymentBasis')}
            options={[
              { value: 'nominal', label: t('paymentBasis.nominal') },
              { value: 'exact', label: t('paymentBasis.exact') },
            ]}
            value={value.paymentBasis}
            onChange={(paymentBasis) => {
              updateForm({ paymentBasis });
            }}
          />
        </>
      )}
    </>
  );
}

/** Rounding (SPEC §1.3–§1.5); the principal remainder applies to equal principal only. */
function RoundingFields(props: { readonly value: LoanForm }): JSX.Element {
  const { value } = props;
  return (
    <fieldset class="field advanced__rounding">
      <legend class="field__label">{t('advanced.rounding')}</legend>
      <SelectField
        id="field-rounding-interest"
        field="rounding.interest"
        label={t('advanced.roundingInterest')}
        options={roundingOptions()}
        value={value.roundingInterest}
        onChange={(roundingInterest) => {
          updateForm({ roundingInterest });
        }}
      />
      <SelectField
        id="field-rounding-payment"
        field="rounding.payment"
        label={t('advanced.roundingPayment')}
        options={PAYMENT_ROUNDINGS.map((policy) => ({
          value: policy,
          label: paymentRoundingLabel(policy),
        }))}
        value={value.roundingPayment}
        onChange={(roundingPayment) => {
          updateForm({ roundingPayment });
        }}
      />
      <SelectField
        id="field-rounding-fees"
        field="rounding.fees"
        label={t('advanced.roundingFees')}
        options={roundingOptions()}
        value={value.roundingFees}
        onChange={(roundingFees) => {
          updateForm({ roundingFees });
        }}
      />
      {(value.repayment === 'equal-principal' || hasError('rounding.principalRemainder')) && (
        <SelectField
          id="field-rounding-principalRemainder"
          field="rounding.principalRemainder"
          label={t('advanced.principalRemainder')}
          options={[
            { value: 'last', label: t('principalRemainder.last') },
            { value: 'first', label: t('principalRemainder.first') },
          ]}
          value={value.principalRemainder}
          onChange={(principalRemainder) => {
            updateForm({ principalRemainder });
          }}
        />
      )}
    </fieldset>
  );
}
