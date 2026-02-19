/**
 * Ref - Mutable Reference in IO
 *
 * Ref<A> provides safe mutable state within the IO monad.
 * All modifications are atomic and thread-safe (in the async sense).
 *
 * Inspired by Scala's Cats Effect Ref
 */

import { IO } from "./io";
import { Option, Some, None } from "../data/option";

// ============================================================================
// Ref Type
// ============================================================================

/**
 * Ref - a mutable reference that can be used in IO
 */
export class Ref<A> {
  private _value: A;

  private constructor(initial: A) {
    this._value = initial;
  }

  /**
   * Get the current value
   */
  get(): IO<A> {
    return IO.delay(() => this._value);
  }

  /**
   * Set a new value
   */
  set(a: A): IO<void> {
    return IO.delay(() => {
      this._value = a;
    });
  }

  /**
   * Get and set atomically
   */
  getAndSet(a: A): IO<A> {
    return IO.delay(() => {
      const old = this._value;
      this._value = a;
      return old;
    });
  }

  /**
   * Modify the value with a function
   */
  modify<B>(f: (a: A) => [B, A]): IO<B> {
    return IO.delay(() => {
      const [b, newA] = f(this._value);
      this._value = newA;
      return b;
    });
  }

  /**
   * Modify the value, returning the old value
   */
  getAndUpdate(f: (a: A) => A): IO<A> {
    return this.modify((a) => [a, f(a)]);
  }

  /**
   * Modify the value, returning the new value
   */
  updateAndGet(f: (a: A) => A): IO<A> {
    return this.modify((a) => {
      const newA = f(a);
      return [newA, newA];
    });
  }

  /**
   * Update the value
   */
  update(f: (a: A) => A): IO<void> {
    return IO.delay(() => {
      this._value = f(this._value);
    });
  }

  /**
   * Try to modify the value if the predicate holds
   */
  tryModify<B>(f: (a: A) => Option<[B, A]>): IO<Option<B>> {
    return IO.delay(() => {
      const result = f(this._value);
      // With null-based Option, result IS the value when it's not null
      if (result !== null) {
        const [b, newA] = result;
        this._value = newA;
        return Some(b);
      }
      return None;
    });
  }

  /**
   * Try to update the value if the predicate holds
   */
  tryUpdate(f: (a: A) => Option<A>): IO<boolean> {
    return IO.map(
      this.tryModify((a) => {
        const result = f(a);
        // With null-based Option, result IS the value when it's not null
        if (result !== null) {
          return Some([undefined as void, result] as [void, A]);
        }
        return None as Option<[void, A]>;
      }),
      (opt) => opt !== null,
    );
  }

  /**
   * Access the value (for inspection only, doesn't guarantee atomic read)
   */
  access(): IO<[A, (a: A) => IO<boolean>]> {
    return IO.delay(() => {
      const snapshot = this._value;
      const setter = (a: A): IO<boolean> =>
        IO.delay(() => {
          // Only set if value hasn't changed
          if (this._value === snapshot) {
            this._value = a;
            return true;
          }
          return false;
        });
      return [snapshot, setter] as [A, (a: A) => IO<boolean>];
    });
  }

  /**
   * Create a new Ref
   */
  static make<A>(initial: A): IO<Ref<A>> {
    return IO.delay(() => new Ref(initial));
  }

  /**
   * Create a Ref with the default value for the type
   * (only works for types with a clear default)
   */
  static of<A>(initial: A): IO<Ref<A>> {
    return Ref.make(initial);
  }

  /**
   * Unsafe create (for testing only)
   */
  static unsafe<A>(initial: A): Ref<A> {
    return new Ref(initial);
  }
}

// ============================================================================
// Counter - Common Ref pattern
// ============================================================================

/**
 * A counter backed by a Ref
 */
export class Counter {
  private constructor(private readonly ref: Ref<number>) {}

  /**
   * Get the current count
   */
  get(): IO<number> {
    return this.ref.get();
  }

  /**
   * Increment and return the new value
   */
  increment(): IO<number> {
    return this.ref.updateAndGet((n) => n + 1);
  }

  /**
   * Decrement and return the new value
   */
  decrement(): IO<number> {
    return this.ref.updateAndGet((n) => n - 1);
  }

  /**
   * Add to the counter
   */
  add(n: number): IO<number> {
    return this.ref.updateAndGet((x) => x + n);
  }

  /**
   * Reset to zero
   */
  reset(): IO<void> {
    return this.ref.set(0);
  }

  /**
   * Get and increment (post-increment)
   */
  getAndIncrement(): IO<number> {
    return this.ref.getAndUpdate((n) => n + 1);
  }

  /**
   * Create a new counter
   */
  static make(initial: number = 0): IO<Counter> {
    return IO.map(Ref.make(initial), (ref) => new Counter(ref));
  }
}

