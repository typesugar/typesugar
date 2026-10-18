/**
 * Zero-Cost Result<T, E> - a plain `{ ok, value } | { ok, error }` union.
 *
 * Runtime-only module (no `typescript` / `@typesugar/core` imports); the
 * inlining macro lives in `@typesugar/fp/macros`.
 */

// ============================================================================
// Type-Level API
// ============================================================================

export interface ZeroCostOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ZeroCostErr<E> {
  readonly ok: false;
  readonly error: E;
}

export type ZeroCostResult<T, E> = ZeroCostOk<T> | ZeroCostErr<E>;

export const ZeroCostResultOps = {
  ok<T>(value: T): ZeroCostResult<T, never> {
    return { ok: true, value };
  },
  err<E>(error: E): ZeroCostResult<never, E> {
    return { ok: false, error };
  },
  try<T>(fn: () => T): ZeroCostResult<T, Error> {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
    }
  },
  isOk<T, E>(result: ZeroCostResult<T, E>): result is ZeroCostOk<T> {
    return result.ok;
  },
  isErr<T, E>(result: ZeroCostResult<T, E>): result is ZeroCostErr<E> {
    return !result.ok;
  },
} as const;
