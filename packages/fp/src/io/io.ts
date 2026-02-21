/**
 * IO Monad
 *
 * IO<A> represents an effectful computation that, when executed,
 * may perform side effects and produce a value of type A.
 *
 * IO is implemented as an ADT (Algebraic Data Type) with a
 * trampoline interpreter for stack-safety.
 *
 * Features:
 * - Lazy evaluation (effects only run when interpreted)
 * - Stack-safe through trampolining
 * - Async/sync effect handling
 * - Error handling with typed errors
 * - Resource safety with bracket pattern
 * - Cancellation support
 *
 * Inspired by Scala's Cats Effect IO
 */

import { Either, Left, Right } from "../data/either";
import { Option, Some, None } from "../data/option";

// ============================================================================
// IO ADT Definition
// ============================================================================

/**
 * IO operation tags
 */
type IOTag =
  | "Pure"
  | "Suspend"
  | "FlatMap"
  | "Async"
  | "HandleError"
  | "Attempt"
  | "Delay"
  | "FromPromise";

/**
 * Base IO type - an ADT for representing effects
 */
export type IO<A> =
  | Pure<A>
  | Suspend<A>
  | FlatMap<unknown, A>
  | Async<A>
  | HandleError<A>
  | Attempt<A>
  | Delay<A>
  | FromPromise<A>;

/**
 * Pure - lift a pure value into IO (no effects)
 */
interface Pure<A> {
  readonly _tag: "Pure";
  readonly value: A;
}

/**
 * Suspend - defer a computation
 */
interface Suspend<A> {
  readonly _tag: "Suspend";
  readonly thunk: () => IO<A>;
}

/**
 * FlatMap - sequential composition
 */
interface FlatMap<A, B> {
  readonly _tag: "FlatMap";
  readonly fa: IO<A>;
  readonly f: (a: A) => IO<B>;
}

/**
 * Async - asynchronous computation with callback
 */
interface Async<A> {
  readonly _tag: "Async";
  readonly register: (cb: (result: Either<Error, A>) => void) => void | (() => void);
}

/**
 * HandleError - error recovery
 */
interface HandleError<A> {
  readonly _tag: "HandleError";
  readonly fa: IO<A>;
  readonly handler: (e: Error) => IO<A>;
}

/**
 * Attempt - convert errors to values
 */
interface Attempt<A> {
  readonly _tag: "Attempt";
  readonly fa: IO<A>;
}

/**
 * Delay - delayed synchronous computation
 */
interface Delay<A> {
  readonly _tag: "Delay";
  readonly thunk: () => A;
}

/**
 * FromPromise - lift a Promise-returning function
 */
interface FromPromise<A> {
  readonly _tag: "FromPromise";
  readonly thunk: () => Promise<A>;
}

// ============================================================================
// IO Constructors
// ============================================================================

