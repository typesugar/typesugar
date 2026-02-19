/**
 * Reader Monad
 *
 * Reader<R, A> represents a computation that reads from an environment of type R
 * to produce a value of type A.
 *
 * Reader<R, A> = R => A
 *
 * Useful for:
 * - Dependency injection
 * - Configuration threading
 * - Implicit parameters
 */

// ============================================================================
// Reader Type Definition
// ============================================================================

/**
 * Reader monad - a computation that reads from an environment
 */
export class Reader<R, A> {
  constructor(private readonly _run: (r: R) => A) {}

  /**
   * Run the Reader with an environment
   */
  run(r: R): A {
    return this._run(r);
  }

  /**
   * Alias for run
   */
  runReader(r: R): A {
    return this._run(r);
  }

  /**
   * Map over the result value
   */
  map<B>(f: (a: A) => B): Reader<R, B> {
    return new Reader((r) => f(this._run(r)));
  }

  /**
   * FlatMap (chain) - sequence two Reader computations
   */
  flatMap<B>(f: (a: A) => Reader<R, B>): Reader<R, B> {
    return new Reader((r) => f(this._run(r)).run(r));
  }

  /**
   * Apply (ap) - apply a function in Reader to a value in Reader
   */
  ap<B>(this: Reader<R, (a: A) => B>, ra: Reader<R, A>): Reader<R, B> {
    return this.flatMap((f) => ra.map(f));
  }

  /**
   * Provide part of the environment (contramap)
   */
  local<R2>(f: (r2: R2) => R): Reader<R2, A> {
    return new Reader((r2) => this._run(f(r2)));
  }

  /**
   * Provide the full environment, removing the dependency
   */
  provide(r: R): Reader<unknown, A> {
    return new Reader(() => this._run(r));
  }

  /**
   * Combine two Readers into a tuple
   */
  product<B>(rb: Reader<R, B>): Reader<R, [A, B]> {
    return this.flatMap((a) => rb.map((b) => [a, b] as [A, B]));
  }

  /**
   * Zip two Readers with a function
   */
  zipWith<B, C>(rb: Reader<R, B>, f: (a: A, b: B) => C): Reader<R, C> {
    return this.flatMap((a) => rb.map((b) => f(a, b)));
  }

  /**
   * Replace the result with a constant
   */
  as<B>(b: B): Reader<R, B> {
    return this.map(() => b);
  }

  /**
   * Discard the result
   */
  void_(): Reader<R, void> {
    return this.map(() => undefined);
  }

  /**
   * Tap - execute a side effect and return the original value
   */
  tap(f: (a: A) => void): Reader<R, A> {
    return this.map((a) => {
      f(a);
      return a;
    });
  }
}

// ============================================================================
// Static Constructors
// ============================================================================

export namespace Reader {
  /**
   * Create a Reader that returns a pure value (ignoring environment)
   */
  export function pure<R, A>(a: A): Reader<R, A> {
    return new Reader(() => a);
  }

  /**
   * Alias for pure
   */
  export function of<R, A>(a: A): Reader<R, A> {
    return pure(a);
  }

  /**
   * Get the entire environment
   */
  export function ask<R>(): Reader<R, R> {
    return new Reader((r) => r);
  }

  /**
   * Get a specific property from the environment
   */
  export function asks<R, A>(f: (r: R) => A): Reader<R, A> {
    return new Reader(f);
  }

  /**
   * Alias for asks
   */
  export function reader<R, A>(f: (r: R) => A): Reader<R, A> {
    return new Reader(f);
  }

  /**
   * Create a Reader from a function
   */
  export function from<R, A>(f: (r: R) => A): Reader<R, A> {
    return new Reader(f);
  }

  /**
   * Create a Reader that always returns the same value
   */
  export function constant<R, A>(a: A): Reader<R, A> {
    return pure(a);
  }

  /**
   * Lift a function into Reader
   */
  export function lift<A, B>(
    f: (a: A) => B,
  ): <R>(ra: Reader<R, A>) => Reader<R, B> {
    return (ra) => ra.map(f);
  }

