/**
 * Resource - Safe resource acquisition and release
 *
 * Resource<A> represents a resource that can be acquired and must be released.
 * It ensures resources are always released, even when errors occur.
 *
 * Inspired by Scala's Cats Effect Resource
 */

import { IO, runIO } from "./io";

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
  constructor(
    private readonly _acquire: IO<A>,
    private readonly _release: (a: A) => IO<void>,
  ) {}

  /**
   * Use the resource with a function
   */
  use<B>(f: (a: A) => IO<B>): IO<B> {
    return IO.bracket(this._acquire, f, this._release);
  }

  /**
   * Map over the resource value
   */
  map<B>(f: (a: A) => B): Resource<B> {
    return new Resource(
      IO.map(this._acquire, f),
      () => IO.unit, // The original release will still run
    ).combineWith(this, (b, _a) => b);
  }

  /**
   * FlatMap - sequence resource acquisition
   */
  flatMap<B>(f: (a: A) => Resource<B>): Resource<B> {
    return Resource.make(
      IO.flatMap(this._acquire, (a) =>
        IO.map(f(a)._acquire, (b) => [a, b] as const),
      ),
      ([a, b]) => {
        // Release in reverse order (b first, then a)
        const rb = f(a);
        return IO.flatMap(rb._release(b), () => this._release(a));
      },
    ).map(([_a, b]) => b);
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
   * Add a finalizer that always runs
   */
  onFinalize(finalizer: IO<void>): Resource<A> {
    return new Resource(this._acquire, (a) =>
      IO.guarantee(this._release(a), finalizer),
    );
  }

  /**
   * Evaluate the resource, returning the value
   * Note: This doesn't release the resource!
   */
  evalTap(f: (a: A) => IO<void>): Resource<A> {
    return new Resource(
      IO.flatMap(this._acquire, (a) => IO.as(f(a), a)),
      this._release,
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
  export function make<A>(
    acquire: IO<A>,
    release: (a: A) => IO<void>,
  ): Resource<A> {
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
  export function traverse<A, B>(
    arr: A[],
    f: (a: A) => Resource<B>,
  ): Resource<B[]> {
    return arr.reduce<Resource<B[]>>(
      (acc, a) => acc.flatMap((bs) => f(a).map((b) => [...bs, b])),
      pure([] as B[]),
    );
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
  export function both<A, B>(
    ra: Resource<A>,
    rb: Resource<B>,
  ): Resource<[A, B]> {
    return ra.product(rb);
  }

  /**
   * Map2 - combine two resources
   */
  export function map2<A, B, C>(
    ra: Resource<A>,
    rb: Resource<B>,
    f: (a: A, b: B) => C,
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
export function fileResource(
  path: string,
  mode: "r" | "w" | "a" = "r",
): Resource<FileHandle> {
  return Resource.make(
    IO.delay(() => {
      // This is a mock - in real code you'd use fs.promises.open
      return new FileHandle(path, mode);
    }),
    (handle) =>
      IO.delay(() => {
        handle.close();
      }),
  );
}

/**
 * Mock file handle for demonstration
 */
export class FileHandle {
  private _closed = false;

  constructor(
    public readonly path: string,
    public readonly mode: string,
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
export function timerResource(
  intervalMs: number,
): Resource<NodeJS.Timer | number> {
  return Resource.make(
    IO.delay(
      () =>
        setInterval(() => {
          /* tick */
        }, intervalMs) as NodeJS.Timer | number,
    ),
    (timer) => IO.delay(() => clearInterval(timer as NodeJS.Timeout)),
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
  handler: (e: E) => void,
): Resource<void> {
  return Resource.make(
    IO.delay(() => {
      element.addEventListener(eventType, handler);
    }),
    () =>
      IO.delay(() => {
        element.removeEventListener(eventType, handler);
      }),
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

  constructor(
    private readonly create: IO<A>,
    private readonly destroy: (a: A) => IO<void>,
    private readonly maxSize: number,
  ) {}

  /**
   * Borrow a resource from the pool
   */
  borrow(): Resource<A> {
    return Resource.make(
      IO.async<A>((cb) => {
        if (this.pool.length > 0) {
          const resource = this.pool.pop()!;
          cb({ _tag: "Right", right: resource });
        } else if (this.pool.length < this.maxSize) {
          runIO(this.create)
            .then((a) => cb({ _tag: "Right", right: a }))
            .catch((e) => cb({ _tag: "Left", left: e }));
        } else {
          this.waiters.push((a) => cb({ _tag: "Right", right: a }));
        }
      }),
      (a) => this.release(a),
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
   * Drain the pool
   */
  drain(): IO<void> {
    return IO.void_(IO.traverse(this.pool, (a) => this.destroy(a)));
  }
}

/**
 * Create a Resource pool
 */
export function pool<A>(
  create: IO<A>,
  destroy: (a: A) => IO<void>,
  maxSize: number,
): Resource<ResourcePool<A>> {
  return Resource.make(
    IO.pure(new ResourcePool(create, destroy, maxSize)),
    (p) => p.drain(),
  );
}
