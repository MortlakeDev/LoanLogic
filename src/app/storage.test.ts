// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockLocalStorage, createMemoryStorage } from './__tests__/fakes';
import { createStorageSlot, defaultStorage, STORAGE_NAMESPACE, storageKey } from './storage';

const isString = (value: unknown): value is string => typeof value === 'string';
const isDefined = (value: unknown): value is unknown => value !== undefined;

const VALID_NAME = /^[a-z][a-z0-9-]*$/;

describe('storageKey', () => {
  it('builds a namespaced, versioned key', () => {
    expect(storageKey('theme', 1)).toBe('loanlogic:theme:v1');
    expect(storageKey('loan-plan2', 12)).toBe('loanlogic:loan-plan2:v12');
    expect(storageKey('x', 1).startsWith(STORAGE_NAMESPACE)).toBe(true);
  });

  it.each(['', 'Theme', '1theme', '-theme', 'theme:v1', 'the me', 'theme_x', 'théme', 'a.b'])(
    'rejects the invalid name %j',
    (name) => {
      expect(() => storageKey(name, 1)).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid version %d',
    (version) => {
      expect(() => storageKey('theme', version)).toThrow(RangeError);
    },
  );

  it('is injective: the name and version can be read back from every key', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(VALID_NAME),
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        (name, version) => {
          const match = /^loanlogic:([a-z][a-z0-9-]*):v(\d+)$/.exec(storageKey(name, version));
          expect(match?.[1]).toBe(name);
          expect(Number(match?.[2])).toBe(version);
        },
      ),
    );
  });

  it('makes createStorageSlot fail fast on an invalid key', () => {
    expect(() => createStorageSlot('Bad Name', 1, isString, () => undefined)).toThrow(RangeError);
    expect(() => createStorageSlot('theme', 0, isString, () => undefined)).toThrow(RangeError);
  });
});

