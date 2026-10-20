// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import './explain.css';
import type { ComponentChildren, JSX } from 'preact';
import type { LoanResult, RateMethodId } from '../../engine';
import { Sheet } from '../components/Sheet';
import { includedFees, paymentsInRates } from '../state/derived';
import { currencyDigits, money, ratePercent } from '../state/display';
import { type FormulaModel, instalmentFormula, rateFormula, rateNote } from '../state/formula';
import { formatLocale, t } from '../state/i18n';
import { form, okResult } from '../state/loan';
import { methodName, rateFailureReason } from '../state/messages';
import { type ExplainTarget, closeExplain, explainTarget } from '../state/ui';
import { Formula } from './Formula';

const TITLE_ID = 'explain-title';

type OkResult = Extract<LoanResult, { readonly ok: true }>;

/**
 * The Explain sheet (DESIGN §8.12) for the instalment or a rate: the formula id, the
 * formula, every value of the engine's payload and the result; for rates also the cash
 * flows and the method's regulatory note. Opened with `openExplain`; closing returns focus
 * to the trigger.
 */
export function ExplainSheet(): JSX.Element {
  const target = explainTarget.value;
  return (
    <Sheet
      open={target !== null}
      onClose={closeExplain}
      labelledBy={TITLE_ID}
      closeLabel={t('explain.close')}
      class="explain"
    >
      {target === null ? null : <ExplainContent target={target} />}
    </Sheet>
  );
}

function ExplainContent(props: { readonly target: ExplainTarget }): JSX.Element {
  const { target } = props;
  const result = okResult.value;
  return (
    <>
      <h2 id={TITLE_ID} class="explain__title">
        {target.kind === 'instalment'
          ? t('explain.instalmentTitle')
          : t('explain.rateTitle', { method: methodName(target.method) })}
      </h2>
      {result === null ? (
        // No stale figures while the input is invalid (DESIGN §8.13).
        <p class="explain__text">{t('results.fixFields')}</p>
      ) : target.kind === 'instalment' ? (
        <InstalmentContent result={result} />
      ) : (
        <RateContent method={target.method} result={result} />
      )}
    </>
  );
}

function Section(props: {
  readonly title: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="explain__section">
      <h3 class="section-label explain__heading">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** The formula id, the formula and every payload value. */
function FormulaSections(props: { readonly model: FormulaModel }): JSX.Element {
  const { model } = props;
  return (
    <>
      <p class="explain__id">
        {t('explain.formulaId')} <code class="num">{model.id}</code>
      </p>
      {model.lines.length > 0 && (
        <Section title={t('explain.formula')}>
          <div class="explain__formula num">
            {model.lines.map((line, index) => (
              <p key={index}>
                <Formula parts={line} />
              </p>
            ))}
          </div>
        </Section>
      )}
      <Section title={t('explain.values')}>
        <dl class="explain__values">
          {model.values.map((entry) => (
            <div key={entry.name} class="explain__value">
              <dt>
                {entry.label === null ? null : `${t(entry.label)} `}
                <span class="explain__symbol num">
                  <Formula parts={entry.symbol} />
                </span>
              </dt>
              <dd class="num">
                <Formula parts={entry.value} />
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}

function InstalmentContent(props: { readonly result: OkResult }): JSX.Element {
  const model = instalmentFormula(props.result.explain, formatLocale.value, currencyDigits.value);
  return (
    <>
      <FormulaSections model={model} />
      {model.result === null ? null : (
        <Section title={t('explain.result')}>
          <p class="explain__result num">{money(model.result.raw)}</p>
        </Section>
      )}
      {model.note === null ? null : (
        <Section title={t('explain.note')}>
          <p class="explain__text">{t(model.note)}</p>
        </Section>
      )}
    </>
  );
}

/**
 * Whether a method is computed from the loan's cash flows (SPEC §9.1). The nominal and
 * effective rates are the contract rate without fees, so a cash-flow summary would not
 * describe them.
 */
function usesCashFlows(method: RateMethodId): boolean {
  return method !== 'nominal' && method !== 'effective';
}

function RateContent(props: {
  readonly method: RateMethodId;
  readonly result: OkResult;
}): JSX.Element {
  const { method, result } = props;
  const metric = result.rates[method];
  return (
    <>
      {metric !== undefined && 'explain' in metric ? (
        <>
          <FormulaSections
            model={rateFormula(method, metric, formatLocale.value, currencyDigits.value)}
          />
          <Section title={t('explain.result')}>
            <p class="explain__result num">{ratePercent(metric.display, metric.precision)}</p>
          </Section>
        </>
      ) : (
        <Section title={t('explain.result')}>
          <p class="explain__result num">{t('rates.na')}</p>
          {/* A failed metric has its reason (SPEC §10); one that was not computed has none. */}
          {metric === undefined ? null : <p class="explain__text">{rateFailureReason()}</p>}
        </Section>
      )}
      {usesCashFlows(method) ? <CashFlows result={result} /> : null}
      <Section title={t('explain.note')}>
        <p class="explain__text">{t(rateNote(method))}</p>
      </Section>
    </>
  );
}

/**
 * The cash flows behind a rate (SPEC §9.1): amount financed, payments and included fees.
 * The payments are counted as the rate counts them, without the periodic fees and
 * insurance left out of it.
 */
function CashFlows(props: { readonly result: OkResult }): JSX.Element {
  const { summary } = props.result;
  const inApr = (id: string): boolean => form.value.fees.some((fee) => fee.uid === id && fee.inApr);
  const inRate = includedFees(props.result.fees, inApr, currencyDigits.value);
  const payments = paymentsInRates(
    summary.totalPayments,
    props.result.fees,
    inApr,
    currencyDigits.value,
  );
  return (
    <Section title={t('explain.cashFlows')}>
      <dl class="explain__values">
        <div class="explain__value">
          <dt>{t('explain.amountFinanced')}</dt>
          <dd class="num">{money(summary.amountFinancedForRates)}</dd>
        </div>
      </dl>
      <p class="explain__text">
        {t('explain.paymentsTotal', {
          count: summary.paymentsCount,
          amount: money(payments),
        })}
      </p>
      {inRate.items.length > 0 ? (
        <p class="explain__text">{t('explain.feesInRate', { amount: money(inRate.total) })}</p>
      ) : null}
    </Section>
  );
}