// ============================================================================
// AtomicBoolean - Another common pattern
// ============================================================================

/**
 * An atomic boolean backed by a Ref
 */
export class AtomicBoolean {
  private constructor(private readonly ref: Ref<boolean>) {}

  /**
   * Get the current value
   */
  get(): IO<boolean> {
    return this.ref.get();
  }

  /**
   * Set the value
   */
  set(value: boolean): IO<void> {
    return this.ref.set(value);
  }

  /**
   * Get and set
   */
  getAndSet(value: boolean): IO<boolean> {
    return this.ref.getAndSet(value);
  }

  /**
   * Toggle the value
   */
  toggle(): IO<boolean> {
    return this.ref.updateAndGet((b) => !b);
  }

  /**
   * Compare and set - only set if current value matches expected
   */
  compareAndSet(expected: boolean, newValue: boolean): IO<boolean> {
    return this.ref.modify((current) => {
      if (current === expected) {
        return [true, newValue];
      }
      return [false, current];
    });
  }

  /**
   * Create a new atomic boolean
   */
  static make(initial: boolean = false): IO<AtomicBoolean> {
    return IO.map(Ref.make(initial), (ref) => new AtomicBoolean(ref));
  }
}

// ============================================================================
// Semaphore - Concurrency primitive
// ============================================================================

/**
 * A simple semaphore for limiting concurrent access
 */
export class Semaphore {
  private constructor(
    private readonly permits: Ref<number>,
    private readonly maxPermits: number,
  ) {}

  /**
   * Acquire a permit
   */
  acquire(): IO<void> {
    return IO.flatMap(this.permits.get(), (n) => {
      if (n > 0) {
        return this.permits.update((x) => x - 1);
      }
      // Wait and retry
      return IO.flatMap(IO.sleep(10), () => this.acquire());
    });
  }

  /**
   * Release a permit
   */
  release(): IO<void> {
    return this.permits.update((n) => Math.min(n + 1, this.maxPermits));
  }

  /**
   * Run an action with a permit
   */
  withPermit<A>(fa: IO<A>): IO<A> {
    return IO.bracket(
      this.acquire(),
      () => fa,
      () => this.release(),
    );
  }

  /**
   * Get available permits
   */
  available(): IO<number> {
    return this.permits.get();
  }

  /**
   * Create a new semaphore
   */
  static make(permits: number): IO<Semaphore> {
    return IO.map(Ref.make(permits), (ref) => new Semaphore(ref, permits));
  }
}

// ============================================================================
// Queue - Producer-consumer pattern
// ============================================================================

/**
 * A simple unbounded queue
 */
export class Queue<A> {
  private constructor(private readonly ref: Ref<A[]>) {}

  /**
   * Offer an element to the queue
   */
  offer(a: A): IO<void> {
    return this.ref.update((arr) => [...arr, a]);
  }

  /**
   * Offer multiple elements
   */
  offerAll(as: A[]): IO<void> {
    return this.ref.update((arr) => [...arr, ...as]);
  }

  /**
   * Take an element from the queue (waits if empty)
   */
  take(): IO<A> {
    return IO.flatMap(this.ref.get(), (arr) => {
      if (arr.length > 0) {
        return this.ref.modify((current) => {
          if (current.length > 0) {
            const [head, ...tail] = current;
            return [head, tail];
          }
          // Race condition - retry
          throw new Error("Queue empty on take");
        });
      }
      // Wait and retry
      return IO.flatMap(IO.sleep(10), () => this.take());
    });
  }

  /**
   * Try to take an element (returns None if empty)
   */
  tryTake(): IO<Option<A>> {
    return this.ref.modify((arr) => {
      if (arr.length > 0) {
        const [head, ...tail] = arr;
        return [Some(head), tail];
      }
      return [None as Option<A>, arr];
    });
  }

  /**
   * Peek at the head (doesn't remove)
   */
  peek(): IO<Option<A>> {
    return IO.map(this.ref.get(), (arr) =>
      arr.length > 0 ? Some(arr[0]) : None,
    );
  }

  /**
   * Get the size
   */
  size(): IO<number> {
    return IO.map(this.ref.get(), (arr) => arr.length);
  }

  /**
   * Check if empty
   */
  isEmpty(): IO<boolean> {
    return IO.map(this.ref.get(), (arr) => arr.length === 0);
  }

  /**
   * Take all elements
   */
  takeAll(): IO<A[]> {
    return this.ref.getAndSet([]);
  }

  /**
   * Create a new queue
   */
  static make<A>(): IO<Queue<A>> {
    return IO.map(Ref.make<A[]>([]), (ref) => new Queue(ref));
  }

  /**
   * Create a queue with initial elements
   */
  static of<A>(...elements: A[]): IO<Queue<A>> {
    return IO.map(Ref.make<A[]>(elements), (ref) => new Queue(ref));
  }
}
