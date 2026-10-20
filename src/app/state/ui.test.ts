// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { feeValueField, inputIdFor } from './loan';
import { advancedOpen, closeExplain, explainTarget, focusField, moreOpen, openExplain } from './ui';

/** Animation frames queued by the code under test, run by `nextFrame()`. */
let frames: FrameRequestCallback[] = [];

function nextFrame(): void {
  const queued = frames;
  frames = [];
  queued.forEach((callback) => {
    callback(0);
  });
}

/** Adds a focusable element with an id to the page. */
function addInput(id: string): HTMLInputElement {
  const input = document.createElement('input');
  input.id = id;
  document.body.append(input);
  return input;
}

beforeEach(() => {
  advancedOpen.value = false;
  moreOpen.value = false;
  explainTarget.value = null;
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('Explain sheet state', () => {
  it('opens with a target and returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    openExplain({ kind: 'rate', method: 'usRegZApr' }, opener);
    expect(explainTarget.value).toEqual({ kind: 'rate', method: 'usRegZApr' });
    addInput('elsewhere').focus();
    closeExplain();
    expect(explainTarget.value).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not focus an opener that left the page', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const focusSpy = vi.spyOn(opener, 'focus');
    openExplain({ kind: 'instalment' }, opener);
    opener.remove();
    closeExplain();
    expect(explainTarget.value).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('closes without an opener, and forgets the opener after closing', () => {
    openExplain({ kind: 'instalment' }, null);
    expect(() => {
      closeExplain();
    }).not.toThrow();

    const opener = document.createElement('button');
    document.body.append(opener);
    const focusSpy = vi.spyOn(opener, 'focus');
    openExplain({ kind: 'instalment' }, opener);
    closeExplain();
    closeExplain();
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});

describe('focusField', () => {
  it('opens Advanced and the mobile disclosure for an advanced field', () => {
    const input = addInput(inputIdFor('accrual.paymentBasis'));
    focusField('accrual.paymentBasis');
    expect(advancedOpen.value).toBe(true);
    expect(moreOpen.value).toBe(true);
    // The disclosure renders first; focus moves on the next frame.
    expect(document.activeElement).not.toBe(input);
    nextFrame();
    expect(document.activeElement).toBe(input);
  });

  it('opens only the mobile disclosure for the fees section', () => {
    const section = document.createElement('section');
    section.id = inputIdFor('fees');
    section.tabIndex = -1;
    document.body.append(section);
    focusField('fees');
    expect(moreOpen.value).toBe(true);
    expect(advancedOpen.value).toBe(false);
    nextFrame();
    expect(document.activeElement).toBe(section);
  });

  it('opens only the mobile disclosure for a fee value', () => {
    const field = feeValueField('fee-4');
    const input = addInput(inputIdFor(field));
    focusField(field);
    expect(moreOpen.value).toBe(true);
    expect(advancedOpen.value).toBe(false);
    nextFrame();
    expect(document.activeElement).toBe(input);
  });

  it('opens nothing for a main field', () => {
    const input = addInput('field-amount');
    focusField('amount');
    expect(advancedOpen.value).toBe(false);
    expect(moreOpen.value).toBe(false);
    nextFrame();
    expect(document.activeElement).toBe(input);
  });

  it('does nothing when the input is not on the page', () => {
    focusField('term.years');
    expect(() => {
      nextFrame();
    }).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('looks the input up in the given document', () => {
    const other = document.implementation.createHTMLDocument('other');
    const input = other.createElement('input');
    input.id = 'field-amount';
    other.body.append(input);
    const lookup = vi.spyOn(other, 'getElementById');
    focusField('amount', other);
    nextFrame();
    expect(lookup).toHaveBeenCalledWith('field-amount');
  });
});
