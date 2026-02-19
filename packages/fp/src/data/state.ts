/**
 * State Monad
 *
 * State<S, A> represents a computation that takes a state of type S,
 * and produces both a value of type A and a new state.
 *
 * State<S, A> = S => [A, S]
 */

// ============================================================================
// State Type Definition
// ============================================================================

/**
 * State monad - a stateful computation
 */
export class State<S, A> {
  constructor(private readonly _run: (s: S) => [A, S]) {}

  /**
   * Run the stateful computation
   */
  run(s: S): [A, S] {
    return this._run(s);
  }

  /**
   * Run and return only the result value
   */
  runA(s: S): A {
    return this._run(s)[0];
  }

  /**
   * Run and return only the final state
   */
  runS(s: S): S {
    return this._run(s)[1];
  }

  /**
   * Map over the result value
   */
  map<B>(f: (a: A) => B): State<S, B> {
    return new State((s) => {
      const [a, s2] = this._run(s);
      return [f(a), s2];
    });
  }

  /**
   * FlatMap (chain) - sequence two stateful computations
   */
  flatMap<B>(f: (a: A) => State<S, B>): State<S, B> {
    return new State((s) => {
      const [a, s2] = this._run(s);
      return f(a).run(s2);
    });
  }

  /**
   * Apply (ap) - apply a function in State to a value in State
   */
  ap<B>(this: State<S, (a: A) => B>, sa: State<S, A>): State<S, B> {
    return this.flatMap((f) => sa.map(f));
  }

  /**
   * Modify the state
   */
  modify(f: (s: S) => S): State<S, A> {
    return new State((s) => {
      const [a, s2] = this._run(s);
      return [a, f(s2)];
    });
  }

  /**
   * Get the current state alongside the result
   */
  get(): State<S, [A, S]> {
    return new State((s) => {
      const [a, s2] = this._run(s);
      return [[a, s2], s2];
    });
  }

  /**
   * Inspect the state
   */
  inspect<B>(f: (s: S) => B): State<S, B> {
    return this.flatMap(() => State.inspect(f));
  }

  /**
   * Product - combine two State values into a tuple
   */
  product<B>(sb: State<S, B>): State<S, [A, B]> {
    return this.flatMap((a) => sb.map((b) => [a, b] as [A, B]));
  }

  /**
   * Discard the result, keep only the state
   */
  void_(): State<S, void> {
    return this.map(() => undefined);
  }

  /**
   * Replace the result with a constant
   */
  as<B>(b: B): State<S, B> {
    return this.map(() => b);
  }

  /**
   * Tap - perform a side effect and return the original value
   */
  tap(f: (a: A) => void): State<S, A> {
    return this.map((a) => {
      f(a);
      return a;
    });
  }
}

// ============================================================================
// Static Constructors
// ============================================================================

export namespace State {
  /**
   * Create a State that returns a pure value
   */
  export function pure<S, A>(a: A): State<S, A> {
    return new State((s) => [a, s]);
  }

  /**
   * Alias for pure
   */
  export function of<S, A>(a: A): State<S, A> {
    return pure(a);
  }

  /**
   * Get the current state
   */
  export function get<S>(): State<S, S> {
    return new State((s) => [s, s]);
  }

  /**
   * Set the state
   */
  export function set<S>(s: S): State<S, void> {
    return new State(() => [undefined, s]);
  }

  /**
   * Modify the state
   */
  export function modify<S>(f: (s: S) => S): State<S, void> {
    return new State((s) => [undefined, f(s)]);
  }

  /**
   * Inspect the state
   */
  export function inspect<S, A>(f: (s: S) => A): State<S, A> {
    return new State((s) => [f(s), s]);
  }

  /**
   * Create a State from a function
   */
  export function from<S, A>(f: (s: S) => [A, S]): State<S, A> {
    return new State(f);
  }

