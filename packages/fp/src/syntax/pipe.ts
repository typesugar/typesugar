/**
 * Pipe and Flow Utilities
 *
 * Provides functional composition utilities similar to fp-ts pipe/flow.
 * These enable point-free style programming and readable left-to-right composition.
 */

// ============================================================================
// Pipe - Value-first composition
// ============================================================================

/**
 * Pipe a value through a series of functions
 *
 * @example
 * ```typescript
 * const result = pipe(
 *   5,
 *   x => x * 2,
 *   x => x + 1,
 *   x => x.toString()
 * );
 * // result: "11"
 * ```
 */
export function pipe<A>(a: A): A;
export function pipe<A, B>(a: A, ab: (a: A) => B): B;
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
export function pipe<A, B, C, D>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): D;
export function pipe<A, B, C, D, E>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
  ij: (i: I) => J,
): J;
export function pipe(
  a: unknown,
  ...fns: Array<(a: unknown) => unknown>
): unknown {
  return fns.reduce((acc, fn) => fn(acc), a);
}

// ============================================================================
// Flow - Function composition
// ============================================================================

/**
 * Compose functions left-to-right
 *
 * @example
 * ```typescript
 * const transform = flow(
 *   (x: number) => x * 2,
 *   x => x + 1,
 *   x => x.toString()
 * );
 * transform(5); // "11"
 * ```
 */
export function flow<A extends readonly unknown[], B>(
  ab: (...a: A) => B,
): (...a: A) => B;
export function flow<A extends readonly unknown[], B, C>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
): (...a: A) => C;
export function flow<A extends readonly unknown[], B, C, D>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): (...a: A) => D;
export function flow<A extends readonly unknown[], B, C, D, E>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): (...a: A) => E;
export function flow<A extends readonly unknown[], B, C, D, E, F>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): (...a: A) => F;
export function flow<A extends readonly unknown[], B, C, D, E, F, G>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): (...a: A) => G;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
): (...a: A) => H;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H, I>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
): (...a: A) => I;
export function flow<A extends readonly unknown[], B, C, D, E, F, G, H, I, J>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
  hi: (h: H) => I,
  ij: (i: I) => J,
): (...a: A) => J;
export function flow(
  ...fns: Array<(...args: unknown[]) => unknown>
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    let result: unknown = fns[0](...args);
    for (let i = 1; i < fns.length; i++) {
      result = fns[i](result);
    }
    return result;
  };
}

// ============================================================================
// Compose - Right-to-left function composition
// ============================================================================

/**
 * Compose functions right-to-left (traditional mathematical composition)
 *
 * @example
 * ```typescript
 * const transform = compose(
 *   (x: number) => x.toString(),
 *   (x: number) => x + 1,
 *   (x: number) => x * 2
 * );
 * transform(5); // "11"
 * ```
 */
export function compose<A, B>(ab: (a: A) => B): (a: A) => B;
export function compose<A, B, C>(bc: (b: B) => C, ab: (a: A) => B): (a: A) => C;
export function compose<A, B, C, D>(
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B,
): (a: A) => D;
export function compose<A, B, C, D, E>(
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B,
): (a: A) => E;
export function compose<A, B, C, D, E, F>(
  ef: (e: E) => F,
  de: (d: D) => E,
  cd: (c: C) => D,
  bc: (b: B) => C,
  ab: (a: A) => B,
): (a: A) => F;
export function compose(
  ...fns: Array<(a: unknown) => unknown>
): (a: unknown) => unknown {
  return (a: unknown) => fns.reduceRight((acc, fn) => fn(acc), a);
}

// ============================================================================
// Identity and Constant
// ============================================================================

/**
 * Identity function - returns its argument unchanged
 */
export const identity = <A>(a: A): A => a;

/**
 * Constant function - always returns the same value
 */
export const constant =
  <A>(a: A) =>
  <B>(_: B): A =>
    a;

/**
 * Alias for constant
 */
export const always = constant;

/**
 * Thunk - a function that takes no arguments
 */
export type Thunk<A> = () => A;

/**
 * Create a thunk from a value
 */
export const thunk =
  <A>(a: A): Thunk<A> =>
  () =>
    a;

// ============================================================================
// Function Utilities
// ============================================================================

/**
 * Flip the arguments of a binary function
 */
export const flip =
  <A, B, C>(f: (a: A, b: B) => C) =>
  (b: B, a: A): C =>
    f(a, b);

/**
 * Curry a binary function
 */
export const curry =
  <A, B, C>(f: (a: A, b: B) => C) =>
  (a: A) =>
  (b: B): C =>
    f(a, b);

/**
 * Uncurry a curried binary function
 */
export const uncurry =
  <A, B, C>(f: (a: A) => (b: B) => C) =>
  (a: A, b: B): C =>
    f(a)(b);

/**
 * Curry a ternary function
 */
export const curry3 =
  <A, B, C, D>(f: (a: A, b: B, c: C) => D) =>
  (a: A) =>
  (b: B) =>
  (c: C): D =>
    f(a, b, c);

/**
 * Uncurry a curried ternary function
 */
export const uncurry3 =
  <A, B, C, D>(f: (a: A) => (b: B) => (c: C) => D) =>
  (a: A, b: B, c: C): D =>
    f(a)(b)(c);

/**
 * Apply a function to a value (reverse of function application)
 */
