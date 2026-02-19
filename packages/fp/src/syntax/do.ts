/**
 * Do-Comprehension Syntax
 *
 * Provides a way to chain monadic operations in a more readable way,
 * similar to Scala's for-comprehensions or Haskell's do-notation.
 *
 * TypeScript doesn't have native do-notation, but we can simulate it
 * using a builder pattern with bind/let operations.
 *
 * Several approaches are provided:
 * 1. Builder pattern (Do().bind(...).bind(...))
 * 2. Generator-based (experimental)
 * 3. Fluent API with type inference
 */

import { Option, Some, None } from "../data/option";
import { Either, Left, Right } from "../data/either";
import { IO } from "../io/io";

// ============================================================================
// Generic Do Builder
// ============================================================================

/**
 * A generic Do builder that works with any monad
 *
 * @example
 * ```typescript
 * const result = Do(OptionMonad)
 *   .bind('x', Some(1))
 *   .bind('y', Some(2))
 *   .bind('z', ({ x, y }) => Some(x + y))
 *   .return(({ z }) => z * 10);
 * ```
 */
export interface Monad<F> {
  pure<A>(a: A): F;
  flatMap<A, B>(fa: F, f: (a: A) => F): F;
  map<A, B>(fa: F, f: (a: A) => B): F;
}

export class DoBuilder<F, Ctx extends object> {
  constructor(
    private readonly M: {
      pure<A>(a: A): unknown;
      flatMap<A, B>(fa: unknown, f: (a: A) => unknown): unknown;
      map<A, B>(fa: unknown, f: (a: A) => B): unknown;
    },
    private readonly fa: F,
  ) {}

  /**
   * Bind a monadic value to a name
   */
  bind<N extends string, B>(
    name: Exclude<N, keyof Ctx>,
    fb: F | ((ctx: Ctx) => F),
  ): DoBuilder<F, Ctx & { readonly [K in N]: B }> {
    const next = this.M.flatMap(this.fa as unknown, (ctx: Ctx) => {
      const value =
        typeof fb === "function" ? (fb as (ctx: Ctx) => F)(ctx) : fb;
      return this.M.map(value as unknown, (b: B) => ({
        ...ctx,
        [name]: b,
      })) as unknown;
    });
    return new DoBuilder(this.M, next as F);
  }

  /**
   * Bind a pure (non-monadic) value
   */
  let_<N extends string, B>(
    name: Exclude<N, keyof Ctx>,
    f: (ctx: Ctx) => B,
  ): DoBuilder<F, Ctx & { readonly [K in N]: B }> {
    const next = this.M.map(this.fa as unknown, (ctx: Ctx) => ({
      ...ctx,
      [name]: f(ctx),
    }));
    return new DoBuilder(this.M, next as F);
  }

  /**
   * Return a value from the context
   */
  return<B>(f: (ctx: Ctx) => B): F {
    return this.M.map(this.fa as unknown, f) as F;
  }

  /**
   * Return the context itself
   */
  done(): F {
    return this.fa;
  }

  /**
   * Execute an effect without binding
   */
  do_(fb: F | ((ctx: Ctx) => F)): DoBuilder<F, Ctx> {
    const next = this.M.flatMap(this.fa as unknown, (ctx: Ctx) => {
      const value =
        typeof fb === "function" ? (fb as (ctx: Ctx) => F)(ctx) : fb;
      return this.M.map(value as unknown, () => ctx);
    });
    return new DoBuilder(this.M, next as F);
  }
}

/**
 * Start a do-comprehension with a monad
 */
export function Do<F>(M: {
  pure<A>(a: A): unknown;
  flatMap<A, B>(fa: unknown, f: (a: A) => unknown): unknown;
  map<A, B>(fa: unknown, f: (a: A) => B): unknown;
}): DoBuilder<F, {}> {
  return new DoBuilder(M, M.pure({}) as F);
}

// ============================================================================
// Option Do
// ============================================================================

/**
 * Option monad instance for Do (zero-cost null-based)
 */
export const OptionDo = {
  // With null-based Option, Some(a) = a
  pure: <A>(a: A): Option<A> => a,
  flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> => {
    // With null-based Option, fa IS the value when it's not null
    if (fa === null) return null;
    return f(fa);
  },
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => {
    // With null-based Option, fa IS the value when it's not null
    if (fa === null) return null;
    return f(fa);
  },
};

/**
 * Start a do-comprehension for Option
 *
 * @example
 * ```typescript
 * const result = OptionFor
 *   .bind('x', Some(1))
 *   .bind('y', Some(2))
 *   .return(({ x, y }) => x + y);
 * // result: Some(3)
 * ```
 */
export const OptionFor = Do<Option<unknown>>(OptionDo);

// ============================================================================
// Either Do
// ============================================================================

/**
 * Either monad instance for Do
 */
