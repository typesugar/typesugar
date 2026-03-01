/**
 * Concrete instances - no typeclasses, just specialized functions
 *
 * This is what typesugar's @specialize or auto-specialization produces:
 * Direct function implementations without typeclass indirection.
 */

import type { Option, Either } from "./types";
import { Some, None, Left, Right } from "./types";

// ============================================================================
// Option operations (specialized)
// ============================================================================

export function optionMap<A, B>(fa: Option<A>, f: (a: A) => B): Option<B> {
  return fa._tag === "Some" ? Some(f(fa.value)) : None;
}

export function optionFlatMap<A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return fa._tag === "Some" ? f(fa.value) : None;
}

export function optionPure<A>(a: A): Option<A> {
  return Some(a);
}

export function optionAp<A, B>(fab: Option<(a: A) => B>, fa: Option<A>): Option<B> {
  return fab._tag === "Some" && fa._tag === "Some" ? Some(fab.value(fa.value)) : None;
}

// ============================================================================
// Array operations (specialized)
// ============================================================================

export function arrayMap<A, B>(fa: A[], f: (a: A) => B): B[] {
  return fa.map(f);
}

export function arrayFlatMap<A, B>(fa: A[], f: (a: A) => B[]): B[] {
  return fa.flatMap(f);
}

export function arrayPure<A>(a: A): A[] {
  return [a];
}

export function arrayAp<A, B>(fab: ((a: A) => B)[], fa: A[]): B[] {
  return fab.flatMap((f) => fa.map(f));
}

// ============================================================================
// Either operations (specialized)
// ============================================================================

export function eitherMap<E, A, B>(fa: Either<E, A>, f: (a: A) => B): Either<E, B> {
  return fa._tag === "Right" ? Right(f(fa.right)) : fa;
}

export function eitherFlatMap<E, A, B>(fa: Either<E, A>, f: (a: A) => Either<E, B>): Either<E, B> {
  return fa._tag === "Right" ? f(fa.right) : fa;
}

export function eitherPure<A>(a: A): Either<never, A> {
  return Right(a);
}

export function eitherAp<E, A, B>(fab: Either<E, (a: A) => B>, fa: Either<E, A>): Either<E, B> {
  return fab._tag === "Right" && fa._tag === "Right"
    ? Right(fab.right(fa.right))
    : fab._tag === "Left"
      ? fab
      : (fa as Either<E, B>);
}