  /**
   * Gets a specific property from the state
   */
  export function gets<S, A>(f: (s: S) => A): State<S, A> {
    return inspect(f);
  }
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Map over the result value (standalone function)
 */
export function map<S, A, B>(sa: State<S, A>, f: (a: A) => B): State<S, B> {
  return sa.map(f);
}

/**
 * FlatMap (standalone function)
 */
export function flatMap<S, A, B>(
  sa: State<S, A>,
  f: (a: A) => State<S, B>,
): State<S, B> {
  return sa.flatMap(f);
}

/**
 * Apply (standalone function)
 */
export function ap<S, A, B>(
  sf: State<S, (a: A) => B>,
  sa: State<S, A>,
): State<S, B> {
  return sf.flatMap((f) => sa.map(f));
}

/**
 * Flatten nested State
 */
export function flatten<S, A>(ssa: State<S, State<S, A>>): State<S, A> {
  return ssa.flatMap((sa) => sa);
}

/**
 * Traverse an array with a State-returning function
 */
export function traverse<S, A, B>(
  arr: A[],
  f: (a: A) => State<S, B>,
): State<S, B[]> {
  return arr.reduce(
    (acc: State<S, B[]>, a: A) =>
      acc.flatMap((bs) => f(a).map((b) => [...bs, b])),
    State.pure([]),
  );
}

/**
 * Sequence an array of State values
 */
export function sequence<S, A>(states: State<S, A>[]): State<S, A[]> {
  return traverse(states, (s) => s);
}

/**
 * Execute a State action repeatedly n times
 */
export function replicateA<S, A>(n: number, sa: State<S, A>): State<S, A[]> {
  if (n <= 0) return State.pure([]);
  return sa.flatMap((a) => replicateA(n - 1, sa).map((as) => [a, ...as]));
}

/**
 * Execute an action while a condition holds
 */
export function whileM<S>(
  cond: State<S, boolean>,
  body: State<S, void>,
): State<S, void> {
  return cond.flatMap((b) => {
    if (b) {
      return body.flatMap(() => whileM(cond, body));
    }
    return State.pure(undefined);
  });
}

/**
 * Execute an action until a condition holds
 */
export function untilM<S>(
  body: State<S, void>,
  cond: State<S, boolean>,
): State<S, void> {
  return body.flatMap(() =>
    cond.flatMap((b) => {
      if (b) {
        return State.pure(undefined);
      }
      return untilM(body, cond);
    }),
  );
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with State
 */
export function Do<S>(): State<S, {}> {
  return State.pure({});
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, S, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => State<S, B>,
): (state: State<S, A>) => State<S, A & { readonly [K in N]: B }> {
  return (state) =>
    state.flatMap((a) =>
      f(a).map((b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, S, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (state: State<S, A>) => State<S, A & { readonly [K in N]: B }> {
  return (state) =>
    state.map((a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// IndexedState (bonus - for state type changes)
// ============================================================================

/**
 * IndexedState allows the state type to change
 */
export class IndexedState<S1, S2, A> {
  constructor(private readonly _run: (s: S1) => [A, S2]) {}

  run(s: S1): [A, S2] {
    return this._run(s);
  }

  map<B>(f: (a: A) => B): IndexedState<S1, S2, B> {
    return new IndexedState((s) => {
      const [a, s2] = this._run(s);
      return [f(a), s2];
    });
  }

  flatMap<S3, B>(
    f: (a: A) => IndexedState<S2, S3, B>,
  ): IndexedState<S1, S3, B> {
    return new IndexedState((s) => {
      const [a, s2] = this._run(s);
      return f(a).run(s2);
    });
  }

  /**
   * Convert to regular State (when S1 === S2)
   */
  toState(this: IndexedState<S1, S1, A>): State<S1, A> {
    return new State(this._run);
  }
}

export namespace IndexedState {
  /**
   * Pure for IndexedState
   */
  export function pure<S, A>(a: A): IndexedState<S, S, A> {
    return new IndexedState((s) => [a, s]);
  }

  /**
   * Set state with type change
   */
  export function set<S1, S2>(s: S2): IndexedState<S1, S2, void> {
    return new IndexedState(() => [undefined, s]);
  }

  /**
   * Get the current state
   */
  export function get<S>(): IndexedState<S, S, S> {
    return new IndexedState((s) => [s, s]);
  }

  /**
   * Modify with type change
   */
  export function modify<S1, S2>(f: (s: S1) => S2): IndexedState<S1, S2, void> {
    return new IndexedState((s) => [undefined, f(s)]);
  }
}