export function EitherDo<E>() {
  return {
    pure: <A>(a: A): Either<E, A> => Right(a),
    flatMap: <A, B>(
      fa: Either<E, A>,
      f: (a: A) => Either<E, B>,
    ): Either<E, B> => {
      if (fa._tag === "Left") return fa as unknown as Either<E, B>;
      return f(fa.right);
    },
    map: <A, B>(fa: Either<E, A>, f: (a: A) => B): Either<E, B> => {
      if (fa._tag === "Left") return fa as unknown as Either<E, B>;
      return Right(f(fa.right));
    },
  };
}

/**
 * Start a do-comprehension for Either
 */
export function EitherFor<E>() {
  return Do<Either<E, unknown>>(EitherDo<E>());
}

// ============================================================================
// IO Do
// ============================================================================

/**
 * IO monad instance for Do
 */
export const IODo = {
  pure: <A>(a: A): IO<A> => IO.pure(a),
  flatMap: <A, B>(fa: IO<A>, f: (a: A) => IO<B>): IO<B> => IO.flatMap(fa, f),
  map: <A, B>(fa: IO<A>, f: (a: A) => B): IO<B> => IO.map(fa, f),
};

/**
 * Start a do-comprehension for IO
 *
 * @example
 * ```typescript
 * const program = IOFor
 *   .bind('name', Console.prompt("Name: "))
 *   .do_(({ name }) => Console.putStrLn(`Hello, ${name}!`))
 *   .return(() => ExitSuccess);
 * ```
 */
export const IOFor = Do<IO<unknown>>(IODo);

// ============================================================================
// Chain Builder (Alternative Approach)
// ============================================================================

/**
 * A more flexible chain builder that uses callbacks
 */
export function chain<A>(initial: A): Chain<A> {
  return new Chain(initial);
}

class Chain<A> {
  constructor(private readonly value: A) {}

  /**
   * Apply a function to the value
   */
  map<B>(f: (a: A) => B): Chain<B> {
    return new Chain(f(this.value));
  }

  /**
   * Apply a function that returns a Chain
   */
  flatMap<B>(f: (a: A) => Chain<B>): Chain<B> {
    return f(this.value);
  }

  /**
   * Get the final value
   */
  run(): A {
    return this.value;
  }

  /**
   * Tap - execute a side effect and return the original value
   */
  tap(f: (a: A) => void): Chain<A> {
    f(this.value);
    return this;
  }
}

// ============================================================================
// For-yield simulation
// ============================================================================

/**
 * For comprehension builder using a fluent API
 *
 * @example
 * ```typescript
 * const result = For.from(Some(1))
 *   .flatMap(x => For.from(Some(2)).map(y => x + y));
 * ```
 */
export const For = {
  /**
   * Start a for comprehension from a value
   */
  from<F, A>(fa: F): ForComprehension<F, A> {
    return new ForComprehension(fa);
  },
};

class ForComprehension<F, A> {
  constructor(private readonly fa: F) {}

  /**
   * Map over the value (yield transformation)
   */
  map<B>(f: (a: A) => B): F {
    // This would need to be specialized per type
    // For demonstration, we'll return the original
    return this.fa;
  }

  /**
   * FlatMap (bind in for comprehension)
   */
  flatMap<B>(f: (a: A) => ForComprehension<F, B>): ForComprehension<F, B> {
    return f(undefined as A); // Placeholder
  }

  /**
   * Filter (if guard in for comprehension)
   */
  filter(predicate: (a: A) => boolean): ForComprehension<F, A> {
    return this; // Placeholder
  }

  /**
   * Get the underlying value
   */
  get value(): F {
    return this.fa;
  }
}

// ============================================================================
// Computation Expression (F#-style)
// ============================================================================

/**
 * A computation expression builder
 * This is an alternative pattern inspired by F# computation expressions
 */
export interface ComputationBuilder<F> {
  zero(): F;
  return_<A>(a: A): F;
  bind<A, B>(fa: F, f: (a: A) => F): F;
  combine(fa: F, fb: F): F;
  delay<A>(f: () => F): F;
  run<A>(f: F): F;
}

/**
 * Create a computation expression for Option (zero-cost null-based)
 */
export const optionCE: ComputationBuilder<Option<unknown>> = {
  // None = null
  zero: () => null,
  // Some(a) = a
  return_: <A>(a: A) => a,
  bind: <A, B>(fa: Option<A>, f: (a: A) => Option<B>) =>
    fa === null ? null : f(fa),
  combine: (fa, fb) => (fa === null ? fb : fa),
  delay: <A>(f: () => Option<A>) => f(),
  run: <A>(f: Option<A>) => f,
};

// ============================================================================
// Async Do (for Promise-like types)
// ============================================================================

/**
 * Async do-notation using async/await under the hood
 * This is mainly for demonstration - native async/await is usually better
 */
export async function asyncDo<A>(
  computation: () => AsyncGenerator<unknown, A, unknown>,
): Promise<A> {
  const gen = computation();
  let result = await gen.next();

  while (!result.done) {
    const value = await result.value;
    result = await gen.next(value);
  }

  return result.value;
}

/**
 * Helper to yield a Promise in asyncDo
 */
export function* yieldAsync<A>(
  promise: Promise<A>,
): Generator<Promise<A>, A, A> {
  return yield promise;
}
