/**
 * Resource - Safe resource acquisition and release
 *
 * Resource<A> represents a resource that can be acquired and must be released.
 * It ensures resources are always released, even when errors occur.
 *
 * Inspired by Scala's Cats Effect Resource
 */

import { IO, runIO } from "./io.js";
import { Left, Right } from "../data/either.js";

// ============================================================================
// Resource Type
// ============================================================================

/**
 * Resource represents a value that requires cleanup
 *
 * The key property is that when you combine Resources, the cleanup
 * actions are composed in reverse order (last acquired, first released).
 */
export class Resource<A> {
  /**
   * @internal Acquire the value together with its (already bound) finalizer.
   * Composed resources capture their finalizer chain at acquire time, so
   * `f` in `flatMap` runs exactly once and nothing is acquired twice.
   */
  readonly allocated: IO<readonly [A, IO<void>]>;

  constructor(acquire: IO<A>, release: (a: A) => IO<void>) {
    this.allocated = IO.map(acquire, (a) => [a, IO.suspend(() => release(a))] as const);
  }

  private static fromAllocated<A>(allocated: IO<readonly [A, IO<void>]>): Resource<A> {
    const r = Object.create(Resource.prototype) as { allocated: IO<readonly [A, IO<void>]> };
    r.allocated = allocated;
    return r as Resource<A>;
  }

  /**
   * Use the resource with a function
   */
  use<B>(f: (a: A) => IO<B>): IO<B> {
    return IO.bracket(
      this.allocated,
      ([a]) => IO.suspend(() => f(a)),
      ([, release]) => release
    );
  }

  /**
   * Map over the resource value (acquires once, releases the original value)
   */
  map<B>(f: (a: A) => B): Resource<B> {
    return Resource.fromAllocated(
      IO.flatMap(this.allocated, ([a, release]) =>
        IO.onError(
          IO.delay(() => [f(a), release] as const),
          () => release
        )
      )
    );
  }

  /**
   * FlatMap - sequence resource acquisition. Releases inner then outer; the
   * outer is released if acquiring the inner fails.
   */
  flatMap<B>(f: (a: A) => Resource<B>): Resource<B> {
    return Resource.fromAllocated(
      IO.flatMap(this.allocated, ([a, releaseA]) =>
        IO.onError(
          IO.map(
            IO.suspend(() => f(a).allocated),
            ([b, releaseB]) => [b, IO.guarantee(releaseB, releaseA)] as const
          ),
          () => releaseA
        )
      )
    );
  }

  /**
   * Combine two resources
   */
  product<B>(rb: Resource<B>): Resource<[A, B]> {
    return this.flatMap((a) => rb.map((b) => [a, b] as [A, B]));
  }

  /**
   * Combine this resource with another using a function
   */
  combineWith<B, C>(rb: Resource<B>, f: (a: A, b: B) => C): Resource<C> {
    return this.flatMap((a) => rb.map((b) => f(a, b)));
  }

  /**
   * Add a finalizer that always runs (after this resource's own release)
   */
  onFinalize(finalizer: IO<void>): Resource<A> {
    return Resource.fromAllocated(
      IO.map(this.allocated, ([a, release]) => [a, IO.guarantee(release, finalizer)] as const)
    );
  }

  /**
   * Run an effect on the acquired value (the resource is still released after use)
   */
  evalTap(f: (a: A) => IO<void>): Resource<A> {
    return Resource.fromAllocated(
      IO.flatMap(this.allocated, (pair) =>
        IO.onError(
          IO.as(
            IO.suspend(() => f(pair[0])),
            pair
          ),
          () => pair[1]
        )
      )
    );
  }

  /**
   * Alias for use with a function that returns void
   */
  useForever(): IO<never> {
    return this.use(() => IO.never);
  }
}

// ============================================================================
// Resource Constructors
// ============================================================================

export namespace Resource {
  /**
   * Create a Resource from acquire and release
   */
  export function make<A>(acquire: IO<A>, release: (a: A) => IO<void>): Resource<A> {
    return new Resource(acquire, release);
  }

  /**
   * Create a Resource that doesn't need cleanup
   */
  export function pure<A>(a: A): Resource<A> {
    return new Resource(IO.pure(a), () => IO.unit);
  }

  /**
   * Create a Resource from an IO that doesn't need cleanup
   */
  export function eval_<A>(fa: IO<A>): Resource<A> {
    return new Resource(fa, () => IO.unit);
  }

  /**
   * Lift an IO into Resource
   */
  export function liftIO<A>(fa: IO<A>): Resource<A> {
    return eval_(fa);
  }

  /**
   * Create a Resource with only a finalizer (no value)
   */
  export function onFinalize(finalizer: IO<void>): Resource<void> {
    return make(IO.unit, () => finalizer);
  }

  /**
   * Traverse with Resource
   */
  export function traverse<A, B>(arr: A[], f: (a: A) => Resource<B>): Resource<B[]> {
    // Accumulate into an immutable cons list (O(1) per step), convert once.
    type Cons = { readonly head: B; readonly tail: Cons } | null;
    const toArray = (c: Cons): B[] => {
      const out: B[] = [];
      for (let x = c; x !== null; x = x.tail) out.push(x.head);
      return out.reverse();
    };
    const go = (i: number, acc: Cons): Resource<B[]> =>
      i >= arr.length
        ? pure(toArray(acc))
        : f(arr[i]).flatMap((b) => go(i + 1, { head: b, tail: acc }));
    return go(0, null);
  }

