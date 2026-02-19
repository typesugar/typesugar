/**
 * Typeclasses — Scala Cats-inspired typeclass hierarchy
 *
 * This module exports all typeclasses and their derived operations.
 * Each typeclass module is exported as a namespace to avoid name collisions,
 * with commonly-used type interfaces also exported directly for convenience.
 */

// Functor hierarchy
export * as FunctorOps from "./functor.js";
export type { Functor } from "./functor.js";

export * as ApplicativeOps from "./applicative.js";
export type { Apply, Applicative } from "./applicative.js";

export * as MonadOps from "./monad.js";
export type { FlatMap, Monad } from "./monad.js";

export * as MonadErrorOps from "./monad-error.js";
export type { ApplicativeError, MonadError } from "./monad-error.js";

// Foldable/Traverse
export * as FoldableOps from "./foldable.js";
export type { Foldable } from "./foldable.js";

export * as TraverseOps from "./traverse.js";
export type { Traverse } from "./traverse.js";

// Algebraic structures
export * as SemigroupOps from "./semigroup.js";
export type { Semigroup, Monoid } from "./semigroup.js";

export * as EqOps from "./eq.js";
export type { Eq, Ord, Ordering } from "./eq.js";

export * as ShowOps from "./show.js";
export type { Show } from "./show.js";

// Semigroupal and Bifunctor
export * as SemigroupalOps from "./semigroupal.js";
export type { Semigroupal } from "./semigroupal.js";

// Alternative
export * as AlternativeOps from "./alternative.js";
export type { SemigroupK, MonoidK, Alternative } from "./alternative.js";