export const IO = {
  /**
   * Lift a pure value into IO
   */
  pure<A>(value: A): IO<A> {
    return { _tag: "Pure", value };
  },

  /**
   * Alias for pure
   */
  of<A>(value: A): IO<A> {
    return IO.pure(value);
  },

  /**
   * Return the unit IO
   */
  unit: { _tag: "Pure", value: undefined } as IO<void>,

  /**
   * Suspend a computation
   */
  suspend<A>(thunk: () => IO<A>): IO<A> {
    return { _tag: "Suspend", thunk };
  },

  /**
   * Delay a synchronous computation
   */
  delay<A>(thunk: () => A): IO<A> {
    return { _tag: "Delay", thunk };
  },

  /**
   * Alias for delay
   */
  sync<A>(thunk: () => A): IO<A> {
    return IO.delay(thunk);
  },

  /**
   * Create an IO from a callback-based async computation
   */
  async<A>(register: (cb: (result: Either<Error, A>) => void) => void | (() => void)): IO<A> {
    return { _tag: "Async", register };
  },

  /**
   * Create an IO from a Promise-returning function
   */
  fromPromise<A>(thunk: () => Promise<A>): IO<A> {
    return { _tag: "FromPromise", thunk };
  },

  /**
   * Lift a Promise into IO (immediately starts)
   */
  fromPromiseEager<A>(promise: Promise<A>): IO<A> {
    return IO.fromPromise(() => promise);
  },

  /**
   * Raise an error in IO
   */
  raiseError<A>(error: Error): IO<A> {
    return IO.delay(() => {
      throw error;
    });
  },

  /**
   * Never-completing IO
   */
  get never(): IO<never> {
    return {
      _tag: "Async",
      register: () => {
        /* Never calls callback */
      },
    };
  },

  /**
   * Sleep for a specified duration
   */
  sleep(ms: number): IO<void> {
    return IO.async((cb) => {
      const timer = setTimeout(() => cb(Right(undefined)), ms);
      return () => clearTimeout(timer);
    });
  },

  /**
   * Attempt - convert errors to Either
   */
  attempt<A>(fa: IO<A>): IO<Either<Error, A>> {
    return { _tag: "Attempt", fa } as unknown as IO<Either<Error, A>>;
  },

  /**
   * Handle errors with a recovery function
   */
  handleError<A>(fa: IO<A>, handler: (e: Error) => IO<A>): IO<A> {
    return { _tag: "HandleError", fa, handler };
  },

  /**
   * Handle errors with a pure recovery function
   */
  handleErrorWith<A>(fa: IO<A>, handler: (e: Error) => A): IO<A> {
    return IO.handleError(fa, (e) => IO.pure(handler(e)));
  },

  /**
   * Map over the IO value
   */
  map<A, B>(fa: IO<A>, f: (a: A) => B): IO<B> {
    return IO.flatMap(fa, (a) => IO.pure(f(a)));
  },

  /**
   * FlatMap - sequential composition
   */
  flatMap<A, B>(fa: IO<A>, f: (a: A) => IO<B>): IO<B> {
    return { _tag: "FlatMap", fa, f: f as (a: unknown) => IO<B> };
  },

  /**
   * Flatten nested IO
   */
  flatten<A>(ffa: IO<IO<A>>): IO<A> {
    return IO.flatMap(ffa, (fa) => fa);
  },

  /**
   * Apply - apply function in IO to value in IO
   */
  ap<A, B>(ff: IO<(a: A) => B>, fa: IO<A>): IO<B> {
    return IO.flatMap(ff, (f) => IO.map(fa, f));
  },

  /**
   * Map2 - combine two IOs
   */
  map2<A, B, C>(fa: IO<A>, fb: IO<B>, f: (a: A, b: B) => C): IO<C> {
    return IO.flatMap(fa, (a) => IO.map(fb, (b) => f(a, b)));
  },

  /**
   * Map3 - combine three IOs
   */
  map3<A, B, C, D>(fa: IO<A>, fb: IO<B>, fc: IO<C>, f: (a: A, b: B, c: C) => D): IO<D> {
    return IO.flatMap(fa, (a) => IO.flatMap(fb, (b) => IO.map(fc, (c) => f(a, b, c))));
  },

  /**
   * Product - combine two IOs into a tuple
   */
  product<A, B>(fa: IO<A>, fb: IO<B>): IO<[A, B]> {
    return IO.map2(fa, fb, (a, b) => [a, b]);
  },

  /**
   * ProductL - run both, keep first
   */
  productL<A, B>(fa: IO<A>, fb: IO<B>): IO<A> {
    return IO.flatMap(fa, (a) => IO.map(fb, () => a));
  },

  /**
   * ProductR - run both, keep second
   */
  productR<A, B>(fa: IO<A>, fb: IO<B>): IO<B> {
    return IO.flatMap(fa, () => fb);
  },

  /**
   * Replace the value with a constant
   */
  as<A, B>(fa: IO<A>, b: B): IO<B> {
    return IO.map(fa, () => b);
  },

  /**
   * Discard the value
   */
  void_<A>(fa: IO<A>): IO<void> {
    return IO.as(fa, undefined);
  },

  /**
   * Execute for side effects, ignore the result
   */
  tap<A>(fa: IO<A>, f: (a: A) => IO<unknown>): IO<A> {
    return IO.flatMap(fa, (a) => IO.as(f(a), a));
  },

  /**
   * Execute for side effects (pure function)
   */
  tapPure<A>(fa: IO<A>, f: (a: A) => void): IO<A> {
    return IO.tap(fa, (a) =>
      IO.delay(() => {
        f(a);
      })
    );
  },

  /**
   * Traverse an array with an IO-returning function
   */
  traverse<A, B>(arr: A[], f: (a: A) => IO<B>): IO<B[]> {
    return arr.reduce(
      (acc: IO<B[]>, a: A) => IO.flatMap(acc, (bs) => IO.map(f(a), (b) => [...bs, b])),
      IO.pure([])
    );
  },

  /**
   * Sequence an array of IOs
   */
  sequence<A>(ios: IO<A>[]): IO<A[]> {
    return IO.traverse(ios, (io) => io);
  },

  /**
   * Traverse in parallel (for independent IOs)
   */
  parTraverse<A, B>(arr: A[], f: (a: A) => IO<B>): IO<B[]> {
    return IO.fromPromise(() => Promise.all(arr.map((a) => runIO(f(a)))));
  },

  /**
   * Sequence in parallel
   */
  parSequence<A>(ios: IO<A>[]): IO<A[]> {
    return IO.parTraverse(ios, (io) => io);
  },

  /**
   * Race two IOs - first to complete wins
   */
  race<A, B>(fa: IO<A>, fb: IO<B>): IO<Either<A, B>> {
    return IO.fromPromise(() =>
      Promise.race([runIO(fa).then((a) => Left<A, B>(a)), runIO(fb).then((b) => Right<A, B>(b))])
    );
  },

  /**
   * Both - run in parallel, wait for both
   */
  both<A, B>(fa: IO<A>, fb: IO<B>): IO<[A, B]> {
    return IO.fromPromise(() =>
      Promise.all([runIO(fa), runIO(fb)]).then(([a, b]) => [a, b] as [A, B])
    );
  },

  /**
   * Replicate an IO n times
   */
  replicateA<A>(n: number, fa: IO<A>): IO<A[]> {
    if (n <= 0) return IO.pure([]);
    return IO.flatMap(fa, (a) => IO.map(IO.replicateA(n - 1, fa), (as) => [a, ...as]));
  },

  /**
   * Iterate while a condition holds
   */
  whileM_<A>(cond: IO<boolean>, body: IO<A>): IO<void> {
    return IO.flatMap(cond, (b) => {
      if (b) {
        return IO.flatMap(body, () => IO.whileM_(cond, body));
      }
      return IO.unit;
    });
  },

  /**
   * Iterate until a condition holds
   */
  untilM_<A>(body: IO<A>, cond: IO<boolean>): IO<void> {
    return IO.flatMap(body, () =>
      IO.flatMap(cond, (b) => {
        if (b) {
          return IO.unit;
        }
        return IO.untilM_(body, cond);
      })
    );
  },

  /**
   * ifM - conditional execution
   */
  ifM<A>(cond: IO<boolean>, ifTrue: IO<A>, ifFalse: IO<A>): IO<A> {
    return IO.flatMap(cond, (b) => (b ? ifTrue : ifFalse));
  },

  /**
   * whenA - execute when condition is true
   */
  whenA(cond: boolean, fa: IO<void>): IO<void> {
    return cond ? fa : IO.unit;
  },

  /**
   * unlessA - execute when condition is false
   */
  unlessA(cond: boolean, fa: IO<void>): IO<void> {
    return cond ? IO.unit : fa;
  },

  /**
   * Bracket - resource safety pattern
   */
  bracket<R, A>(acquire: IO<R>, use: (r: R) => IO<A>, release: (r: R) => IO<void>): IO<A> {
    return IO.flatMap(acquire, (r) =>
      IO.flatMap(
        IO.attempt(use(r)),
        (result): IO<A> =>
          IO.flatMap(release(r), () => {
            if (result._tag === "Left") {
              return IO.raiseError(result.left);
            }
            return IO.pure(result.right);
          })
      )
    );
  },

  /**
   * Guarantee - always run finalizer
   */
  guarantee<A>(fa: IO<A>, finalizer: IO<void>): IO<A> {
    return IO.flatMap(IO.attempt(fa), (result) =>
      IO.flatMap(finalizer, () => {
        if (result._tag === "Left") {
          return IO.raiseError(result.left);
        }
        return IO.pure(result.right);
      })
    );
  },

  /**
   * OnError - run an action when error occurs
   */
  onError<A>(fa: IO<A>, handler: (e: Error) => IO<void>): IO<A> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (result._tag === "Left") {
        return IO.flatMap(handler(result.left), () => IO.raiseError(result.left));
      }
      return IO.pure(result.right);
    });
  },

  /**
   * Redeem - handle both success and failure
   */
  redeem<A, B>(fa: IO<A>, recover: (e: Error) => B, map: (a: A) => B): IO<B> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (result._tag === "Left") {
        return IO.pure(recover(result.left));
      }
      return IO.pure(map(result.right));
    });
  },

  /**
   * RedeemWith - handle both with effectful functions
   */
  redeemWith<A, B>(fa: IO<A>, recover: (e: Error) => IO<B>, map: (a: A) => IO<B>): IO<B> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (result._tag === "Left") {
        return recover(result.left);
      }
      return map(result.right);
    });
  },

  /**
   * Memoize - cache the result of an IO
   */
  memoize<A>(fa: IO<A>): IO<IO<A>> {
    return IO.delay(() => {
      let cache: Option<Either<Error, A>> = None;

      return IO.suspend(() => {
        // With null-based Option, cache IS the value when it's not null
        if (cache !== null) {
          const cached = cache;
          if (cached._tag === "Left") {
            return IO.raiseError(cached.left);
          }
          return IO.pure(cached.right);
        }

        return IO.flatMap(IO.attempt(fa), (result) => {
          cache = Some(result);
          if (result._tag === "Left") {
            return IO.raiseError(result.left);
          }
          return IO.pure(result.right);
        });
      });
    });
  },

  /**
   * Timeout - fail if IO doesn't complete in time
   */
  timeout<A>(fa: IO<A>, ms: number): IO<Option<A>> {
    return IO.map(
      IO.race(fa, IO.sleep(ms)),
      (result): Option<A> => (result._tag === "Left" ? Some(result.left) : None)
    );
  },

  /**
   * Retry an IO n times
   */
  retry<A>(fa: IO<A>, n: number): IO<A> {
    if (n <= 0) return fa;
    return IO.handleError(fa, () => IO.retry(fa, n - 1));
  },

  /**
   * Retry with exponential backoff
   */
  retryWithBackoff<A>(fa: IO<A>, maxRetries: number, baseDelay: number): IO<A> {
    function attempt(remaining: number, delay: number): IO<A> {
      return IO.handleError(fa, (e) => {
        if (remaining <= 0) {
          return IO.raiseError(e);
        }
        return IO.flatMap(IO.sleep(delay), () => attempt(remaining - 1, delay * 2));
      });
    }
    return attempt(maxRetries, baseDelay);
  },
};

