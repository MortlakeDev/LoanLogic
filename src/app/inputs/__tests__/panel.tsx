// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Helpers for the inputs panel's component tests: a fresh panel on the design scenario
 * with a fixed disbursement date, typed element lookups and typing as a user does.
 * Test-only code.
 */

import { act, fireEvent, render } from '@testing-library/preact';
import { setLanguage } from '../../state/i18n';
import { resetForm, updateForm } from '../../state/loan';
import { advancedOpen, moreOpen } from '../../state/ui';
import { InputsPanel } from '../InputsPanel';

/** Restores the opening scenario, disbursed 2026-11-01 (stable hints), in English. */
export function resetState(): void {
  localStorage.clear();
  resetForm();
  updateForm({ disbursementDate: '2026-11-01' });
  setLanguage('en');
  advancedOpen.value = false;
  moreOpen.value = false;
}

/** Renders the whole panel. */
export function renderPanel(): void {
  render(<InputsPanel />);
}

/**
 * Runs a state change and lets the components re-render. With a synchronous callback,
 * `act` flushes the renders before it returns; its thenable has nothing left to wait for.
 */
export function change(update: () => void): void {
  void act(update);
}

/** The element with an id, checked to be of a type. */
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`#${id} is not a ${type.name}`);
  }
  return element;
}

/** An input by id. */
export function input(id: string): HTMLInputElement {
  return byId(id, HTMLInputElement);
}

/** A select by id. */
export function select(id: string): HTMLSelectElement {
  return byId(id, HTMLSelectElement);
}

/** Types a text into an input (one `input` event), then leaves the field. */
export function typeInto(element: HTMLInputElement, text: string, blur = true): void {
  fireEvent.input(element, { target: { value: text } });
  if (blur) {
    fireEvent.blur(element);
  }
}

/** Picks a value in a select. */
export function choose(element: HTMLSelectElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

/** The text of the element an input's `aria-describedby` names, by id order. */
export function descriptionOf(element: HTMLElement): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`)
    .join(' | ');
}
