/**
 * Deferred - A Promise-like structure for IO
 *
 * Deferred<A> represents a value that will be available in the future.
 * It can only be completed once, and all waiters will receive the same value.
 *
 * Inspired by Scala's Cats Effect Deferred
 */

import { IO, runIO } from "./io.js";
import { Either, Left, Right } from "../data/either.js";
import { Option, Some, None } from "../data/option.js";

// ============================================================================
// Deferred Type
// ============================================================================

/**
 * Deferred - a synchronization primitive that represents a value
 * that may not yet be available.
 *
 * - Can only be completed once
 * - All waiters get the same value
 * - Waiting is semantic blocking (non-blocking under the hood)
 */
export class Deferred<A> {
  // Explicit flag: Option<A> is A | null, so a null value would read as empty.
  private _set = false;
  private _value: A | undefined = undefined;
  private _waiters: Array<(a: A) => void> = [];

  private constructor() {}

  /**
   * Get the value, waiting until it's available
   */
  get(): IO<A> {
    return IO.async<A>((cb) => {
      if (this._set) {
        cb(Right(this._value as A));
      } else {
        this._waiters.push((a) => cb(Right(a)));
      }
    });
  }

  /**
   * Try to get the value (returns None if not yet completed)
   */
  tryGet(): IO<Option<A>> {
    // Note: for Deferred<null>, Some(null) is indistinguishable from None —
    // use isCompleted() to tell them apart.
    return IO.delay(() => (this._set ? Some(this._value as A) : None));
  }

  /**
   * Complete the Deferred with a value
   * Returns false if already completed
   */
  complete(a: A): IO<boolean> {
    return IO.delay(() => {
      if (this._set) {
        return false;
      }
      this._set = true;
      this._value = a;
      // Notify all waiters
      const waiters = this._waiters;
      this._waiters = [];
      for (const waiter of waiters) {
        waiter(a);
      }
      return true;
    });
  }

  /**
   * Complete the Deferred with a value, throwing if already completed
   */
  complete_(a: A): IO<void> {
    return IO.flatMap(this.complete(a), (success) => {
      if (success) {
        return IO.unit;
      }
      return IO.raiseError(new Error("Deferred already completed"));
    });
  }

  /**
   * Check if the Deferred is completed
   */
  isCompleted(): IO<boolean> {
    return IO.delay(() => this._set);
  }

  /**
   * Create a new empty Deferred
   */
  static make<A>(): IO<Deferred<A>> {
    return IO.delay(() => new Deferred<A>());
  }

  /**
   * Create a Deferred that's already completed
   */
  static completed<A>(a: A): IO<Deferred<A>> {
    return IO.flatMap(Deferred.make<A>(), (d) => IO.as(d.complete(a), d));
  }

  /**
   * Unsafe create (for testing only)
   */
  static unsafe<A>(): Deferred<A> {
    return new Deferred<A>();
  }
}

// ============================================================================
// TryableDeferred - Can also fail
// ============================================================================

/**
 * TryableDeferred - a Deferred that can be completed with either a value or an error
 */
export class TryableDeferred<A> {
  private _value: Option<Either<Error, A>> = None;
  private _waiters: Array<(result: Either<Error, A>) => void> = [];

  private constructor() {}

  /**
   * Get the value, waiting until it's available
   * Will throw if completed with an error
   */
  get(): IO<A> {
    return IO.async<A>((cb) => {
      // With null-based Option, _value IS the value when it's not null
      if (this._value !== null) {
        cb(this._value as any);
      } else {
        this._waiters.push((result) => cb(result));
      }
    });
  }

  /**
   * Try to get the value (returns None if not yet completed)
   */
  tryGet(): IO<Option<Either<Error, A>>> {
    return IO.delay(() => this._value);
  }

  /**
   * Complete the Deferred with a success value
   */
  complete(a: A): IO<boolean> {
    return this.completeWith(Right(a));
  }

  /**
   * Complete the Deferred with an error
   */
  fail(e: Error): IO<boolean> {
    return this.completeWith(Left(e));
  }

  /**
   * Complete with an Either
   */
  completeWith(result: Either<Error, A>): IO<boolean> {
    return IO.delay(() => {
      if (this._value !== null) {
        return false;
      }
      this._value = Some(result);
      for (const waiter of this._waiters) {
        waiter(result);
      }
      this._waiters = [];
      return true;
    });
  }

  /**
   * Check if completed
   */
  isCompleted(): IO<boolean> {
    return IO.delay(() => this._value !== null);
  }

  /**
   * Create a new TryableDeferred
   */
  static make<A>(): IO<TryableDeferred<A>> {
    return IO.delay(() => new TryableDeferred<A>());
  }
}

// ============================================================================
// MVar - Mutable variable that can be empty
// ============================================================================

/**
 * MVar - a mutable location that can be either empty or contain a value.
 *
 * Useful for synchronization:
 * - take waits until there's a value
 * - put waits until there's room
 */
export class MVar<A> {
  // Explicit flag: Option<A> is A | null, so a null value would read as empty.
  private _full: boolean;
  private _value: A | undefined;
  private _takers: Array<(a: A) => void> = [];
  /** Pending read()s: woken by the next value without consuming it. */
  private _readers: Array<(a: A) => void> = [];
  private _putters: Array<[A, () => void]> = [];

  private constructor(initial: { full: boolean; value?: A }) {
    this._full = initial.full;
    this._value = initial.value;
  }

