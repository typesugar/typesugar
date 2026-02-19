/**
 * Writer Monad
 *
 * Writer<W, A> represents a computation that produces a value of type A
 * and accumulates a log/output of type W.
 *
 * Writer<W, A> = [A, W]
 *
 * Useful for:
 * - Logging
 * - Tracing
 * - Accumulating results
 *
 * W must be a Monoid for proper composition
 */

import {
  Monoid,
  combineAll as combineAllMonoid,
} from "../typeclasses/semigroup";

// ============================================================================
// Writer Type Definition
// ============================================================================

/**
 * Writer monad - a computation that produces a value and accumulates a log
 */
export class Writer<W, A> {
  constructor(
    private readonly _value: A,
    private readonly _log: W,
  ) {}

  /**
   * Run the Writer, returning [value, log]
   */
  run(): [A, W] {
    return [this._value, this._log];
  }

  /**
   * Get the computed value
   */
  value(): A {
    return this._value;
  }

  /**
   * Get the accumulated log
   */
  written(): W {
    return this._log;
  }

  /**
   * Map over the value
   */
  map<B>(f: (a: A) => B): Writer<W, B> {
    return new Writer(f(this._value), this._log);
  }

  /**
   * FlatMap - sequence writers, combining logs with a Monoid
   */
  flatMap<B>(f: (a: A) => Writer<W, B>, W: Monoid<W>): Writer<W, B> {
    const wb = f(this._value);
    return new Writer(wb._value, W.combine(this._log, wb._log));
  }

  /**
   * Apply (ap)
   */
  ap<B>(
    this: Writer<W, (a: A) => B>,
    wa: Writer<W, A>,
    W: Monoid<W>,
  ): Writer<W, B> {
    return this.flatMap((f) => wa.map(f), W);
  }

  /**
   * Map over the log
   */
  mapWritten<W2>(f: (w: W) => W2): Writer<W2, A> {
    return new Writer(this._value, f(this._log));
  }

  /**
   * Transform both value and log
   */
  bimap<W2, B>(fw: (w: W) => W2, fa: (a: A) => B): Writer<W2, B> {
    return new Writer(fa(this._value), fw(this._log));
  }

  /**
   * Add to the log
   */
  tell(w: W, W: Monoid<W>): Writer<W, A> {
    return new Writer(this._value, W.combine(this._log, w));
  }

  /**
   * Clear the log
   */
  reset(W: Monoid<W>): Writer<W, A> {
    return new Writer(this._value, W.empty);
  }

  /**
   * Swap value and log (if they're the same type)
   */
  swap(this: Writer<A, A>): Writer<A, A> {
    return new Writer(this._log, this._value);
  }

  /**
   * Modify the log using the current value
   */
  censor(f: (w: W) => W): Writer<W, A> {
    return new Writer(this._value, f(this._log));
  }

  /**
   * Make the value available to transform the log
   */
  listen(): Writer<W, [A, W]> {
    return new Writer([this._value, this._log], this._log);
  }

  /**
   * Listen with a transformation
   */
  listens<B>(f: (w: W) => B): Writer<W, [A, B]> {
    return new Writer([this._value, f(this._log)], this._log);
  }

  /**
   * Pass - use a function in the value to transform the log
   */
  pass(this: Writer<W, [A, (w: W) => W]>): Writer<W, A> {
    const [[a, f], w] = [this._value, this._log];
    return new Writer(a, f(w));
  }

  /**
   * Product - combine two Writers into a tuple
   */
  product<B>(wb: Writer<W, B>, W: Monoid<W>): Writer<W, [A, B]> {
    return this.flatMap((a) => wb.map((b) => [a, b] as [A, B]), W);
  }

  /**
   * Zip with a function
   */
  zipWith<B, C>(
    wb: Writer<W, B>,
    f: (a: A, b: B) => C,
    W: Monoid<W>,
  ): Writer<W, C> {
    return this.flatMap((a) => wb.map((b) => f(a, b)), W);
  }

