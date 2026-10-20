// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Building blocks every results view shares: the hero amount split into styled parts
 * (DESIGN §4.2), the changed-figure animation (§6), a rate with its precision or "n/a" and
 * its reason (§8.7, §8.13), and the trigger that opens a rate's explanation (§8.12).
 */

import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { LoanResult, RateFailure, RateMethodId, RateMetric } from '../../engine';
import { Icon } from '../components/Icon';
import { money, moneyParts, ratePercent } from '../state/display';
import { t } from '../state/i18n';
import { methodName, rateFailureReason } from '../state/messages';
import { openExplain } from '../state/ui';

/** A successful engine result. */
export type OkLoanResult = Extract<LoanResult, { readonly ok: true }>;

/** A rate the engine was asked for: a metric, a failure, or absent. */
export type RateOutcome = RateMetric | RateFailure | undefined;

/** Whether a rate was computed (a `RateFailure` carries `ok: false`). */
export function isRateMetric(rate: RateMetric | RateFailure): rate is RateMetric {
  return !('ok' in rate);
}

/** A computed rate with its method's precision ("6.974%"), or `null` when it failed. */
export function rateText(rate: RateOutcome): string | null {
  return rate !== undefined && isRateMetric(rate)
    ? ratePercent(rate.display, rate.precision)
    : null;
}

/** How many times `value` has changed since the component mounted. */
function useChangeCount(value: string): number {
  const seen = useRef({ value, count: 0 });
  if (seen.current.value !== value) {
    seen.current = { value, count: seen.current.count + 1 };
  }
  return seen.current.count;
}

/**
 * A figure that fades in and rises 4 px when its value changes (DESIGN §6). Never a
 * counting animation: a counter would show amounts that are not the result. The first
 * render does not animate, and reduced motion turns it off (results.css).
 */
export function Changing(props: {
  /** The displayed text; a different value replays the animation. */
  readonly value: string;
  readonly class?: string;
  readonly children: ComponentChildren;
}): JSX.Element {
  const changes = useChangeCount(props.value);
  const classes = [props.class, changes > 0 ? 'figure-changed' : undefined]
    .filter((name) => name !== undefined)
    .join(' ');
  // A new key re-creates the element, which restarts its CSS animation.
  return (
    <span key={changes} class={classes === '' ? undefined : classes}>
      {props.children}
    </span>
  );
}

const PART_CLASSES: Partial<Record<Intl.NumberFormatPartTypes, string>> = {
  currency: 'hero-amount__currency',
  decimal: 'hero-amount__minor',
  fraction: 'hero-amount__minor',
};

/**
 * The payment as a hero number (DESIGN §4.2): the currency symbol at half size, raised
 * and muted, the minor units muted. The split follows Intl's parts, so the symbol lands
 * where the locale puts it ("$2,299.25", "2 299,25 $", "12 345,67 ₴") and a negative
 * payment keeps its minus sign. Assistive technology reads the whole amount once.
 */
export function HeroAmount(props: { readonly value: string }): JSX.Element {
  const text = money(props.value);
  const parts = moneyParts(props.value);
  // The figure's width in characters (the symbol at half size): the hero size shrinks to
  // fit a narrow card instead of scrolling the page sideways (results.css).
  const chars = parts.reduce(
    (sum, part) => sum + part.value.length * (part.type === 'currency' ? 0.5 : 1),
    0,
  );
  return (
    <p class="hero-amount" style={{ '--hero-chars': String(chars) }}>
      <span class="visually-hidden">{text}</span>
      <Changing value={text} class="hero-amount__figure">
        <span aria-hidden="true">
          {parts.map((part, index) => {
            const name = PART_CLASSES[part.type];
            return name === undefined ? (
              part.value
            ) : (
              <span key={index} class={name}>
                {part.value}
              </span>
            );
          })}
        </span>
      </Changing>
    </p>
  );
}

/** The 44 px button that opens the explanation of a rate (DESIGN §8.1 accent, §8.12). */
export function ExplainRateButton(props: { readonly method: RateMethodId }): JSX.Element {
  return (
    <button
      type="button"
      class="btn btn--accent explain-trigger"
      aria-label={t('rates.explain', { method: methodName(props.method) })}
      onClick={(event) => {
        openExplain({ kind: 'rate', method: props.method }, event.currentTarget);
      }}
    >
      <Icon name="info" />
    </button>
  );
}

/**
 * A rate with its explain trigger, or "n/a" with the reason it could not be computed
 * (SPEC §10). The reason stays visible text rather than a hover tooltip, so keyboard and
 * touch users can read it too.
 */
export function RateLine(props: {
  readonly method: RateMethodId;
  readonly rate: RateOutcome;
  /** Class of the value (its size and color). */
  readonly class: string;
}): JSX.Element {
  const text = rateText(props.rate);
  if (text !== null) {
    return (
      <span class="rate-line">
        <Changing value={text} class={`num ${props.class}`}>
          {text}
        </Changing>
        <ExplainRateButton method={props.method} />
      </span>
    );
  }
  return (
    <span class="rate-line rate-line--na">
      <span class={`num ${props.class} rate-na`}>{t('rates.na')}</span>
      {props.rate !== undefined && <span class="rate-line__reason">{rateFailureReason()}</span>}
    </span>
  );
}
