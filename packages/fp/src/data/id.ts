/**
 * Id (Identity) Monad
 *
 * Id<A> ≅ A
 *
 * The identity monad - the simplest possible monad that just wraps a value.
 *
 * Useful for:
 * - Testing and debugging
 * - As a base case for monad transformers
 * - When you need a consistent interface but no effects
 *
 * The key insight is that Id is actually isomorphic to the value itself,
 * but having it as a proper type gives us the ability to use it
 * uniformly with other monads.
 */

// ============================================================================
// Id Type Definition
// ============================================================================

/**
 * Identity monad - wraps a value with no additional effects
 */
export class Id<A> {
  constructor(private readonly _value: A) {}

  /**
   * Get the wrapped value
   */
  get value(): A {
    return this._value;
  }

  /**
   * Extract the value
   */
  extract(): A {
    return this._value;
  }

  /**
   * Map over the value
   */
  map<B>(f: (a: A) => B): Id<B> {
    return new Id(f(this._value));
  }

  /**
   * FlatMap - sequence Id computations
   */
  flatMap<B>(f: (a: A) => Id<B>): Id<B> {
    return f(this._value);
  }

  /**
   * Apply (ap)
   */
  ap<B>(this: Id<(a: A) => B>, ia: Id<A>): Id<B> {
    return ia.map(this._value);
  }

  /**
   * Combine two Ids into a tuple
   */
  product<B>(ib: Id<B>): Id<[A, B]> {
    return this.flatMap((a) => ib.map((b) => [a, b] as [A, B]));
  }

  /**
   * Zip with a function
   */
  zipWith<B, C>(ib: Id<B>, f: (a: A, b: B) => C): Id<C> {
    return this.flatMap((a) => ib.map((b) => f(a, b)));
  }

  /**
   * Replace the value with a constant
   */
  as<B>(b: B): Id<B> {
    return new Id(b);
  }

  /**
   * Discard the value
   */
  void_(): Id<void> {
    return new Id(undefined);
  }

  /**
   * Duplicate - wrap in another layer
   */
  duplicate(): Id<Id<A>> {
    return new Id(this);
  }

  /**
   * Extend - the dual of flatMap for comonads
   */
  extend<B>(f: (ia: Id<A>) => B): Id<B> {
    return new Id(f(this));
  }

  /**
   * Tap - execute a side effect and return the original value
   */
  tap(f: (a: A) => void): Id<A> {
    f(this._value);
    return this;
  }

  /**
   * Convert to string
   */
  toString(): string {
    return `Id(${String(this._value)})`;
  }

  /**
   * Check equality
   */
  equals<B extends A>(
    other: Id<B>,
    eq: (a: A, b: B) => boolean = (a, b) => a === b,
  ): boolean {
    return eq(this._value, other._value);
  }
}

// ============================================================================
// Static Constructors
// ============================================================================

export namespace Id {
  /**
   * Create an Id with a value
   */
  export function pure<A>(a: A): Id<A> {
    return new Id(a);
  }

  /**
   * Alias for pure
   */
  export function of<A>(a: A): Id<A> {
    return pure(a);
  }

  /**
   * Create an Id from a value
   */
  export function from<A>(a: A): Id<A> {
    return pure(a);
  }

  /**
   * Lift a function into Id
   */
  export function lift<A, B>(f: (a: A) => B): (ia: Id<A>) => Id<B> {
    return (ia) => ia.map(f);
  }

  /**
   * Lift a binary function into Id
   */
  export function lift2<A, B, C>(
    f: (a: A, b: B) => C,
  ): (ia: Id<A>, ib: Id<B>) => Id<C> {
    return (ia, ib) => ia.flatMap((a) => ib.map((b) => f(a, b)));
  }

  /**
   * Lift a ternary function into Id
   */
  export function lift3<A, B, C, D>(
    f: (a: A, b: B, c: C) => D,
  ): (ia: Id<A>, ib: Id<B>, ic: Id<C>) => Id<D> {
    return (ia, ib, ic) =>
      ia.flatMap((a) => ib.flatMap((b) => ic.map((c) => f(a, b, c))));
  }
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Map over the value (standalone function)
 */
export function map<A, B>(ia: Id<A>, f: (a: A) => B): Id<B> {
  return ia.map(f);
}

/**
 * FlatMap (standalone function)
 */
export function flatMap<A, B>(ia: Id<A>, f: (a: A) => Id<B>): Id<B> {
  return ia.flatMap(f);
}

/**
 * Apply (standalone function)
 */
export function ap<A, B>(idf: Id<(a: A) => B>, ia: Id<A>): Id<B> {
  return ia.map(idf.value);
}

/**
 * Flatten nested Id
 */
export function flatten<A>(iia: Id<Id<A>>): Id<A> {
  return iia.value;
}

/**
 * Extract the value from Id
 */
export function extract<A>(ia: Id<A>): A {
  return ia.value;
}

/**
 * Traverse an array with an Id-returning function
 */
export function traverse<A, B>(arr: A[], f: (a: A) => Id<B>): Id<B[]> {
  return Id.of(arr.map((a) => f(a).value));
}

/**
 * Sequence an array of Id values
 */
export function sequence<A>(ids: Id<A>[]): Id<A[]> {
  return Id.of(ids.map((id) => id.value));
}

/**
 * Execute an Id action repeatedly n times
 */
export function replicateA<A>(n: number, ia: Id<A>): Id<A[]> {
  const result: A[] = [];
  for (let i = 0; i < n; i++) {
    result.push(ia.value);
  }
  return Id.of(result);
}

/**
 * FoldLeft over Id (trivially just applies the function once)
 */
export function foldLeft<A, B>(ia: Id<A>, z: B, f: (b: B, a: A) => B): B {
  return f(z, ia.value);
}

/**
 * FoldRight over Id
 */
export function foldRight<A, B>(ia: Id<A>, z: B, f: (a: A, b: B) => B): B {
  return f(ia.value, z);
}

/**
 * Fold with a monoid
 */
export function foldMap<A, B>(ia: Id<A>, f: (a: A) => B): B {
  return f(ia.value);
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Id
 */
export function Do(): Id<{}> {
  return Id.pure({});
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Id<B>,
): (id: Id<A>) => Id<A & { readonly [K in N]: B }> {
  return (id) =>
    id.flatMap((a) =>
      f(a).map((b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (id: Id<A>) => Id<A & { readonly [K in N]: B }> {
  return (id) =>
    id.map((a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Comonad operations (Id is also a Comonad)
// ============================================================================

/**
 * Extract the value (same as extract method)
 */
export const coExtract = extract;

/**
 * Coflatmap (extend)
 */
export function coflatMap<A, B>(ia: Id<A>, f: (ia: Id<A>) => B): Id<B> {
  return ia.extend(f);
}

/**
 * Duplicate (wrap in another layer)
 */
export function duplicate<A>(ia: Id<A>): Id<Id<A>> {
  return ia.duplicate();
}

// ============================================================================
// Identity as morphism
// ============================================================================

/**
 * The identity function wrapped in a type
 */
export function identity<A>(a: A): A {
  return a;
}

/**
 * Wrap a value in Id and immediately extract it (identity law)
 */
export function idRoundTrip<A>(a: A): A {
  return Id.of(a).extract();
}
