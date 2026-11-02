/**
 * Type-level arithmetic — declarations for the build-time type macros.
 *
 * The `Mul`, `Div`, `Pow`, `Lt`, ... type macros (in the `./macros` entry) are
 * scoped to `@typesugar/type-system`: they only evaluate a type reference whose
 * name is imported from this package (so a same-named type from another
 * library is never rewritten). These declarations are what that import binds
 * to. When the macro can evaluate the arguments (numeric literal types) the
 * reference is replaced by the computed literal type, e.g. `Mul<3, 4>` → `12`.
 * Otherwise it stays as written and resolves to the widened fallback below
 * (`number` / `boolean`).
 *
 * `Add`, `Sub` and `Min` are exported from `./vec` (small-number lookup-table
 * implementations that also work without the transformer).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

/** `Mul<3, 4>` → `12` */
export type Mul<A extends number, B extends number> = number;
/** `Div<7, 2>` → `3` (integer division; integer arguments only) */
export type Div<A extends number, B extends number> = number;
/** `Mod<7, 3>` → `1` (integer arguments only) */
export type Mod<A extends number, B extends number> = number;
/** `Pow<2, 10>` → `1024` */
export type Pow<Base extends number, Exp extends number> = number;
/** `Negate<5>` → `-5` */
export type Negate<A extends number> = number;
/** `Abs<-5>` → `5` */
export type Abs<A extends number> = number;
/** `Max<3, 7>` → `7` */
export type Max<A extends number, B extends number> = number;
/** `Increment<4>` → `5` */
export type Increment<A extends number> = number;
/** `Decrement<5>` → `4` */
export type Decrement<A extends number> = number;
/** `Lt<3, 5>` → `true` */
export type Lt<A extends number, B extends number> = boolean;
/** `Lte<3, 3>` → `true` */
export type Lte<A extends number, B extends number> = boolean;
/** `Gt<5, 3>` → `true` */
export type Gt<A extends number, B extends number> = boolean;
/** `Gte<5, 5>` → `true` */
export type Gte<A extends number, B extends number> = boolean;
/** `NumEq<3, 3>` → `true` */
export type NumEq<A extends number, B extends number> = boolean;
/** `IsEven<4>` → `true` (integer argument only) */
export type IsEven<A extends number> = boolean;
/** `IsOdd<3>` → `true` (integer argument only) */
export type IsOdd<A extends number> = boolean;
