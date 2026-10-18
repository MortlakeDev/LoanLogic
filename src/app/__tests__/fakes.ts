// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mortlake

/**
 * Test doubles for browser APIs the app shell reads: Web Storage, `matchMedia` with a
 * controllable color scheme, and `navigator` language preferences. Test-only code.
 */

/** An in-memory `Storage` with the same string semantics as `localStorage`. */
export function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): Storage {
  const items = new Map<string, string>(Object.entries(initial));
  const storage = {
    get length(): number {
      return items.size;
    },
    clear(): void {
      items.clear();
    },
    getItem(key: string): string | null {
      return items.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...items.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      items.delete(key);
    },
    setItem(key: string, value: string): void {
      items.set(key, value);
    },
  };
  return storage;
}

type ChangeHandler = ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null;

/**
 * A minimal `MediaQueryList` for `prefers-color-scheme` queries. It evaluates the query
 * against the fake system scheme, so the test does not depend on which of the two
 * equivalent queries (light or dark) the code under test uses.
 */
class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  onchange: ChangeHandler = null;
  readonly #listeners = new Set<EventListenerOrEventListenerObject>();
  readonly #legacy = new Map<NonNullable<ChangeHandler>, EventListener>();

  constructor(
    readonly media: string,
    private readonly evaluate: (query: string) => boolean,
  ) {
    super();
  }

  get matches(): boolean {
    return this.evaluate(this.media);
  }

  /** Number of `change` listeners currently registered on this list. */
  get listenerCount(): number {
    return this.#listeners.size;
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === 'change' && listener !== null) {
      this.#listeners.add(listener);
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === 'change' && listener !== null) {
      this.#listeners.delete(listener);
    }
    super.removeEventListener(type, listener, options);
  }

  addListener(callback: ChangeHandler): void {
    if (callback === null) {
      return;
    }
    const listener: EventListener = (event) => {
      callback.call(this, event as MediaQueryListEvent);
    };
    this.#legacy.set(callback, listener);
    this.addEventListener('change', listener);
  }

  removeListener(callback: ChangeHandler): void {
    if (callback === null) {
      return;
    }
    const listener = this.#legacy.get(callback);
    if (listener !== undefined) {
      this.#legacy.delete(callback);
      this.removeEventListener('change', listener);
    }
  }

  /** Dispatches a `change` event carrying the current `matches` value. */
  notify(): void {
    const event = new Event('change');
    Object.defineProperties(event, {
      matches: { value: this.matches, enumerable: true },
      media: { value: this.media, enumerable: true },
    });
    this.onchange?.call(this, event as MediaQueryListEvent);
    this.dispatchEvent(event);
  }
}

/** A controllable operating-system color scheme exposed through `matchMedia`. */
export interface FakeColorScheme {
  /** Drop-in replacement for `window.matchMedia`. */
  readonly matchMedia: (query: string) => MediaQueryList;
  /** Queries passed to `matchMedia`, in call order. */
  readonly queries: readonly string[];
  /** Whether the system currently prefers the light scheme. */
  readonly prefersLight: boolean;
  /** Switches the system scheme and fires `change` on every list whose result changed. */
  setPrefersLight(light: boolean): void;
  /** Total number of `change` listeners registered across all lists handed out. */
  listenerCount(): number;
}

/** Creates a fake system color scheme; `prefersLight` is its initial state. */
export function createColorScheme(prefersLight: boolean): FakeColorScheme {
  let light = prefersLight;
  const queries: string[] = [];
  const lists: FakeMediaQueryList[] = [];
  const evaluate = (query: string): boolean => {
    const normalized = query.replace(/\s+/g, '').toLowerCase();
    if (normalized === '(prefers-color-scheme:light)') {
      return light;
    }
    if (normalized === '(prefers-color-scheme:dark)') {
      return !light;
    }
    return false;
  };
  return {
    matchMedia(query: string): MediaQueryList {
      queries.push(query);
      const list = new FakeMediaQueryList(query, evaluate);
      lists.push(list);
      return list;
    },
    queries,
    get prefersLight(): boolean {
      return light;
    },
    setPrefersLight(next: boolean): void {
      const before = lists.map((list) => list.matches);
      light = next;
      lists.forEach((list, index) => {
        if (list.matches !== before[index]) {
          list.notify();
        }
      });
    },
    listenerCount(): number {
      return lists.reduce((total, list) => total + list.listenerCount, 0);
    },
  };
}

/**
 * Overrides `navigator.languages` and `navigator.language` on the given navigator.
 * Returns a function that restores the original (prototype) values.
 */
export function setNavigatorLanguages(
  languages: readonly string[],
  language: string = languages[0] ?? '',
  target: Navigator = navigator,
): () => void {
  Object.defineProperty(target, 'languages', {
    configurable: true,
    get: (): readonly string[] => Object.freeze([...languages]),
  });
  Object.defineProperty(target, 'language', {
    configurable: true,
    get: (): string => language,
  });
  return () => {
    Reflect.deleteProperty(target, 'languages');
    Reflect.deleteProperty(target, 'language');
  };
}

/**
 * Makes reading `globalThis.localStorage` throw, as browsers do when storage is blocked.
 * Returns a function that restores the original property.
 */
export function blockLocalStorage(
  error: unknown = new DOMException('The operation is insecure.', 'SecurityError'),
): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): never {
      throw error;
    },
  });
  return () => {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', original);
    }
  };
}
