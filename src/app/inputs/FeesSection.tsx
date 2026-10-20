// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorIdFor, Field, FieldError, hasError, NumberInput } from '../components/Field';
import { Icon } from '../components/Icon';
import { currencyDigits, currencySymbol } from '../state/display';
import { t } from '../state/i18n';
import {
  type FeeDraft,
  addFee,
  feeValueField,
  form,
  headlineMethod,
  okResult,
  removeFee,
  updateFee,
} from '../state/loan';
import { defaultFeeName, methodShortName } from '../state/messages';
import { optional, type SelectOption, SelectField } from './controls';
import { feeCalcOf, feeSummary } from './view';

/**
 * The fee and insurance editor (T03 brief §3, DESIGN §8.2): one row per item, an add
 * button and the error of the whole section (`FEE_RANGE` on `fees`: the upfront fees
 * paid at closing reach the amount). The section carries the `fees` field's id.
 */
export function FeesSection(): JSX.Element {
  const fees = form.value.fees;
  const addButton = useRef<HTMLButtonElement>(null);
  // The row whose name input takes focus once it has rendered.
  const [focusUid, setFocusUid] = useState<string | null>(null);

  useEffect(() => {
    if (focusUid !== null) {
      document.getElementById(`fee-${focusUid}-name`)?.focus();
      setFocusUid(null);
    }
  }, [focusUid]);

  const remove = (uid: string): void => {
    removeFee(uid);
    // The row and its focused button are gone; the add button stays in place.
    addButton.current?.focus();
  };

  return (
    <section
      id="field-fees"
      class="fees"
      tabIndex={-1}
      aria-labelledby="fees-title"
      aria-describedby={hasError('fees') ? errorIdFor('fees') : undefined}
    >
      <h3 id="fees-title" class="section-label">
        {t('fees.title')}
      </h3>
      {fees.length === 0 ? (
        <p class="fees__empty">{t('fees.none')}</p>
      ) : (
        <ul class="fees__list">
          {fees.map((fee) => (
            <li key={fee.uid}>
              <FeeRow fee={fee} onRemove={remove} />
            </li>
          ))}
        </ul>
      )}
      <FieldError field="fees" />
      <button
        ref={addButton}
        type="button"
        class="btn btn--add fees__add"
        aria-label={t('fees.addLabel')}
        onClick={() => {
          setFocusUid(addFee());
        }}
      >
        <Icon name="plus" />
        <span>{t('fees.add')}</span>
      </button>
    </section>
  );
}

function kindOptions(): readonly SelectOption<FeeDraft['kind']>[] {
  return [
    { value: 'upfront', label: t('fees.kindUpfront') },
    { value: 'periodic', label: t('fees.kindPeriodic') },
    { value: 'insurance', label: t('fees.kindInsurance') },
  ];
}

function calcOptions(kind: FeeDraft['kind']): readonly SelectOption<FeeDraft['calc']>[] {
  return kind === 'upfront'
    ? [
        { value: 'fixed', label: t('fees.calcFixed') },
        { value: 'percent', label: t('fees.calcPctAmount') },
      ]
    : [
        { value: 'fixed', label: t('fees.calcFixed') },
        { value: 'pct-original', label: t('fees.calcPctAmount') },
        { value: 'pct-balance', label: t('fees.calcPctBalance') },
      ];
}

function financingOptions(): readonly SelectOption<FeeDraft['financing']>[] {
  return [
    { value: 'paid', label: t('fees.financingPaid') },
    { value: 'financed', label: t('fees.financingFinanced') },
  ];
}

/**
 * One fee or insurance item: name, kind, calculation, value, financing (upfront only)
 * and "In {rateName}" (GLOSSARY §4), with the engine's amounts in the hint line.
 */
function FeeRow(props: {
  readonly fee: FeeDraft;
  readonly onRemove: (uid: string) => void;
}): JSX.Element {
  const { fee } = props;
  const base = `fee-${fee.uid}`;
  const valueField = feeValueField(fee.uid);
  const calc = feeCalcOf(fee);
  const percent = calc !== 'fixed';
  const rateName = methodShortName(headlineMethod.value);
  const name = fee.name === '' ? defaultFeeName(fee.kind) : fee.name;
  const summary = feeSummary(
    fee,
    okResult.value?.fees.find((item) => item.id === fee.uid),
    rateName,
  );
  const summaryId = `${base}-summary`;
  // A percentage of a periodic item is charged every period, not once (SPEC §6.2).
  const valueHint = fee.kind !== 'upfront' && percent ? t('fees.valuePerPeriod') : undefined;
  const valueHintId = `${base}-value-hint`;
  const valueDescribedBy =
    [valueHint === undefined ? undefined : valueHintId, summary === null ? undefined : summaryId]
      .filter((id): id is string => id !== undefined)
      .join(' ') || undefined;

  return (
    <fieldset class="fee">
      <legend class="visually-hidden">{name}</legend>
      <div class="fee__head">
        <Field label={t('fees.name')} inputId={`${base}-name`} fields={[]}>
          <div class="control">
            <input
              id={`${base}-name`}
              class="control__input"
              type="text"
              autoComplete="off"
              value={fee.name}
              placeholder={defaultFeeName(fee.kind)}
              onInput={(event) => {
                updateFee(fee.uid, { name: event.currentTarget.value });
              }}
            />
          </div>
        </Field>
        <button
          type="button"
          class="btn btn--icon fee__remove"
          aria-label={t('fees.remove', { name })}
          onClick={() => {
            props.onRemove(fee.uid);
          }}
        >
          <Icon name="x" />
        </button>
      </div>
      <SelectField
        id={`${base}-kind`}
        label={t('fees.kind')}
        options={kindOptions()}
        value={fee.kind}
        onChange={(kind) => {
          updateFee(fee.uid, { kind });
        }}
      />
      <SelectField
        id={`${base}-calc`}
        label={t('fees.calc')}
        options={calcOptions(fee.kind)}
        value={calc}
        onChange={(next) => {
          updateFee(fee.uid, { calc: next });
        }}
      />
      <Field
        label={t('fees.value')}
        inputId={`${base}-value`}
        {...optional('hint', valueHint)}
        hintId={valueHintId}
        fields={[valueField]}
      >
        <NumberInput
          // Money and percentages parse differently: a new kind starts from the stored value.
          key={percent ? 'percent' : 'money'}
          id={`${base}-value`}
          field={valueField}
          kind={percent ? 'percent' : 'money'}
          value={fee.value}
          onValue={(value) => {
            updateFee(fee.uid, { value });
          }}
          {...(percent
            ? { suffix: t('units.percent') }
            : { prefix: currencySymbol(), fractionDigits: currencyDigits.value })}
          {...optional('hintId', valueDescribedBy)}
        />
      </Field>
      {fee.kind === 'upfront' && (
        <SelectField
          id={`${base}-financing`}
          label={t('fees.financing')}
          options={financingOptions()}
          value={fee.financing}
          onChange={(financing) => {
            updateFee(fee.uid, { financing });
          }}
        />
      )}
      <label class="check">
        <input
          id={`${base}-inApr`}
          type="checkbox"
          checked={fee.inApr}
          onChange={(event) => {
            updateFee(fee.uid, { inApr: event.currentTarget.checked });
          }}
        />
        {t('fees.inRate', { rateName })}
      </label>
      {summary !== null && (
        <p id={summaryId} class="field__hint fee__summary">
          {summary}
        </p>
      )}
    </fieldset>
  );
}