// ============================================================================
// IO Runner (Interpreter)
// ============================================================================

/**
 * Trampoline types for stack-safe interpretation
 */
type Trampoline<A> = Done<A> | More<A>;

interface Done<A> {
  readonly _tag: "Done";
  readonly value: A;
}

interface More<A> {
  readonly _tag: "More";
  readonly thunk: () => Trampoline<A>;
}

const done = <A>(a: A): Done<A> => ({ _tag: "Done", value: a });
const more = <A>(thunk: () => Trampoline<A>): More<A> => ({
  _tag: "More",
  thunk,
});

/**
 * Run a trampoline to completion
 */
function runTrampoline<A>(t: Trampoline<A>): A {
  let current = t;
  while (current._tag === "More") {
    current = current.thunk();
  }
  return current.value;
}

/**
 * Run an IO to get a Promise
 */
export function runIO<A>(io: IO<A>): Promise<A> {
  return new Promise((resolve, reject) => {
    runIOAsync(io, (result) => {
      if (result._tag === "Left") {
        reject(result.left);
      } else {
        resolve(result.right);
      }
    });
  });
}

/**
 * Run an IO with a callback
 */
function runIOAsync<A>(io: IO<A>, cb: (result: Either<Error, A>) => void): void {
  type Frame = (a: unknown) => IO<unknown>;
  const stack: Frame[] = [];
  let current: IO<unknown> = io;

  function loop(): void {
    try {
      while (true) {
        switch (current._tag) {
          case "Pure": {
            if (stack.length === 0) {
              cb(Right(current.value as A));
              return;
            }
            const f = stack.pop()!;
            current = f(current.value);
            break;
          }

          case "Delay": {
            const value = current.thunk();
            if (stack.length === 0) {
              cb(Right(value as A));
              return;
            }
            const f = stack.pop()!;
            current = f(value);
            break;
          }

          case "Suspend": {
            current = current.thunk();
            break;
          }

          case "FlatMap": {
            const fm = current;
            stack.push(fm.f as Frame);
            current = fm.fa;
            break;
          }

          case "Async": {
            const cancel = current.register((result) => {
              if (result._tag === "Left") {
                cb(Left(result.left));
              } else if (stack.length === 0) {
                cb(Right(result.right as A));
              } else {
                const f = stack.pop()!;
                current = f(result.right);
                // Use setImmediate or setTimeout to avoid blocking
                setTimeout(loop, 0);
              }
            });
            return; // Exit the loop, callback will resume
          }

          case "FromPromise": {
            const thunk = current.thunk;
            thunk()
              .then((value) => {
                if (stack.length === 0) {
                  cb(Right(value as A));
                } else {
                  const f = stack.pop()!;
                  current = f(value);
                  setTimeout(loop, 0);
                }
              })
              .catch((error) => {
                cb(Left(error instanceof Error ? error : new Error(String(error))));
              });
            return; // Exit the loop, promise will resume
          }

          case "HandleError": {
            const he = current;
            const innerStack = [...stack];
            stack.length = 0;

            // Run the inner IO
            runIOAsync(he.fa, (result) => {
              if (result._tag === "Left") {
                current = he.handler(result.left);
              } else {
                current = IO.pure(result.right);
              }
              stack.push(...innerStack);
              setTimeout(loop, 0);
            });
            return;
          }

          case "Attempt": {
            const att = current;
            runIOAsync(att.fa as IO<unknown>, (result) => {
              if (stack.length === 0) {
                cb(Right(result as unknown as A));
              } else {
                const f = stack.pop()!;
                current = f(result);
                setTimeout(loop, 0);
              }
            });
            return;
          }

          default: {
            const _exhaustive: never = current;
            throw new Error(`Unknown IO tag: ${(current as IO<unknown>)._tag}`);
          }
        }
      }
    } catch (e) {
      cb(Left(e instanceof Error ? e : new Error(String(e))));
    }
  }

  loop();
}