  /**
   * Replace the value with a constant
   */
  as<B>(b: B): Writer<W, B> {
    return new Writer(b, this._log);
  }

  /**
   * Discard the value
   */
  void_(): Writer<W, void> {
    return new Writer(undefined, this._log);
  }
}

// ============================================================================
// Static Constructors
// ============================================================================

export namespace Writer {
  /**
   * Create a Writer with a value and empty log
   */
  export function pure<W, A>(a: A, W: Monoid<W>): Writer<W, A> {
    return new Writer(a, W.empty);
  }

  /**
   * Alias for pure
   */
  export function of<W, A>(a: A, W: Monoid<W>): Writer<W, A> {
    return pure(a, W);
  }

  /**
   * Create a Writer that just writes to the log
   */
  export function tell<W>(w: W): Writer<W, void> {
    return new Writer(undefined, w);
  }

  /**
   * Create a Writer with both value and log
   */
  export function writer<W, A>(value: A, log: W): Writer<W, A> {
    return new Writer(value, log);
  }

  /**
   * Create a Writer from a value with empty log
   */
  export function value<W, A>(a: A, W: Monoid<W>): Writer<W, A> {
    return new Writer(a, W.empty);
  }

  /**
   * Create a Writer from a [value, log] tuple
   */
  export function from<W, A>(pair: [A, W]): Writer<W, A> {
    return new Writer(pair[0], pair[1]);
  }

  /**
   * Lift a function into Writer
   */
  export function lift<W, A, B>(
    f: (a: A) => B,
    W: Monoid<W>,
  ): (wa: Writer<W, A>) => Writer<W, B> {
    return (wa) => wa.map(f);
  }

  /**
   * Lift a binary function into Writer
   */
  export function lift2<W, A, B, C>(
    f: (a: A, b: B) => C,
    W: Monoid<W>,
  ): (wa: Writer<W, A>, wb: Writer<W, B>) => Writer<W, C> {
    return (wa, wb) => wa.flatMap((a) => wb.map((b) => f(a, b)), W);
  }
}

// ============================================================================
// Derived Operations
// ============================================================================

/**
 * Map over the value (standalone function)
 */
export function map<W, A, B>(wa: Writer<W, A>, f: (a: A) => B): Writer<W, B> {
  return wa.map(f);
}

/**
 * FlatMap (standalone function)
 */
export function flatMap<W, A, B>(
  wa: Writer<W, A>,
  f: (a: A) => Writer<W, B>,
  W: Monoid<W>,
): Writer<W, B> {
  return wa.flatMap(f, W);
}

/**
 * Apply (standalone function)
 */
export function ap<W, A, B>(
  wf: Writer<W, (a: A) => B>,
  wa: Writer<W, A>,
  W: Monoid<W>,
): Writer<W, B> {
  return wf.flatMap((f) => wa.map(f), W);
}

/**
 * Flatten nested Writer
 */
export function flatten<W, A>(
  wwa: Writer<W, Writer<W, A>>,
  W: Monoid<W>,
): Writer<W, A> {
  return wwa.flatMap((wa) => wa, W);
}

/**
 * Traverse an array with a Writer-returning function
 */
export function traverse<W, A, B>(
  arr: A[],
  f: (a: A) => Writer<W, B>,
  W: Monoid<W>,
): Writer<W, B[]> {
  return arr.reduce(
    (acc: Writer<W, B[]>, a: A) =>
      acc.flatMap((bs) => f(a).map((b) => [...bs, b]), W),
    Writer.pure([], W),
  );
}

/**
 * Sequence an array of Writer values
 */
export function sequence<W, A>(
  writers: Writer<W, A>[],
  W: Monoid<W>,
): Writer<W, A[]> {
  return traverse(writers, (w) => w, W);
}

/**
 * Execute a Writer action repeatedly n times
 */
export function replicateA<W, A>(
  n: number,
  wa: Writer<W, A>,
  W: Monoid<W>,
): Writer<W, A[]> {
  if (n <= 0) return Writer.pure([], W);
  return wa.flatMap((a) => replicateA(n - 1, wa, W).map((as) => [a, ...as]), W);
}

