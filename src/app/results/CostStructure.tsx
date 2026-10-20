// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import type { LoanSummary } from '../../engine';
import { Rich } from '../components/Rich';
import { type CostPart, costStructure, toMinor } from '../state/derived';
import { currencyDigits, money, share } from '../state/display';
import { formatLocale, t } from '../state/i18n';

const PART_LABELS = {
  principal: 'cost.principal',
  interest: 'cost.interest',
  fees: 'cost.fees',
} as const satisfies Record<CostPart['key'], string>;

/**
 * The narrowest a part with a positive amount is drawn, as a share of the bar: a 0.4 %
 * fee would otherwise vanish inside the 2 px gap and the rounded end.
 */
const MIN_SEGMENT = 0.01;

interface Segment {
  readonly key: CostPart['key'];
  /** Start and width as fractions of the bar (layout only, not figures). */
  readonly x: number;
  readonly width: number;
}

/** The drawn segments: positive parts side by side, each at least `MIN_SEGMENT` wide. */
function segmentsOf(parts: readonly CostPart[]): Segment[] {
  const drawn = parts
    .filter((part) => part.width > 0)
    .map((part) => ({ key: part.key, width: Math.max(part.width, MIN_SEGMENT) }));
  const scale = drawn.reduce((sum, part) => sum + part.width, 0);
  let x = 0;
  return drawn.map((part) => {
    const segment = { key: part.key, x, width: part.width / scale };
    x += segment.width;
    return segment;
  });
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)}%`;
}

/** A legend swatch; interest carries the bar's hatch, so it differs by more than color. */
function Swatch(props: { readonly part: CostPart['key']; readonly hatchId: string }): JSX.Element {
  return (
    <svg class="cost__swatch" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      {props.part === 'interest' ? (
        <rect width="10" height="10" rx="3" fill={`url(#${props.hatchId})`} />
      ) : (
        <rect width="10" height="10" rx="3" class={`cost-bar__${props.part}`} />
      )}
    </svg>
  );
}

/**
 * The cost structure (DESIGN §8.9): "You repay $2.37 for every $1 borrowed" with the total,
 * a 14 px pill bar split into principal, interest and fees, and a legend with amounts and
 * shares. Fees appear only when there are any; negative interest (a negative rate) gets
 * no width in the bar but keeps its minus sign in the legend.
 */
export function CostStructure(props: { readonly summary: LoanSummary }): JSX.Element {
  const id = useId();
  const hatchId = `${id}-hatch`;
  const maskId = `${id}-mask`;
  const digits = currencyDigits.value;
  const structure = costStructure(props.summary, digits);
  const parts = structure.parts.filter(
    (part) => part.key !== 'fees' || toMinor(part.amount, digits) !== 0n,
  );
  const hasFees = parts.some((part) => part.key === 'fees');
  const segments = segmentsOf(parts);
  const label = t('cost.barLabel', {
    parts: new Intl.ListFormat(formatLocale.value, { type: 'conjunction' }).format(
      parts.map((part) =>
        t('cost.barPart', {
          name: t(PART_LABELS[part.key]),
          amount: money(part.amount),
          share: share(part.share),
        }),
      ),
    ),
  });
  return (
    <div class="card cost">
      <div class="cost__head">
        <h3 class="cost__heading">
          <Rich
            message="cost.heading"
            nodes={{
              // The ratio always has 2 decimals, whatever the currency's minor units.
              ratio: <span class="num accent">{money(structure.ratio, 2)}</span>,
              one: money('1', 0),
            }}
          />
        </h3>
        <p class="cost__total">
          {t(hasFees ? 'cost.total' : 'cost.totalNoFees', { amount: money(structure.total) })}
        </p>
      </div>
      <svg class="cost-bar" role="img" aria-label={label} width="100%" height="14">
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect class="cost-bar__interest" width="6" height="6" />
            <line class="cost-bar__hatch" x1="1" y1="0" x2="1" y2="6" />
          </pattern>
          {/* The pill shape, with 2 px cut between neighbouring parts. */}
          <mask id={maskId}>
            <rect width="100%" height="14" rx="7" fill="#fff" />
            {segments.slice(1).map((segment) => (
              <rect
                key={segment.key}
                x={percent(segment.x)}
                width="2"
                height="14"
                transform="translate(-1 0)"
                fill="#000"
              />
            ))}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          {segments.map((segment) => (
            <rect
              key={segment.key}
              class={segment.key === 'interest' ? undefined : `cost-bar__${segment.key}`}
              fill={segment.key === 'interest' ? `url(#${hatchId})` : undefined}
              x={percent(segment.x)}
              width={percent(segment.width)}
              height="14"
            />
          ))}
        </g>
      </svg>
      <ul class="cost__legend">
        {parts.map((part) => (
          <li key={part.key} class="cost__item">
            <Swatch part={part.key} hatchId={hatchId} />
            <span class="cost__label">{t(PART_LABELS[part.key])}</span>
            <span class="cost__amount num">{money(part.amount)}</span>
            <span class="cost__share num">{share(part.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