  /**
   * Sequence Resources
   */
  export function sequence<A>(resources: Resource<A>[]): Resource<A[]> {
    return traverse(resources, (r) => r);
  }

  /**
   * Both - acquire both resources in parallel (simplified - actually sequential)
   */
  export function both<A, B>(ra: Resource<A>, rb: Resource<B>): Resource<[A, B]> {
    return ra.product(rb);
  }

  /**
   * Map2 - combine two resources
   */
  export function map2<A, B, C>(
    ra: Resource<A>,
    rb: Resource<B>,
    f: (a: A, b: B) => C
  ): Resource<C> {
    return ra.combineWith(rb, f);
  }

  /**
   * Flatten nested Resource
   */
  export function flatten<A>(rra: Resource<Resource<A>>): Resource<A> {
    return rra.flatMap((ra) => ra);
  }
}

// ============================================================================
// Common Resources
// ============================================================================

/**
 * Create a file resource (conceptual - needs actual filesystem access)
 */
export function fileResource(path: string, mode: "r" | "w" | "a" = "r"): Resource<FileHandle> {
  return Resource.make(
    IO.delay(() => {
      // This is a mock - in real code you'd use fs.promises.open
      return new FileHandle(path, mode);
    }),
    (handle) =>
      IO.delay(() => {
        handle.close();
      })
  );
}

/**
 * Mock file handle for demonstration
 */
export class FileHandle {
  private _closed = false;

  constructor(
    public readonly path: string,
    public readonly mode: string
  ) {}

  read(): IO<string> {
    return IO.delay(() => {
      if (this._closed) throw new Error("File handle is closed");
      return `Contents of ${this.path}`;
    });
  }

  write(content: string): IO<void> {
    return IO.delay(() => {
      if (this._closed) throw new Error("File handle is closed");
      console.log(`Writing to ${this.path}: ${content}`);
    });
  }

  close(): void {
    this._closed = true;
  }
}

/**
 * Timer resource - will cancel on release
 */
export function timerResource(intervalMs: number): Resource<ReturnType<typeof setInterval>> {
  // Use ReturnType<typeof setInterval> rather than NodeJS.Timer so the public
  // .d.ts doesn't leak the Node-only `NodeJS` namespace (it resolves to `number`
  // in the browser and `NodeJS.Timeout` under @types/node — no global dependency).
  return Resource.make(
    IO.delay(() =>
      setInterval(() => {
        /* tick */
      }, intervalMs)
    ),
    (timer) => IO.delay(() => clearInterval(timer))
  );
}

/**
 * Event listener resource - manages adding/removing event listeners
 * Works with any event target (DOM elements, EventEmitter, etc.)
 */
export function eventListenerResource<E>(
  element: {
    addEventListener: (type: string, handler: (e: E) => void) => void;
    removeEventListener: (type: string, handler: (e: E) => void) => void;
  },
  eventType: string,
  handler: (e: E) => void
): Resource<void> {
  return Resource.make(
    IO.delay(() => {
      element.addEventListener(eventType, handler);
    }),
    () =>
      IO.delay(() => {
        element.removeEventListener(eventType, handler);
      })
  );
}

// ============================================================================
// Resource Pool
// ============================================================================

/**
 * A pool of resources that can be borrowed and returned
 */
export class ResourcePool<A> {
  private pool: A[] = [];
  private waiters: ((a: A) => void)[] = [];
  /** Resources created and not yet destroyed (idle + borrowed). */
  private created = 0;

  constructor(
    private readonly create: IO<A>,
    private readonly destroy: (a: A) => IO<void>,
    private readonly maxSize: number
  ) {}

  /**
   * Borrow a resource from the pool. Creates a new one only while fewer than
   * `maxSize` exist in total; otherwise waits for one to be returned.
   */
  borrow(): Resource<A> {
    return Resource.make(
      IO.async<A>((cb) => {
        if (this.pool.length > 0) {
          cb(Right(this.pool.pop()!));
        } else if (this.created < this.maxSize) {
          this.created++;
          runIO(this.create).then(
            (a) => cb(Right(a)),
            (e) => {
              this.created--;
              cb(Left(e instanceof Error ? e : new Error(String(e))));
            }
          );
        } else {
          this.waiters.push((a) => cb(Right(a)));
        }
      }),
      (a) => this.release(a)
    );
  }

  /**
   * Release a resource back to the pool
   */
  private release(a: A): IO<void> {
    return IO.delay(() => {
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        waiter(a);
      } else {
        this.pool.push(a);
      }
    });
  }

  /**
   * Drain the pool: destroy every idle resource (each exactly once) and
   * remove it from the pool. Borrowed resources are returned normally.
   */
  drain(): IO<void> {
    return IO.suspend(() => {
      const idle = this.pool.splice(0, this.pool.length);
      this.created -= idle.length;
      return IO.void_(IO.traverse(idle, (a) => this.destroy(a)));
    });
  }
}

/**
 * Create a Resource pool
 */
export function pool<A>(
  create: IO<A>,
  destroy: (a: A) => IO<void>,
  maxSize: number
): Resource<ResourcePool<A>> {
  return Resource.make(IO.pure(new ResourcePool(create, destroy, maxSize)), (p) => p.drain());
}
