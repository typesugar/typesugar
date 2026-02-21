/**
 * Function Extension Methods
 *
 * The best from:
 * - Haskell (const, flip, on, fix, curry, uncurry)
 * - Scala (andThen, compose, tupled, untupled, curried)
 * - Lodash (debounce, throttle, once, memoize, negate, partial, ary, rearg)
 * - Ramda (curry, partial, flip, complement, converge, juxt, tap, tryCatch)
 * - Rust (identity, compose, pipe)
 * - Most-requested JS/TS: debounce, throttle, memoize, once, retry, partial
 */

// ============================================================================
// Core Combinators (Haskell + Scala)
// ============================================================================

export function identity<A>(a: A): A {
  return a;
}

export function constant<A>(a: A): () => A {
  return () => a;
}

export function flip<A, B, C>(fn: (a: A, b: B) => C): (b: B, a: A) => C {
  return (b, a) => fn(a, b);
}

export function negate<A extends unknown[]>(fn: (...args: A) => boolean): (...args: A) => boolean {
  return (...args) => !fn(...args);
}

export function complement<A extends unknown[]>(
  fn: (...args: A) => boolean
): (...args: A) => boolean {
  return negate(fn);
}

export function noop(): void {}

export function absurd(_: never): never {
  throw new Error("absurd: this should never be called");
}

// ============================================================================
// Currying & Partial Application (Haskell curry, Lodash partial)
// ============================================================================

export function curry2<A, B, C>(fn: (a: A, b: B) => C): (a: A) => (b: B) => C {
  return (a) => (b) => fn(a, b);
}

export function curry3<A, B, C, D>(fn: (a: A, b: B, c: C) => D): (a: A) => (b: B) => (c: C) => D {
  return (a) => (b) => (c) => fn(a, b, c);
}

export function uncurry2<A, B, C>(fn: (a: A) => (b: B) => C): (a: A, b: B) => C {
  return (a, b) => fn(a)(b);
}

export function uncurry3<A, B, C, D>(fn: (a: A) => (b: B) => (c: C) => D): (a: A, b: B, c: C) => D {
  return (a, b, c) => fn(a)(b)(c);
}

export function partial<A, B extends unknown[], C>(
  fn: (a: A, ...rest: B) => C,
  a: A
): (...rest: B) => C {
  return (...rest) => fn(a, ...rest);
}

export function partial2<A, B, C extends unknown[], D>(
  fn: (a: A, b: B, ...rest: C) => D,
  a: A,
  b: B
): (...rest: C) => D {
  return (...rest) => fn(a, b, ...rest);
}

// ============================================================================
// Tuple Adapters (Scala tupled/untupled)
// ============================================================================

export function tupled<A, B, C>(fn: (a: A, b: B) => C): (args: [A, B]) => C {
  return ([a, b]) => fn(a, b);
}

export function tupled3<A, B, C, D>(fn: (a: A, b: B, c: C) => D): (args: [A, B, C]) => D {
  return ([a, b, c]) => fn(a, b, c);
}

export function untupled<A, B, C>(fn: (args: [A, B]) => C): (a: A, b: B) => C {
  return (a, b) => fn([a, b]);
}

// ============================================================================
// Timing (Lodash debounce/throttle)
// ============================================================================

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

// ============================================================================
// Memoization (Lodash memoize)
// ============================================================================

export function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  keyFn?: (...args: A) => string
): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args) => {
    const key = keyFn ? keyFn(...args) : JSON.stringify(args);
    if (cache.has(key)) return cache.get(key)!;
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

export function memoizeWeak<A extends object, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new WeakMap<A, R>();
  return (a) => {
    if (cache.has(a)) return cache.get(a)!;
    const result = fn(a);
    cache.set(a, result);
    return result;
  };
}

// ============================================================================
// Execution Control (Lodash once, Ramda tryCatch)
// ============================================================================

export function once<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let called = false;
  let result: R;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

export function after<A extends unknown[], R>(
  n: number,
  fn: (...args: A) => R
): (...args: A) => R | undefined {
  let count = 0;
  return (...args) => {
    count++;
    if (count >= n) return fn(...args);
    return undefined;
  };
}

export function before<A extends unknown[], R>(
  n: number,
  fn: (...args: A) => R
): (...args: A) => R | undefined {
  let count = 0;
  let lastResult: R | undefined;
  return (...args) => {
    count++;
    if (count < n) {
      lastResult = fn(...args);
      return lastResult;
    }
    return lastResult;
  };
}

export function tryCatch<A extends unknown[], R, E>(
  fn: (...args: A) => R,
  onError: (error: Error, ...args: A) => E
): (...args: A) => R | E {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      return onError(err instanceof Error ? err : new Error(String(err)), ...args);
    }
  };
}

// ============================================================================
// Higher-Order Combinators (Ramda converge/juxt)
// ============================================================================

export function juxt<A extends unknown[], R extends unknown[]>(
  ...fns: { [K in keyof R]: (...args: A) => R[K] }
): (...args: A) => R {
  return (...args) => fns.map((fn) => fn(...args)) as unknown as R;
}

export function converge<A extends unknown[], B extends unknown[], C>(
  after: (...args: B) => C,
  ...branches: { [K in keyof B]: (...args: A) => B[K] }
): (...args: A) => C {
  return (...args) => {
    const results = branches.map((fn) => fn(...args)) as unknown as B;
    return after(...results);
  };
}

export function on<A, B, C>(fn: (b1: B, b2: B) => C, transform: (a: A) => B): (a1: A, a2: A) => C {
  return (a1, a2) => fn(transform(a1), transform(a2));
}

// ============================================================================
// Aggregate
// ============================================================================

export const FunctionExt = {
  identity,
  constant,
  flip,
  negate,
  complement,
  noop,
  absurd,
  curry2,
  curry3,
  uncurry2,
  uncurry3,
  partial,
  partial2,
  tupled,
  tupled3,
  untupled,
  debounce,
  throttle,
  memoize,
  memoizeWeak,
  once,
  after,
  before,
  tryCatch,
  juxt,
  converge,
  on,
} as const;