/**
 * Run IO synchronously (only works for sync-only IOs)
 * Will throw if the IO contains async operations
 */
export function runIOSync<A>(io: IO<A>): A {
  type Frame = (a: unknown) => IO<unknown>;
  const stack: Frame[] = [];
  let current: IO<unknown> = io;

  while (true) {
    switch (current._tag) {
      case "Pure": {
        if (stack.length === 0) {
          return current.value as A;
        }
        const f = stack.pop()!;
        current = f(current.value);
        break;
      }

      case "Delay": {
        const value = current.thunk();
        if (stack.length === 0) {
          return value as A;
        }
        const f = stack.pop()!;
        current = f(value);
        break;
      }

      case "Suspend": {
        current = current.thunk();
        break;
      }

      case "FlatMap": {
        stack.push(current.f as Frame);
        current = current.fa;
        break;
      }

      case "Async":
      case "FromPromise":
        throw new Error("Cannot run async IO synchronously. Use runIO instead.");

      case "HandleError": {
        const handler = current.handler;
        try {
          const result = runIOSync(current.fa);
          if (stack.length === 0) {
            return result as A;
          }
          const f = stack.pop()!;
          current = f(result);
        } catch (e) {
          current = handler(e instanceof Error ? e : new Error(String(e)));
        }
        break;
      }

      case "Attempt": {
        try {
          const result = runIOSync(current.fa);
          const either = Right(result);
          if (stack.length === 0) {
            return either as unknown as A;
          }
          const f = stack.pop()!;
          current = f(either);
        } catch (e) {
          const either = Left(e instanceof Error ? e : new Error(String(e)));
          if (stack.length === 0) {
            return either as unknown as A;
          }
          const f = stack.pop()!;
          current = f(either);
        }
        break;
      }

      default: {
        const _exhaustive: never = current;
        throw new Error(`Unknown IO tag: ${(current as IO<unknown>)._tag}`);
      }
    }
  }
}

