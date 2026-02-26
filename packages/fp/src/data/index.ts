/**
 * Data Types Index
 *
 * Re-exports all data types for the @typesugar/fp system.
 *
 * Clean API design:
 * - Type: `Option<A>`, `Either<E, A>`, etc.
 * - Operations: `Option.map(...)`, `Either.flatMap(...)`, etc.
 * - Constructors: `Some(...)`, `None`, `Left(...)`, `Right(...)`, etc.
 */

// ============================================================================
// Option — Zero-cost optional values (null-based)
// ============================================================================

// Option is both a type (Option<A> = A | null) and a namespace object
export {
  Option,
  Some,
  None,
  isSome,
  isNone,
  defined,
  unwrapDefined,
} from "./option.js";
export type { Defined } from "./option.js";

// ============================================================================
// Either — Typed error handling
// ============================================================================

export { Either, Left, Right, isLeft, isRight } from "./either.js";

// ============================================================================
// List — Persistent linked list
// ============================================================================

export { List, Cons, Nil, isCons, isNil } from "./list.js";

// ============================================================================
// NonEmptyList — List with at least one element
// ============================================================================

// Type: NonEmptyList<A>
// Namespace: NEL.of(), NEL.map(), NEL.cons()
export type { NonEmptyList } from "./nonempty-list.js";
export { NEL } from "./nonempty-list.js";

// ============================================================================
// Validated — Error accumulation
// ============================================================================

export {
  Validated,
  Valid,
  Invalid,
  valid,
  invalid,
  validNel,
  invalidNel,
  isValid,
  isInvalid,
} from "./validated.js";
export type { ValidatedNel } from "./validated.js";

// ============================================================================
// State — Stateful computation
// ============================================================================

export { State, IndexedState } from "./state.js";

// ============================================================================
// Reader — Environment/dependency injection
// ============================================================================

export { Reader, Kleisli } from "./reader.js";

// ============================================================================
// Writer — Logging/accumulation
// ============================================================================

export {
  Writer,
  LogWriter,
  LogWriterMonoid,
  SumWriter,
  SumWriterMonoid,
  ProductWriter,
  ProductWriterMonoid,
} from "./writer.js";

// ============================================================================
// Id — Identity functor
// ============================================================================

// Id is a class (both type and constructor)
export { Id } from "./id.js";