  /** Remove the current value, refilling from the next waiting putter. */
  private _takeValue(): A {
    const value = this._value as A;
    this._full = false;
    this._value = undefined;
    if (this._putters.length > 0) {
      const [newValue, notify] = this._putters.shift()!;
      this._offer(newValue);
      notify();
    }
    return value;
  }

  /** Hand a value to readers (all) and then one taker, or store it. */
  private _offer(a: A): void {
    const readers = this._readers;
    this._readers = [];
    for (const r of readers) r(a);
    if (this._takers.length > 0) {
      const taker = this._takers.shift()!;
      taker(a);
    } else {
      this._full = true;
      this._value = a;
    }
  }

  /**
   * Take the value, waiting if empty
   */
  take(): IO<A> {
    return IO.async<A>((cb) => {
      if (this._full) {
        cb(Right(this._takeValue()));
      } else {
        this._takers.push((a) => cb(Right(a)));
      }
    });
  }

  /**
   * Try to take (non-blocking)
   */
  tryTake(): IO<Option<A>> {
    return IO.delay(() => (this._full ? Some(this._takeValue()) : None));
  }

  /**
   * Put a value, waiting if full
   */
  put(a: A): IO<void> {
    return IO.async<void>((cb) => {
      if (!this._full) {
        this._offer(a);
        cb(Right(undefined));
      } else {
        this._putters.push([a, () => cb(Right(undefined))]);
      }
    });
  }

  /**
   * Try to put (non-blocking)
   */
  tryPut(a: A): IO<boolean> {
    return IO.delay(() => {
      if (!this._full) {
        this._offer(a);
        return true;
      }
      return false;
    });
  }

  /**
   * Read the value without taking it
   */
  read(): IO<A> {
    return IO.async<A>((cb) => {
      if (this._full) {
        cb(Right(this._value as A));
      } else {
        this._readers.push((a) => cb(Right(a)));
      }
    });
  }

  /**
   * Try to read (non-blocking)
   */
  tryRead(): IO<Option<A>> {
    return IO.delay(() => (this._full ? Some(this._value as A) : None));
  }

  /**
   * Check if empty
   */
  isEmpty(): IO<boolean> {
    return IO.delay(() => !this._full);
  }

  /**
   * Modify the value
   */
  modify<B>(f: (a: A) => [B, A]): IO<B> {
    return IO.flatMap(this.take(), (a) => {
      const [b, newA] = f(a);
      return IO.as(this.put(newA), b);
    });
  }

  /**
   * Create an empty MVar
   */
  static empty<A>(): IO<MVar<A>> {
    return IO.delay(() => new MVar<A>({ full: false }));
  }

  /**
   * Create an MVar with an initial value
   */
  static of<A>(a: A): IO<MVar<A>> {
    return IO.delay(() => new MVar<A>({ full: true, value: a }));
  }
}

// ============================================================================
// Latch - Count-down synchronization
// ============================================================================

/**
 * CountDownLatch - block until a count reaches zero
 */
export class CountDownLatch {
  private _count: number;
  private _waiters: Array<() => void> = [];

  private constructor(count: number) {
    this._count = count;
  }

  /**
   * Decrement the count
   */
  countDown(): IO<void> {
    return IO.delay(() => {
      if (this._count > 0) {
        this._count--;
        if (this._count === 0) {
          for (const waiter of this._waiters) {
            waiter();
          }
          this._waiters = [];
        }
      }
    });
  }

  /**
   * Wait until count reaches zero
   */
  await_(): IO<void> {
    return IO.async<void>((cb) => {
      if (this._count === 0) {
        cb(Right(undefined));
      } else {
        this._waiters.push(() => cb(Right(undefined)));
      }
    });
  }

  /**
   * Get current count
   */
  getCount(): IO<number> {
    return IO.delay(() => this._count);
  }

  /**
   * Create a new latch
   */
  static make(count: number): IO<CountDownLatch> {
    return IO.delay(() => new CountDownLatch(count));
  }
}

// ============================================================================
// CyclicBarrier - Reusable synchronization point
// ============================================================================

/**
 * CyclicBarrier - multiple parties wait until all arrive
 */
export class CyclicBarrier {
  private _waiting: number = 0;
  private _waiters: Array<() => void> = [];
  private _generation: number = 0;

  private constructor(private readonly _parties: number) {}

  /**
   * Await at the barrier
   */
  await_(): IO<void> {
    return IO.async<void>((cb) => {
      const currentGen = this._generation;
      this._waiting++;

      if (this._waiting >= this._parties) {
        // All parties arrived - release everyone
        this._waiting = 0;
        this._generation++;
        const waiters = this._waiters;
        this._waiters = [];
        for (const waiter of waiters) {
          waiter();
        }
        cb(Right(undefined));
      } else {
        // Wait for others
        this._waiters.push(() => cb(Right(undefined)));
      }
    });
  }

  /**
   * Get number of waiting parties
   */
  getNumberWaiting(): IO<number> {
    return IO.delay(() => this._waiting);
  }

  /**
   * Get the total parties
   */
  getParties(): IO<number> {
    return IO.delay(() => this._parties);
  }

  /**
   * Create a new barrier
   */
  static make(parties: number): IO<CyclicBarrier> {
    if (parties <= 0) {
      return IO.raiseError(new Error("Parties must be positive"));
    }
    return IO.delay(() => new CyclicBarrier(parties));
  }
}