/**
 * Combine all Writers, collecting logs
 */
export function combineAll<W, A>(
  writers: Writer<W, A>[],
  W: Monoid<W>,
  A: Monoid<A>,
): Writer<W, A> {
  if (writers.length === 0) {
    return Writer.pure(A.empty, W);
  }

  return writers.reduce(
    (acc, w) => acc.flatMap((a) => w.map((b) => A.combine(a, b)), W),
    Writer.pure(A.empty, W),
  );
}

// ============================================================================
// Do-notation Support
// ============================================================================

/**
 * Start a do-comprehension with Writer
 */
export function Do<W>(W: Monoid<W>): Writer<W, {}> {
  return Writer.pure({}, W);
}

/**
 * Bind a value in do-notation style
 */
export function bind<N extends string, W, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => Writer<W, B>,
  W: Monoid<W>,
): (writer: Writer<W, A>) => Writer<W, A & { readonly [K in N]: B }> {
  return (writer) =>
    writer.flatMap(
      (a) =>
        f(a).map((b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B }),
      W,
    );
}

/**
 * Let - bind a non-effectful value
 */
export function let_<N extends string, W, A extends object, B>(
  name: Exclude<N, keyof A>,
  f: (a: A) => B,
): (writer: Writer<W, A>) => Writer<W, A & { readonly [K in N]: B }> {
  return (writer) =>
    writer.map((a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
}

// ============================================================================
// Common Writer instances for logging
// ============================================================================

/**
 * A Writer that accumulates strings (log lines)
 */
export type LogWriter<A> = Writer<string[], A>;

export const LogWriterMonoid: Monoid<string[]> = {
  empty: [],
  combine: (a, b) => [...a, ...b],
};

export namespace LogWriter {
  /**
   * Create a LogWriter with a pure value
   */
  export function pure<A>(a: A): LogWriter<A> {
    return Writer.pure(a, LogWriterMonoid);
  }

  /**
   * Log a message
   */
  export function log(message: string): LogWriter<void> {
    return Writer.tell([message]);
  }

  /**
   * Log multiple messages
   */
  export function logAll(messages: string[]): LogWriter<void> {
    return Writer.tell(messages);
  }

  /**
   * Info level log
   */
  export function info(message: string): LogWriter<void> {
    return log(`[INFO] ${message}`);
  }

  /**
   * Warning level log
   */
  export function warn(message: string): LogWriter<void> {
    return log(`[WARN] ${message}`);
  }

  /**
   * Error level log
   */
  export function error(message: string): LogWriter<void> {
    return log(`[ERROR] ${message}`);
  }

  /**
   * Debug level log
   */
  export function debug(message: string): LogWriter<void> {
    return log(`[DEBUG] ${message}`);
  }
}

/**
 * A Writer that accumulates a numeric sum
 */
export type SumWriter<A> = Writer<number, A>;

export const SumWriterMonoid: Monoid<number> = {
  empty: 0,
  combine: (a, b) => a + b,
};

export namespace SumWriter {
  /**
   * Create a SumWriter with a pure value
   */
  export function pure<A>(a: A): SumWriter<A> {
    return Writer.pure(a, SumWriterMonoid);
  }

  /**
   * Add to the sum
   */
  export function add(n: number): SumWriter<void> {
    return Writer.tell(n);
  }

  /**
   * Count (add 1)
   */
  export function count(): SumWriter<void> {
    return add(1);
  }
}

/**
 * A Writer that accumulates a product
 */
export type ProductWriter<A> = Writer<number, A>;

export const ProductWriterMonoid: Monoid<number> = {
  empty: 1,
  combine: (a, b) => a * b,
};

export namespace ProductWriter {
  /**
   * Create a ProductWriter with a pure value
   */
  export function pure<A>(a: A): ProductWriter<A> {
    return Writer.pure(a, ProductWriterMonoid);
  }

  /**
   * Multiply into the product
   */
  export function multiply(n: number): ProductWriter<void> {
    return Writer.tell(n);
  }
}