  /**
   * Lift a binary function into Reader
   */
  export function lift2<A, B, C>(
    f: (a: A, b: B) => C,
  ): <R>(ra: Reader<R, A>, rb: Reader<R, B>) => Reader<R, C> {
    return (ra, rb) => ra.flatMap((a) => rb.map((b) => f(a, b)));
  }
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Map over the result (standalone function)
 */
export function map<R, A, B>(ra: Reader<R, A>, f: (a: A) => B): Reader<R, B> {
  return ra.map(f);
}

/**
 * FlatMap (standalone function)
 */
export function flatMap<R, A, B>(
  ra: Reader<R, A>,
  f: (a: A) => Reader<R, B>,
): Reader<R, B> {
  return ra.flatMap(f);
}

/**
 * Apply (standalone function)
 */
export function ap<R, A, B>(
  rf: Reader<R, (a: A) => B>,
  ra: Reader<R, A>,
): Reader<R, B> {
  return rf.flatMap((f) => ra.map(f));
}

/**
 * Flatten nested Reader
 */
export function flatten<R, A>(rra: Reader<R, Reader<R, A>>): Reader<R, A> {
  return rra.flatMap((ra) => ra);
}

/**
 * Traverse an array with a Reader-returning function
 */
export function traverse<R, A, B>(
  arr: A[],
  f: (a: A) => Reader<R, B>,
): Reader<R, B[]> {
  return arr.reduce(
    (acc: Reader<R, B[]>, a: A) =>
      acc.flatMap((bs) => f(a).map((b) => [...bs, b])),
    Reader.pure([]),
  );
}

/**
 * Sequence an array of Reader values
 */
export function sequence<R, A>(readers: Reader<R, A>[]): Reader<R, A[]> {
  return traverse(readers, (r) => r);
}

/**
 * Execute a Reader action repeatedly n times
 */
export function replicateA<R, A>(n: number, ra: Reader<R, A>): Reader<R, A[]> {
  if (n <= 0) return Reader.pure([]);
  return ra.flatMap((a) => replicateA(n - 1, ra).map((as) => [a, ...as]));
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Reader
 */
export function Do<R>(): Reader<R, {}> {
  return Reader.pure({});
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, R, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Reader<R, B>,
): (reader: Reader<R, A>) => Reader<R, A & { readonly [K in N]: B }> {
  return (reader) =>
    reader.flatMap((a) =>
      f(a).map((b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, R, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (reader: Reader<R, A>) => Reader<R, A & { readonly [K in N]: B }> {
  return (reader) =>
    reader.map((a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// ReaderT (Reader Transformer) - bonus
// ============================================================================

/**
 * ReaderT transformer - adds Reader capability to any monad
 * ReaderT<R, M, A> ≅ R => M<A>
 */
export class ReaderT<R, M, A> {
  constructor(private readonly _run: (r: R) => M) {}

  run(r: R): M {
    return this._run(r);
  }
}

export namespace ReaderT {
  /**
   * Lift a value into ReaderT
   */
  export function pure<R, M, A>(ma: M): ReaderT<R, M, A> {
    return new ReaderT(() => ma);
  }

  /**
   * Ask for the environment in ReaderT
   */
  export function ask<R, MPure extends <T>(a: T) => unknown>(
    pure: MPure,
  ): ReaderT<R, ReturnType<MPure>, R> {
    return new ReaderT((r) => pure(r) as ReturnType<MPure>);
  }
}

// ============================================================================
// Kleisli - Reader arrow composition
// ============================================================================

/**
 * Kleisli represents a function A => Reader<R, B>
 * Also known as a Reader arrow
 */
export class Kleisli<R, A, B> {
  constructor(private readonly _run: (a: A) => Reader<R, B>) {}

  run(a: A): Reader<R, B> {
    return this._run(a);
  }

  /**
   * Compose with another Kleisli
   */
  andThen<C>(kb: Kleisli<R, B, C>): Kleisli<R, A, C> {
    return new Kleisli((a) => this._run(a).flatMap((b) => kb.run(b)));
  }

  /**
   * Compose with another Kleisli (reversed)
   */
  compose<Z>(kz: Kleisli<R, Z, A>): Kleisli<R, Z, B> {
    return kz.andThen(this);
  }

  /**
   * Map over the output
   */
  map<C>(f: (b: B) => C): Kleisli<R, A, C> {
    return new Kleisli((a) => this._run(a).map(f));
  }

  /**
   * Local environment modification
   */
  local<R2>(f: (r2: R2) => R): Kleisli<R2, A, B> {
    return new Kleisli((a) => this._run(a).local(f));
  }
}

export namespace Kleisli {
  /**
   * Identity Kleisli
   */
  export function id<R, A>(): Kleisli<R, A, A> {
    return new Kleisli((a) => Reader.pure(a));
  }

  /**
   * Lift a pure function into Kleisli
   */
  export function lift<R, A, B>(f: (a: A) => B): Kleisli<R, A, B> {
    return new Kleisli((a) => Reader.pure(f(a)));
  }

  /**
   * Lift a Reader into Kleisli (ignoring input)
   */
  export function liftReader<R, A, B>(rb: Reader<R, B>): Kleisli<R, A, B> {
    return new Kleisli(() => rb);
  }
}