/**
 * Unsafe run - run and block (only for top-level main)
 */
export async function unsafeRunIO<A>(io: IO<A>): Promise<A> {
  return runIO(io);
}

// ============================================================================
// Do-notation Support
// ============================================================================

export const IODo = {
  /**
   * Start a do-comprehension with IO
   */
  Do: IO.pure({}) as IO<{}>,

  /**
   * Bind a value in do-notation style
   */
  bind<N extends string, A extends object, B>(
    name: Exclude<N, keyof A>,
    f: (a: A) => IO<B>
  ): (io: IO<A>) => IO<A & { readonly [K in N]: B }> {
    return (io) =>
      IO.flatMap(io, (a) =>
        IO.map(f(a), (b) => ({ ...a, [name]: b }) as A & { readonly [K in N]: B })
      );
  },

  /**
   * Let - bind a non-effectful value
   */
  let_<N extends string, A extends object, B>(
    name: Exclude<N, keyof A>,
    f: (a: A) => B
  ): (io: IO<A>) => IO<A & { readonly [K in N]: B }> {
    return (io) => IO.map(io, (a) => ({ ...a, [name]: f(a) }) as A & { readonly [K in N]: B });
  },
};

// ============================================================================
// Fluent API (method-chain style)
// ============================================================================

/**
 * Extended IO with fluent methods
 */
