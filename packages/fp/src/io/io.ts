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
 * - Stack-safe: one explicit continuation/handler stack, no recursion
 * - Async/sync effect handling (async steps resume on a microtask)
 * - Error handling with typed errors
 * - Resource safety with bracket pattern
 * - Best-effort cancellation of race/timeout losers only: the loser's pending
 *   async step's cancel function runs (IO.sleep clears its timer) and an
 *   IOCancelledError is raised into it so finalizers still run. There is no
 *   general fiber/interruption model (no fork/join, no uncancelable masks);
 *   a FromPromise step cannot stop the underlying promise.
 *
 * Inspired by Scala's Cats Effect IO
 */

import { Either, Left, Right, isLeft, isRight } from "../data/either.js";
import { Option, Some, None, isSome } from "../data/option.js";

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
    // Linear: one fresh accumulator per run (suspend), pushed in place.
    return IO.suspend(() => {
      const out: B[] = [];
      const go = (i: number): IO<B[]> =>
        i >= arr.length
          ? IO.pure(out)
          : IO.flatMap(f(arr[i]), (b) => {
              out.push(b);
              return go(i + 1);
            });
      return go(0);
    });
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
    // The loser is cancelled (its pending async step's cancel function runs —
    // e.g. clearTimeout for IO.sleep — and IOCancelledError is raised into it
    // so its guarantee/bracket finalizers still run).
    return IO.async<Either<A, B>>((cb) => {
      let settled = false;
      let cancelA: (() => void) | undefined;
      let cancelB: (() => void) | undefined;
      const settle = (r: Either<Error, Either<A, B>>, loser: () => (() => void) | undefined) => {
        if (settled) return;
        settled = true;
        loser()?.();
        cb(r);
      };
      cancelA = runIOCancelable(fa, (r) =>
        settle(isLeft(r) ? Left(r.left) : Right(Left<A, B>(r.right)), () => cancelB)
      );
      if (!settled) {
        cancelB = runIOCancelable(fb, (r) =>
          settle(isLeft(r) ? Left(r.left) : Right(Right<A, B>(r.right)), () => cancelA)
        );
      }
      return () => {
        settled = true;
        cancelA?.();
        cancelB?.();
      };
    });
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
    return IO.traverse(Array.from({ length: n }), () => fa);
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
      IO.flatMap(IO.attempt(use(r)), (result): IO<A> => {
        return IO.flatMap(release(r), () => {
          if (isLeft(result)) {
            return IO.raiseError(result.left!);
          }
          return IO.pure(result.right);
        });
      })
    );
  },

  /**
   * Guarantee - always run finalizer
   */
  guarantee<A>(fa: IO<A>, finalizer: IO<void>): IO<A> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      return IO.flatMap(finalizer, () => {
        if (isLeft(result)) {
          return IO.raiseError(result.left!);
        }
        return IO.pure(result.right);
      });
    });
  },

  /**
   * OnError - run an action when error occurs
   */
  onError<A>(fa: IO<A>, handler: (e: Error) => IO<void>): IO<A> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (isLeft(result)) {
        return IO.flatMap(handler(result.left!), () => IO.raiseError(result.left!));
      }
      return IO.pure(result.right);
    });
  },

  /**
   * Redeem - handle both success and failure
   */
  redeem<A, B>(fa: IO<A>, recover: (e: Error) => B, map: (a: A) => B): IO<B> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (isLeft(result)) {
        return IO.pure(recover(result.left!));
      }
      return IO.pure(map(result.right));
    });
  },

  /**
   * RedeemWith - handle both with effectful functions
   */
  redeemWith<A, B>(fa: IO<A>, recover: (e: Error) => IO<B>, map: (a: A) => IO<B>): IO<B> {
    return IO.flatMap(IO.attempt(fa), (result) => {
      if (isLeft(result)) {
        return recover(result.left!);
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
        // With zero-cost Option, cache is the Either value when Some, null when None
        if (isSome(cache)) {
          // isSome narrows cache to non-null; cast through unknown for opaque Option
          const c = cache as unknown as Either<Error, A>;
          if (isLeft(c)) {
            return IO.raiseError(c.left!);
          }
          return IO.pure(c.right);
        }

        return IO.flatMap(IO.attempt(fa), (result) => {
          cache = Some(result);
          if (isLeft(result)) {
            return IO.raiseError(result.left!);
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
      (result): Option<A> => (isLeft(result) ? Some(result.left as A) : None)
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
 * Raised inside a fiber that was cancelled (the loser of `IO.race` /
 * `IO.timeout`). It is delivered at the fiber's pending async step so that
 * `guarantee`/`bracket`/`onError` finalizers still run; `handleError`
 * handlers are NOT invoked for it (a cancelled fiber cannot "recover").
 */
export class IOCancelledError extends Error {
  constructor() {
    super("IO fiber was cancelled");
    this.name = "IOCancelledError";
  }
}

/**
 * Interpreter stack frames. Error handlers live on the SAME explicit stack as
 * continuations (no nested interpreter run per HandleError/Attempt), so:
 *  - only the guarded IO is inside a handler's scope — a throw in a later
 *    continuation is never caught by an inner handler (finding #2);
 *  - deeply nested guarantee/handleError is stack-safe (finding #13).
 */
type Frame =
  | { readonly k: 0; readonly f: (a: unknown) => IO<unknown> } // continuation
  | { readonly k: 1; readonly handler: (e: Error) => IO<unknown> } // HandleError
  | { readonly k: 2 }; // Attempt

const ATTEMPT_FRAME: Frame = { k: 2 };

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Schedule a fiber resumption. Microtasks, not setTimeout(0) (finding #18). */
const schedule: (f: () => void) => void =
  typeof queueMicrotask === "function" ? queueMicrotask : (f) => Promise.resolve().then(f);

/**
 * Start interpreting `io`. `cb` is called exactly once with the outcome
 * (unless the IO never completes). Returns a cancel function: cancelling a
 * fiber suspended at an async step calls that step's cancel function (e.g.
 * `clearTimeout` for `IO.sleep`), drops its eventual result, and raises
 * `IOCancelledError` into the fiber. Cancelling a completed fiber is a no-op.
 */
function runFiber<A>(io: IO<A>, cb: (result: Either<Error, A>) => void): () => void {
  const stack: Frame[] = [];
  let finished = false;
  // Suspension state
  let suspendToken = 0; // bumps on every suspension; stale callbacks are ignored
  let suspended = false;
  let pendingCancel: (() => void) | undefined;
  let cancelRequested = false;

  function finish(result: Either<Error, A>): void {
    finished = true;
    cb(result);
  }

  // Resume with either a value or an error; `io` non-undefined means evaluate it.
  function loop(start: IO<unknown> | undefined, value: unknown, error: Error | undefined): void {
    let current: IO<unknown> | undefined = start;
    let hasError = error !== undefined;
    let err: Error | undefined = error;
    let val: unknown = value;

    while (true) {
      if (current !== undefined) {
        const c: IO<unknown> = current;
        current = undefined;
        switch (c._tag) {
          case "Pure":
            val = c.value;
            break;
          case "Delay":
            try {
              val = c.thunk();
            } catch (e) {
              err = toError(e);
              hasError = true;
            }
            break;
          case "Suspend":
            try {
              current = c.thunk();
            } catch (e) {
              err = toError(e);
              hasError = true;
            }
            break;
          case "FlatMap":
            stack.push({ k: 0, f: c.f as (a: unknown) => IO<unknown> });
            current = c.fa;
            break;
          case "HandleError":
            stack.push({ k: 1, handler: c.handler as (e: Error) => IO<unknown> });
            current = c.fa;
            break;
          case "Attempt":
            stack.push(ATTEMPT_FRAME);
            current = c.fa;
            break;
          case "Async":
          case "FromPromise": {
            const token = ++suspendToken;
            suspended = true;
            pendingCancel = undefined;
            // Results delivered synchronously (during register) are picked up
            // after register returns, so the loop never re-enters itself.
            let syncResult: { v: unknown; e: Error | undefined } | undefined;
            let registering = true;
            const resume = (v: unknown, e: Error | undefined): void => {
              if (token !== suspendToken || !suspended) return; // stale / duplicate
              suspended = false;
              pendingCancel = undefined;
              if (registering) {
                syncResult = { v, e };
              } else {
                schedule(() => loop(undefined, v, e));
              }
            };
            try {
              if (c._tag === "Async") {
                const cancel = c.register((result) => {
                  if (isLeft(result)) resume(undefined, toError(result.left));
                  else resume(result.right, undefined);
                });
                if (typeof cancel === "function" && suspended && token === suspendToken) {
                  pendingCancel = cancel;
                }
              } else {
                c.thunk().then(
                  (v) => resume(v, undefined),
                  (e) => resume(undefined, toError(e))
                );
              }
            } catch (e) {
              resume(undefined, toError(e));
            }
            registering = false;
            if (syncResult === undefined) {
              if (cancelRequested) deliverCancel();
              return; // the callback will resume the fiber
            }
            val = syncResult.v;
            if (syncResult.e !== undefined) {
              err = syncResult.e;
              hasError = true;
            }
            break;
          }
          default: {
            const _exhaustive: never = c;
            err = new Error(`Unknown IO tag: ${(c as IO<unknown>)._tag}`);
            hasError = true;
          }
        }
        continue;
      }

      // Deliver val / err to the next frame.
      if (hasError) {
        let frame: Frame | undefined;
        while ((frame = stack.pop()) !== undefined) {
          if (frame.k === 2) break;
          if (frame.k === 1 && !(err instanceof IOCancelledError)) break;
        }
        if (frame === undefined) {
          finish(Left(err!) as Either<Error, A>);
          return;
        }
        hasError = false;
        if (frame.k === 2) {
          val = Left(err!);
        } else {
          try {
            current = (frame as { handler: (e: Error) => IO<unknown> }).handler(err!);
          } catch (e) {
            err = toError(e);
            hasError = true;
          }
        }
        continue;
      }

      const frame = stack.pop();
      if (frame === undefined) {
        finish(Right(val as A));
        return;
      }
      if (frame.k === 0) {
        try {
          current = frame.f(val);
        } catch (e) {
          err = toError(e);
          hasError = true;
        }
      } else if (frame.k === 2) {
        val = Right(val);
      }
      // k === 1 on success: handler goes out of scope, value passes through.
    }
  }

  function deliverCancel(): void {
    if (!suspended || finished) return;
    cancelRequested = false;
    const cancel = pendingCancel;
    suspended = false; // invalidates the pending callback
    pendingCancel = undefined;
    suspendToken++;
    try {
      cancel?.();
    } catch {
      /* cancel functions are best-effort */
    }
    schedule(() => loop(undefined, undefined, new IOCancelledError()));
  }

  loop(io, undefined, undefined);

  return () => {
    if (finished) return;
    if (suspended) deliverCancel();
    else cancelRequested = true; // delivered at the next suspension point
  };
}

/**
 * Run an IO to get a Promise
 */
export function runIO<A>(io: IO<A>): Promise<A> {
  return new Promise((resolve, reject) => {
    runFiber(io, (result) => {
      if (isLeft(result)) {
        reject(result.left);
      } else {
        resolve(result.right);
      }
    });
  });
}

/**
 * Run an IO with a callback; returns a cancel function (see `IOCancelledError`).
 */
export function runIOCancelable<A>(io: IO<A>, cb: (result: Either<Error, A>) => void): () => void {
  return runFiber(io, cb);
}

/**
 * Run IO synchronously (only works for sync-only IOs)
 * Will throw if the IO contains async operations
 */
export function runIOSync<A>(io: IO<A>): A {
  const stack: Frame[] = [];
  let current: IO<unknown> | undefined = io;
  let val: unknown;
  let err: Error | undefined;
  let hasError = false;

  while (true) {
    if (current !== undefined) {
      const c: IO<unknown> = current;
      current = undefined;
      switch (c._tag) {
        case "Pure":
          val = c.value;
          break;
        case "Delay":
          try {
            val = c.thunk();
          } catch (e) {
            err = toError(e);
            hasError = true;
          }
          break;
        case "Suspend":
          try {
            current = c.thunk();
          } catch (e) {
            err = toError(e);
            hasError = true;
          }
          break;
        case "FlatMap":
          stack.push({ k: 0, f: c.f as (a: unknown) => IO<unknown> });
          current = c.fa;
          break;
        case "HandleError":
          stack.push({ k: 1, handler: c.handler as (e: Error) => IO<unknown> });
          current = c.fa;
          break;
        case "Attempt":
          stack.push(ATTEMPT_FRAME);
          current = c.fa;
          break;
        case "Async":
        case "FromPromise":
          // A usage error, not an IO failure: not routed through handlers.
          throw new Error("Cannot run async IO synchronously. Use runIO instead.");
        default: {
          const _exhaustive: never = c;
          throw new Error(`Unknown IO tag: ${(c as IO<unknown>)._tag}`);
        }
      }
      continue;
    }

    if (hasError) {
      let frame: Frame | undefined;
      while ((frame = stack.pop()) !== undefined && frame.k === 0) {
        /* unwind continuations */
      }
      if (frame === undefined) throw err;
      hasError = false;
      if (frame.k === 2) {
        val = Left(err!);
      } else {
        try {
          current = (frame as { handler: (e: Error) => IO<unknown> }).handler(err!);
        } catch (e) {
          err = toError(e);
          hasError = true;
        }
      }
      continue;
    }

    const frame = stack.pop();
    if (frame === undefined) return val as A;
    if (frame.k === 0) {
      try {
        current = frame.f(val);
      } catch (e) {
        err = toError(e);
        hasError = true;
      }
    } else if (frame.k === 2) {
      val = Right(val);
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