describe('createStorageSlot with a working storage', () => {
  it('exposes its key and round-trips a value as JSON', () => {
    const storage = createMemoryStorage();
    const slot = createStorageSlot('theme', 1, isString, () => storage);

    expect(slot.key).toBe('loanlogic:theme:v1');
    expect(slot.read()).toBeUndefined();

    expect(slot.write('light')).toBe(true);
    expect(storage.getItem('loanlogic:theme:v1')).toBe('"light"');
    expect(slot.read()).toBe('light');

    expect(slot.write('dark')).toBe(true);
    expect(slot.read()).toBe('dark');

    expect(slot.remove()).toBe(true);
    expect(storage.getItem('loanlogic:theme:v1')).toBeNull();
    expect(slot.read()).toBeUndefined();
  });

  it('round-trips any JSON value the validator accepts', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const storage = createMemoryStorage();
        const slot = createStorageSlot('data', 1, isDefined, () => storage);
        expect(slot.write(value)).toBe(true);
        expect(slot.read()).toStrictEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it('keeps versions apart: a new version does not read data of the old one', () => {
    const storage = createMemoryStorage();
    const v1 = createStorageSlot('plan', 1, isString, () => storage);
    const v2 = createStorageSlot('plan', 2, isString, () => storage);

    v1.write('old');
    expect(v2.read()).toBeUndefined();
    v2.write('new');
    expect(v1.read()).toBe('old');
    expect(v2.read()).toBe('new');
  });

  it('returns undefined for invalid JSON', () => {
    const storage = createMemoryStorage({ 'loanlogic:theme:v1': '{not json' });
    const slot = createStorageSlot('theme', 1, isString, () => storage);
    expect(slot.read()).toBeUndefined();
  });

  it('returns undefined when the validator rejects the stored value', () => {
    const storage = createMemoryStorage({ 'loanlogic:theme:v1': '42' });
    const validated: unknown[] = [];
    const isValid = (value: unknown): value is string => {
      validated.push(value);
      return isString(value);
    };
    const slot = createStorageSlot('theme', 1, isValid, () => storage);

    expect(slot.read()).toBeUndefined();
    expect(validated).toEqual([42]);
    // Reading never rewrites or deletes what is stored.
    expect(storage.getItem('loanlogic:theme:v1')).toBe('42');
  });

  it('returns undefined when the validator itself throws', () => {
    const storage = createMemoryStorage({ 'loanlogic:theme:v1': '"x"' });
    const slot = createStorageSlot(
      'theme',
      1,
      (value: unknown): value is string => {
        throw new TypeError(`cannot validate ${String(value)}`);
      },
      () => storage,
    );
    expect(slot.read()).toBeUndefined();
  });

  it('returns false instead of throwing for values JSON cannot represent', () => {
    const storage = createMemoryStorage();
    const slot = createStorageSlot('data', 1, isDefined, () => storage);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(slot.write(10n)).toBe(false);
    expect(slot.write(circular)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it('asks the provider on every call, so storage that appears later is used', () => {
    const available: { storage: Storage | undefined } = { storage: undefined };
    const provider = vi.fn(() => available.storage);
    const slot = createStorageSlot('theme', 1, isString, provider);

    expect(slot.write('dark')).toBe(false);
    available.storage = createMemoryStorage();
    expect(slot.write('dark')).toBe(true);
    expect(slot.read()).toBe('dark');
    expect(provider).toHaveBeenCalledTimes(3);
  });
});

describe('createStorageSlot without usable storage', () => {
  it('reports failure when the provider returns undefined', () => {
    const slot = createStorageSlot('theme', 1, isString, () => undefined);
    expect(slot.read()).toBeUndefined();
    expect(slot.write('dark')).toBe(false);
    expect(slot.remove()).toBe(false);
  });

  it('never throws when the provider itself throws', () => {
    const slot = createStorageSlot('theme', 1, isString, () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(slot.read()).toBeUndefined();
    expect(slot.write('dark')).toBe(false);
    expect(slot.remove()).toBe(false);
  });

  it('never throws when every storage method throws SecurityError', () => {
    const storage = createMemoryStorage();
    const denied = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(storage, 'getItem').mockImplementation(denied);
    vi.spyOn(storage, 'setItem').mockImplementation(denied);
    vi.spyOn(storage, 'removeItem').mockImplementation(denied);
    const slot = createStorageSlot('theme', 1, isString, () => storage);

    expect(slot.read()).toBeUndefined();
    expect(slot.write('dark')).toBe(false);
    expect(slot.remove()).toBe(false);
  });

  it('reports false when the quota is exceeded and keeps the previous value', () => {
    const storage = createMemoryStorage({ 'loanlogic:theme:v1': '"light"' });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const slot = createStorageSlot('theme', 1, isString, () => storage);

    expect(slot.write('dark')).toBe(false);
    expect(slot.read()).toBe('light');
  });
});

describe('defaultStorage', () => {
  let restore: (() => void) | undefined;
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  });

  afterEach(() => {
    restore?.();
    restore = undefined;
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  });

  it('returns globalThis.localStorage when it is available', () => {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    expect(defaultStorage()).toBe(storage);
  });

  it('returns undefined when reading globalThis.localStorage throws', () => {
    restore = blockLocalStorage();
    expect(() => globalThis.localStorage).toThrow(DOMException);
    expect(defaultStorage()).toBeUndefined();
  });

  it('is the provider of slots created without one', () => {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    const slot = createStorageSlot('theme', 1, isString);

    expect(slot.write('light')).toBe(true);
    expect(storage.getItem('loanlogic:theme:v1')).toBe('"light"');
  });

  it('makes default slots fail safely while storage is blocked', () => {
    restore = blockLocalStorage();
    const slot = createStorageSlot('theme', 1, isString);

    expect(slot.read()).toBeUndefined();
    expect(slot.write('light')).toBe(false);
    expect(slot.remove()).toBe(false);
  });
});
