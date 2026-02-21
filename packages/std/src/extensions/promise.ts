/**
 * Promise & Async Extension Methods
 *
 * The best from:
 * - Bluebird (tap, timeout, delay, retry, map, filter, reduce, props, settle)
 * - p-* ecosystem (p-retry, p-timeout, p-map, p-limit, p-settle, p-queue)
 * - Scala Future (recover, recoverWith, fallbackTo, andThen, transform)
 * - Kotlin coroutines (withTimeout, withTimeoutOrNull, async, supervisorScope)
 * - Most-requested JS/TS: retry, timeout, delay, tap, allSettled helpers, debounce async
 */

// ============================================================================
// Timing
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(message ?? `Promise timed out after ${ms}ms`);
    }),
  ]);
}

export function timeoutOr<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, delay(ms).then(() => fallback)]);
}

// ============================================================================
// Retry (p-retry pattern)
// ============================================================================

export interface RetryOptions {
  retries: number;
  delay?: number;
  backoff?: "linear" | "exponential";
  maxDelay?: number;
  onRetry?: (error: Error, attempt: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    retries,
    delay: baseDelay = 0,
    backoff = "linear",
    maxDelay = 30_000,
    onRetry,
    shouldRetry,
  } = options;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (shouldRetry && !shouldRetry(lastError)) throw lastError;
      if (attempt < retries) {
        onRetry?.(lastError, attempt + 1);
        if (baseDelay > 0) {
          const d =
            backoff === "exponential"
              ? Math.min(baseDelay * 2 ** attempt, maxDelay)
              : Math.min(baseDelay * (attempt + 1), maxDelay);
          await delay(d);
        }
      }
    }
  }
  throw lastError;
}

// ============================================================================
// Tap & Transform (Bluebird tap, Scala Future andThen/transform)
// ============================================================================

export async function tap<T>(
  promise: Promise<T>,
  fn: (value: T) => void | Promise<void>
): Promise<T> {
  const value = await promise;
  await fn(value);
  return value;
}

export async function tapError<T>(
  promise: Promise<T>,
  fn: (error: Error) => void | Promise<void>
): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    await fn(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

export async function recover<T>(
  promise: Promise<T>,
  fn: (error: Error) => T | Promise<T>
): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    return fn(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function fallbackTo<T>(promise: Promise<T>, fallback: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Concurrency Control (p-map, p-limit patterns)
// ============================================================================

export async function mapConcurrent<A, B>(
  items: readonly A[],
  fn: (item: A, index: number) => Promise<B>,
  concurrency: number = Infinity
): Promise<B[]> {
  if (concurrency === Infinity) {
    return Promise.all(items.map(fn));
  }

  const results: B[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function filterConcurrent<A>(
  items: readonly A[],
  pred: (item: A, index: number) => Promise<boolean>,
  concurrency: number = Infinity
): Promise<A[]> {
  const results = await mapConcurrent(items, pred, concurrency);
  return items.filter((_, i) => results[i]);
}

// ============================================================================
// Settlement (allSettled helpers)
// ============================================================================

export interface SettledResult<T> {
  status: "fulfilled" | "rejected";
  value?: T;
  reason?: Error;
}

export async function settle<T>(promises: readonly Promise<T>[]): Promise<SettledResult<T>[]> {
  return Promise.all(
    promises.map((p) =>
      p
        .then((value): SettledResult<T> => ({ status: "fulfilled", value }))
        .catch(
          (reason): SettledResult<T> => ({
            status: "rejected",
            reason: reason instanceof Error ? reason : new Error(String(reason)),
          })
        )
    )
  );
}

export async function allFulfilled<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const results = await settle(promises);
  return results
    .filter(
      (r): r is SettledResult<T> & { status: "fulfilled"; value: T } => r.status === "fulfilled"
    )
    .map((r) => r.value);
}

export async function props<T extends Record<string, Promise<unknown>>>(
  obj: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(obj) as (keyof T)[];
  const values = await Promise.all(keys.map((k) => obj[k]));
  const result = {} as { [K in keyof T]: Awaited<T[K]> };
  keys.forEach((k, i) => {
    result[k] = values[i] as Awaited<T[typeof k]>;
  });
  return result;
}

// ============================================================================
// Utilities
// ============================================================================

export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function sleep(ms: number): Promise<void> {
  return delay(ms);
}

export function lazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (!cached) cached = fn();
    return cached;
  };
}

export function memo<A extends string | number, T>(
  fn: (arg: A) => Promise<T>
): (arg: A) => Promise<T> {
  const cache = new Map<A, Promise<T>>();
  return (arg: A) => {
    if (!cache.has(arg)) cache.set(arg, fn(arg));
    return cache.get(arg)!;
  };
}

// ============================================================================
// Aggregate
// ============================================================================

export const PromiseExt = {
  delay,
  timeout,
  timeoutOr,
  retry,
  tap,
  tapError,
  recover,
  fallbackTo,
  mapConcurrent,
  filterConcurrent,
  settle,
  allFulfilled,
  props,
  createDeferred,
  sleep,
  lazy,
  memo,
} as const;