export const apply =
  <A>(a: A) =>
  <B>(f: (a: A) => B): B =>
    f(a);

/**
 * Alias for apply
 */
export const applyTo = apply;

/**
 * Tap - apply a function for its side effect, return the original value
 */
export const tap =
  <A>(f: (a: A) => void) =>
  (a: A): A => {
    f(a);
    return a;
  };

/**
 * TapIf - conditionally apply a function for its side effect
 */
export const tapIf =
  <A>(predicate: (a: A) => boolean, f: (a: A) => void) =>
  (a: A): A => {
    if (predicate(a)) {
      f(a);
    }
    return a;
  };

// ============================================================================
// Boolean Combinators
// ============================================================================

/**
 * Negate a predicate
 */
export const not =
  <A>(predicate: (a: A) => boolean) =>
  (a: A): boolean =>
    !predicate(a);

/**
 * Combine predicates with AND
 */
export const and =
  <A>(...predicates: Array<(a: A) => boolean>) =>
  (a: A): boolean =>
    predicates.every((p) => p(a));

/**
 * Combine predicates with OR
 */
export const or =
  <A>(...predicates: Array<(a: A) => boolean>) =>
  (a: A): boolean =>
    predicates.some((p) => p(a));

// ============================================================================
// Tuple Utilities
// ============================================================================

/**
 * Create a tuple
 */
export const tuple = <T extends unknown[]>(...args: T): T => args;

/**
 * Get the first element of a tuple
 */
export const fst = <A, B>([a, _]: [A, B]): A => a;

/**
 * Get the second element of a tuple
 */
export const snd = <A, B>([_, b]: [A, B]): B => b;

/**
 * Swap tuple elements
 */
export const swap = <A, B>([a, b]: [A, B]): [B, A] => [b, a];

/**
 * Map over the first element
 */
export const mapFst =
  <A, B, C>(f: (a: A) => C) =>
  ([a, b]: [A, B]): [C, B] => [f(a), b];

/**
 * Map over the second element
 */
export const mapSnd =
  <A, B, C>(f: (b: B) => C) =>
  ([a, b]: [A, B]): [A, C] => [a, f(b)];

/**
 * Map over both elements
 */
export const bimap =
  <A, B, C, D>(f: (a: A) => C, g: (b: B) => D) =>
  ([a, b]: [A, B]): [C, D] => [f(a), g(b)];

// ============================================================================
// Lazy Evaluation
// ============================================================================

/**
 * Lazy - a value that is computed only when needed
 */
export class Lazy<A> {
  private _value: A | undefined;
  private _computed = false;

  constructor(private readonly thunk: () => A) {}

  /**
   * Get the value, computing it if necessary
   */
  get value(): A {
    if (!this._computed) {
      this._value = this.thunk();
      this._computed = true;
    }
    return this._value as A;
  }

  /**
   * Force evaluation
   */
  force(): A {
    return this.value;
  }

  /**
   * Map over the lazy value
   */
  map<B>(f: (a: A) => B): Lazy<B> {
    return new Lazy(() => f(this.value));
  }

  /**
   * FlatMap over the lazy value
   */
  flatMap<B>(f: (a: A) => Lazy<B>): Lazy<B> {
    return new Lazy(() => f(this.value).value);
  }

  /**
   * Create a lazy value
   */
  static of<A>(thunk: () => A): Lazy<A> {
    return new Lazy(thunk);
  }

  /**
   * Create a lazy value from an already-computed value
   */
  static pure<A>(a: A): Lazy<A> {
    return new Lazy(() => a);
  }
}

/**
 * Create a lazy value
 */
export const lazy = <A>(thunk: () => A): Lazy<A> => Lazy.of(thunk);

// ============================================================================
// Memoization
// ============================================================================

/**
 * Memoize a function (cache results)
 */
export function memoize<A extends unknown[], B>(
  f: (...args: A) => B,
): (...args: A) => B {
  const cache = new Map<string, B>();
  return (...args: A): B => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = f(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Memoize a function with a custom key function
 */
export function memoizeWith<A extends unknown[], B, K>(
  keyFn: (...args: A) => K,
  f: (...args: A) => B,
): (...args: A) => B {
  const cache = new Map<K, B>();
  return (...args: A): B => {
    const key = keyFn(...args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = f(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Memoize a single-argument function
 */
export function memoize1<A, B>(f: (a: A) => B): (a: A) => B {
  const cache = new Map<A, B>();
  return (a: A): B => {
    if (cache.has(a)) {
      return cache.get(a)!;
    }
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}

// ============================================================================
// Debugging Utilities
// ============================================================================

/**
 * Log and return a value (useful for debugging in pipes)
 */
export const trace =
  (label: string) =>
  <A>(a: A): A => {
    console.log(label, a);
    return a;
  };

/**
 * Time a function execution
 */
export const timed =
  (label: string) =>
  <A extends unknown[], B>(f: (...args: A) => B) =>
  (...args: A): B => {
    console.time(label);
    const result = f(...args);
    console.timeEnd(label);
    return result;
  };

/**
 * Assert a condition, throwing if false
 */
export const assert =
  (message: string) =>
  <A>(predicate: (a: A) => boolean) =>
  (a: A): A => {
    if (!predicate(a)) {
      throw new Error(message);
    }
    return a;
  };
