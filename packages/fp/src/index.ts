/**
 * @typesugar/fp — Functional Programming for TypeScript
 *
 * A complete functional programming system inspired by Scala's Cats library.
 *
 * Features:
 * - Complete typeclass hierarchy (Functor, Monad, Applicative, etc.)
 * - Core data types (Option, Either, List, Validated)
 * - Monad transformers (State, Reader, Writer)
 * - IO monad with stack-safe interpreter
 * - IO runtime utilities (Ref, Deferred, Resource)
 * - Do-comprehension support
 * - Pipe/flow composition helpers
 *
 * @example
 * ```typescript
 * import {
 *   Option, Some, None,
 *   Either, Left, Right,
 *   IO, runIO,
 *   pipe, flow
 * } from '@typesugar/fp';
 *
 * // Option example
 * const result = Option.flatMap(Some(2), x => Some(x * 3));
 *
 * // Either example
 * const validated = Either.map(Right(42), x => x.toString());
 *
 * // IO example
 * const program = IO.flatMap(
 *   IO.delay(() => "Hello"),
 *   msg => IO.delay(() => console.log(msg))
 * );
 * await runIO(program);
 *
 * // Pipe example
 * const transformed = pipe(
 *   5,
 *   x => x * 2,
 *   x => x + 1,
 *   x => x.toString()
 * );
 * ```
 */

// ============================================================================
// HKT Foundation - export core types directly
// ============================================================================

export {
  type $,
  type Kind,
  unsafeCoerce,
  // Type-level functions for data types
  type OptionF,
  type EitherF,
  type ListF,
  type NonEmptyListF,
  type ValidatedF,
  type StateF,
  type ReaderF,
  type WriterF,
  type IOF,
  type IdF,
  type ResourceF,
  // Re-exported interface types (for structural typing)
  type Resource,
} from "./hkt.js";

// ============================================================================
// Typeclasses - namespace export to avoid collisions
// ============================================================================

export * as TC from "./typeclasses/index.js";
// Also export commonly used typeclass interfaces directly
export type {
  Functor,
  Apply,
  Applicative,
  FlatMap,
  Monad,
  Foldable,
  Traverse,
  SemigroupK,
  MonoidK,
  Alternative,
  Semigroup,
  Monoid,
  Eq,
  Ord,
  Show,
  ApplicativeError,
  MonadError,
  Semigroupal,
} from "./typeclasses/index.js";

// ============================================================================
// Data Types - namespace export to avoid collisions
// ============================================================================

export * as Option from "./data/option.js";
export * as Either from "./data/either.js";
export * as List from "./data/list.js";
export * as NonEmptyList from "./data/nonempty-list.js";
export * as Validated from "./data/validated.js";
export * as State from "./data/state.js";
export * as Reader from "./data/reader.js";
export * as Writer from "./data/writer.js";
export * as Id from "./data/id.js";

// ============================================================================
// IO & Runtime - namespace export to avoid collisions
// ============================================================================

export * as IO from "./io/io.js";
export { runIO, runIOSync, IODo } from "./io/io.js";
export * as Ref from "./io/ref.js";
export * as Deferred from "./io/deferred.js";
export * as ResourceIO from "./io/resource.js";
export * as Console from "./io/console.js";
export * as IOApp from "./io/io-app.js";

// ============================================================================
// Syntax Utilities
// ============================================================================

export * from "./syntax/index.js";

// ============================================================================
// Zero-Cost Abstractions (compile-time-optimized versions)
// ============================================================================

export * as ZeroCost from "./zero-cost/index.js";

// ============================================================================
// @typesugar/std FlatMap Bridge
// ============================================================================
// FlatMap instances compatible with @typesugar/std's FlatMap typeclass.
// Use registerFpFlatMapInstances() to register with @typesugar/std.

export {
  flatMapOption,
  flatMapEither,
  flatMapIO,
  flatMapList,
  flatMapValidated,
  fpFlatMapInstances,
  registerFpFlatMapInstances,
  // @implicits example functions
  traverseArray,
  sequenceArray,
  fmap,
  bind,
  applyF,
  foldL,
} from "./instances.js";
export {
  type ZeroCostOption,
  ZeroCostOptionOps,
  type ZeroCostResult,
  type ZeroCostOk,
  type ZeroCostErr,
  ZeroCostResultOps,
} from "./zero-cost/index.js";

// ============================================================================
// Re-export commonly used constructors directly for convenience
// ============================================================================

// From data/index.js (namespace exports handle the operations)
export {
  // Option constructors
  Some,
  None,
  isSome,
  isNone,
  type OptionType,
  // Either constructors
  Left,
  Right,
  isLeft,
  isRight,
  type EitherType,
  // List constructors
  Cons,
  Nil,
  type ListType,
  // NonEmptyList
  type NonEmptyListType,
  // Validated constructors
  Valid,
  Invalid,
  valid,
  invalid,
  validNel,
  invalidNel,
  isValid,
  isInvalid,
  type ValidatedType,
  type ValidatedNel,
  // Monad transformers
  IndexedState,
  type StateType,
  Kleisli,
  type ReaderType,
  LogWriter,
  LogWriterMonoid,
  SumWriter,
  SumWriterMonoid,
  type WriterType,
  type IdType,
} from "./data/index.js";

// ============================================================================
// Typeclass Laws (for verification and property testing)
// ============================================================================

export * as Laws from "./laws/index.js";
export type {
  Law,
  LawSet,
  LawGenerator,
  ProofHint,
  EqF,
  Arbitrary,
  LawVerificationResult,
  VerifyLawsOptions,
} from "./laws/index.js";
export {
  // Value-level typeclass laws
  eqLaws,
  ordLaws,
  semigroupLaws,
  monoidLaws,
  showLaws,
  showLawsWithEq,
  // HKT typeclass laws
  functorLaws,
  functorCompositionLaws,
  applyLaws,
  applicativeLaws,
  flatMapLaws,
  monadLaws,
  monadStackSafetyLaws,
  foldableLaws,
  foldableOrderLaws,
  traverseLaws,
  traverseLawsWithApplicative,
  sequenceLaws,
  semigroupKLaws,
  monoidKLaws,
  alternativeLaws,
  alternativeLawsNonDistributive,
} from "./laws/index.js";
