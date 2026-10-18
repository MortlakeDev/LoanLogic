// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Safe `localStorage` access. Storage can be missing or throw (private modes, disabled
 * cookies, sandboxed `file://` pages, quota exceeded), so every operation is guarded and
 * reports success instead of throwing.
 */

/** Prefix of every key LoanLogic writes. */
export const STORAGE_NAMESPACE = 'loanlogic:';

/** A typed, versioned value in local storage. */
export interface StorageSlot<T> {
  /** Full storage key, e.g. "loanlogic:theme:v1". */
  readonly key: string;
  /** Returns the stored value, or `undefined` if absent, unreadable or invalid. */
  read(): T | undefined;
  /** Stores the value as JSON; returns `false` if storage is unavailable or full. */
  write(value: T): boolean;
  /** Removes the value; returns `false` if storage is unavailable. */
  remove(): boolean;
}

/** Builds a namespaced, versioned key: `loanlogic:<name>:v<version>`. */
export function storageKey(name: string, version: number): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !Number.isInteger(version) || version < 1) {
    throw new RangeError(`Invalid storage key: ${name} v${String(version)}`);
  }
  return `${STORAGE_NAMESPACE}${name}:v${String(version)}`;
}

/** Returns `localStorage`, or `undefined` where merely touching it throws. */
export function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Creates a storage slot. A new `version` is a new key, so incompatible old data is
 * simply not read (explicit migrations can read the old key when needed).
 *
 * @param name Lower-case slot name, e.g. "theme".
 * @param version Schema version, starting at 1.
 * @param isValid Validates parsed JSON before it is returned.
 * @param storage Storage provider; defaults to `localStorage`.
 */
export function createStorageSlot<T>(
  name: string,
  version: number,
  isValid: (value: unknown) => value is T,
  storage: () => Storage | undefined = defaultStorage,
): StorageSlot<T> {
  const key = storageKey(name, version);
  return {
    key,
    read(): T | undefined {
      try {
        const raw = storage()?.getItem(key);
        if (raw === null || raw === undefined) {
          return undefined;
        }
        const parsed: unknown = JSON.parse(raw);
        return isValid(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    write(value: T): boolean {
      try {
        const target = storage();
        if (target === undefined) {
          return false;
        }
        target.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(): boolean {
      try {
        const target = storage();
        if (target === undefined) {
          return false;
        }
        target.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