export function io<A>(computation: IO<A>): IOFluent<A> {
  return new IOFluent(computation);
}

export class IOFluent<A> {
  constructor(private readonly _io: IO<A>) {}

  get io(): IO<A> {
    return this._io;
  }

  map<B>(f: (a: A) => B): IOFluent<B> {
    return new IOFluent(IO.map(this._io, f));
  }

  flatMap<B>(f: (a: A) => IO<B>): IOFluent<B> {
    return new IOFluent(IO.flatMap(this._io, f));
  }

  tap(f: (a: A) => IO<unknown>): IOFluent<A> {
    return new IOFluent(IO.tap(this._io, f));
  }

  as<B>(b: B): IOFluent<B> {
    return new IOFluent(IO.as(this._io, b));
  }

  void_(): IOFluent<void> {
    return new IOFluent(IO.void_(this._io));
  }

  handleError(handler: (e: Error) => IO<A>): IOFluent<A> {
    return new IOFluent(IO.handleError(this._io, handler));
  }

  attempt(): IOFluent<Either<Error, A>> {
    return new IOFluent(IO.attempt(this._io));
  }

  guarantee(finalizer: IO<void>): IOFluent<A> {
    return new IOFluent(IO.guarantee(this._io, finalizer));
  }

  timeout(ms: number): IOFluent<Option<A>> {
    return new IOFluent(IO.timeout(this._io, ms));
  }

  retry(n: number): IOFluent<A> {
    return new IOFluent(IO.retry(this._io, n));
  }

  run(): Promise<A> {
    return runIO(this._io);
  }

  runSync(): A {
    return runIOSync(this._io);
  }
}
