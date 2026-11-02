/**
 * Derive name markers (`@derive(Eq, Ord, ...)`), from the TypeScript-free
 * `@typesugar/macros/runtime` entry so importing a marker doesn't pull the compiler
 * into application bundles.
 *
 * Each marker that derives a typeclass with an interface is ALSO that
 * typeclass as a type, so one import serves both `@derive(Clone)` and
 * `summon<Clone<Point>>()`: TypeScript keeps values and types in separate
 * namespaces, and a `const` and a type alias of the same name merge into one
 * export. The type is the typeclass's own interface (an alias to it, not a
 * copy), so `Clone<Point>` from here and from `@typesugar/std` are one type.
 * The aliases are type-only: nothing of `@typesugar/std` or `@typesugar/fp` is
 * loaded at run time. (PEP-060 item 13, smallest version: there, the marker
 * becomes the companion value of the interface in `@typesugar/std`, and these
 * stay as aliases.)
 *
 * `Default` and `TypeGuard` have no typeclass interface in any package yet
 * (`@derive(Default)` generates `{ default() }`, std's `Defaultable` is
 * `{ defaultValue() }`), so they are values only.
 */
import {
  Eq as EqMarker,
  Ord as OrdMarker,
  Clone as CloneMarker,
  Debug as DebugMarker,
  Hash as HashMarker,
  Default,
  Json as JsonMarker,
  TypeGuard,
  Show as ShowMarker,
  Semigroup as SemigroupMarker,
  Monoid as MonoidMarker,
} from "@typesugar/macros/runtime";

export { Default, TypeGuard };

/** `@derive(Eq)`, and the `Eq` typeclass (`@typesugar/std`). */
export const Eq: typeof EqMarker = EqMarker;
export type Eq<A> = import("@typesugar/std").Eq<A>;

/** `@derive(Ord)`, and the `Ord` typeclass (`@typesugar/std`). */
export const Ord: typeof OrdMarker = OrdMarker;
export type Ord<A> = import("@typesugar/std").Ord<A>;

/** `@derive(Clone)`, and the `Clone` typeclass (`@typesugar/std`). */
export const Clone: typeof CloneMarker = CloneMarker;
export type Clone<A> = import("@typesugar/std").Clone<A>;

/** `@derive(Debug)`, and the `Debug` typeclass (`@typesugar/std`). */
export const Debug: typeof DebugMarker = DebugMarker;
export type Debug<A> = import("@typesugar/std").Debug<A>;

/** `@derive(Hash)`, and the `Hash` typeclass (`@typesugar/std`). */
export const Hash: typeof HashMarker = HashMarker;
export type Hash<A> = import("@typesugar/std").Hash<A>;

/** `@derive(Json)`, and the `Json` typeclass (`@typesugar/std`). */
export const Json: typeof JsonMarker = JsonMarker;
export type Json<A> = import("@typesugar/std").Json<A>;

/** `@derive(Show)`, and the `Show` typeclass (`@typesugar/fp`). */
export const Show: typeof ShowMarker = ShowMarker;
export type Show<A> = import("@typesugar/fp").Show<A>;

/** `@derive(Semigroup)`, and the `Semigroup` typeclass (`@typesugar/std`). */
export const Semigroup: typeof SemigroupMarker = SemigroupMarker;
export type Semigroup<A> = import("@typesugar/std").Semigroup<A>;

/** `@derive(Monoid)`, and the `Monoid` typeclass (`@typesugar/std`). */
export const Monoid: typeof MonoidMarker = MonoidMarker;
export type Monoid<A> = import("@typesugar/std").Monoid<A>;
