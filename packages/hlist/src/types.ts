/**
 * @typesugar/hlist — Core Type Definitions
 *
 * Heterogeneous list types with compile-time type tracking.
 * Runtime representation is a plain array; the brand exists only in types
 * for extension method resolution.
 */

// ============================================================================
// HList Core Types
// ============================================================================

/** Brand symbol for HList type discrimination (type-only, never at runtime). */
declare const __hlist__: unique symbol;

/**
 * A heterogeneous list — a tuple whose element types are tracked individually.
 *
 * At runtime this is a plain array. The `__hlist__` brand exists only in the
 * type system so the typesugar extension method resolver can dispatch on it.
 *
 * @example
 * ```typescript
 * const list: HList<[number, string, boolean]> = hlist(1, "hello", true);
 * ```
 */
export type HList<T extends readonly unknown[] = readonly unknown[]> = T & {
  readonly [__hlist__]: true;
};

/** The empty heterogeneous list. */
export type HNil = HList<[]>;

/** Prepend element `H` onto an HList with tail types `T`. */
export type HCons<H, T extends readonly unknown[] = readonly unknown[]> =
  HList<[H, ...T]>;

// ============================================================================
// LabeledHList Types
// ============================================================================

/** A field with a compile-time label and a runtime value. */
export type LabeledField<
  Name extends string = string,
  Value = unknown,
> = readonly [Name, Value];

/** Brand symbol for LabeledHList type discrimination (type-only). */
declare const __labeled_hlist__: unique symbol;

/**
 * A heterogeneous list where each element is a labeled field.
 *
 * At runtime this is a flat array of values (labels are type-only).
 * Use `get(list, "fieldName")` for type-safe field access.
 *
 * @example
 * ```typescript
 * const rec = labeled<[LabeledField<"x", number>, LabeledField<"y", string>]>({ x: 42, y: "hi" });
 * get(rec, "x"); // 42, typed as number
 * ```
 */
export type LabeledHList<
  Fields extends readonly LabeledField[] = readonly LabeledField[],
> = {
  readonly __fields: Fields;
  readonly [__labeled_hlist__]: true;
} & unknown[];

// ============================================================================
// Type-Level Utilities — Element Access
// ============================================================================

/**
 * Extract the first element type from a tuple.
 *
 * @example
 * ```typescript
 * type H = Head<[number, string]>; // number
 * ```
 */
export type Head<T extends readonly unknown[]> = T extends readonly [
  infer H,
  ...unknown[],
]
  ? H
  : never;

/**
 * All element types except the first.
 *
 * @example
 * ```typescript
 * type T = Tail<[number, string, boolean]>; // [string, boolean]
 * ```
 */
export type Tail<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...infer Rest,
]
  ? Rest
  : [];

/**
 * Extract the last element type from a tuple.
 *
 * @example
 * ```typescript
 * type L = Last<[number, string, boolean]>; // boolean
 * ```
 */
export type Last<T extends readonly unknown[]> = T extends readonly [
  ...unknown[],
  infer L,
]
  ? L
  : never;

/**
 * All element types except the last.
 *
 * @example
 * ```typescript
 * type I = Init<[number, string, boolean]>; // [number, string]
 * ```
 */
export type Init<T extends readonly unknown[]> = T extends readonly [
  ...infer I,
  unknown,
]
  ? I
  : [];

/**
 * The literal length of a tuple type.
 *
 * @example
 * ```typescript
 * type N = Length<[number, string]>; // 2
 * ```
 */
export type Length<T extends readonly unknown[]> = T["length"];

/**
 * Element type at index `N`.
 *
 * @example
 * ```typescript
 * type E = At<[number, string, boolean], 1>; // string
 * ```
 */
export type At<T extends readonly unknown[], N extends number> = T[N];

// ============================================================================
// Type-Level Utilities — Structural Transforms
// ============================================================================

/**
 * Concatenate two tuple types.
 *
 * @example
 * ```typescript
 * type C = Concat<[number, string], [boolean]>; // [number, string, boolean]
 * ```
 */
export type Concat<
  A extends readonly unknown[],
  B extends readonly unknown[],
> = [...A, ...B];

/**
 * Reverse a tuple type.
 *
 * @example
 * ```typescript
 * type R = Reverse<[1, 2, 3]>; // [3, 2, 1]
 * ```
 */
export type Reverse<T extends readonly unknown[]> = T extends readonly [
  infer H,
  ...infer Rest,
]
  ? [...Reverse<Rest>, H]
  : [];

/**
 * Pairwise zip of two tuple types into `[A, B]` pairs.
 * Result length = min(length A, length B).
 *
 * @example
 * ```typescript
 * type Z = Zip<[1, 2], ["a", "b"]>; // [[1, "a"], [2, "b"]]
 * ```
 */
export type Zip<
  A extends readonly unknown[],
  B extends readonly unknown[],
> = A extends readonly [infer AH, ...infer AT]
  ? B extends readonly [infer BH, ...infer BT]
    ? [[AH, BH], ...Zip<AT, BT>]
    : []
  : [];

// ============================================================================
// Type-Level Utilities — Split
// ============================================================================

/**
 * Helper: build a number-to-tuple-length mapping for SplitAt.
 * Accumulates elements from T into L until L has N elements.
 */
type _SplitAtImpl<
  T extends readonly unknown[],
  N extends number,
  L extends readonly unknown[] = [],
> = L["length"] extends N
  ? [L, T]
  : T extends readonly [infer H, ...infer Rest]
    ? _SplitAtImpl<Rest, N, [...L, H]>
    : [L, []];

/**
 * Split a tuple at index `N` into `[left, right]`.
 *
 * @example
 * ```typescript
 * type S = SplitAt<[1, 2, 3, 4], 2>; // [[1, 2], [3, 4]]
 * ```
 */
export type SplitAt<
  T extends readonly unknown[],
  N extends number,
> = _SplitAtImpl<T, N>;

// ============================================================================
// Type-Level Utilities — Labeled Fields
// ============================================================================

/**
 * Extract the label (name) from a `LabeledField`.
 *
 * @example
 * ```typescript
 * type N = LabelOf<LabeledField<"x", number>>; // "x"
 * ```
 */
export type LabelOf<F> = F extends LabeledField<infer Name, unknown>
  ? Name
  : never;

/**
 * Extract the value type from a `LabeledField`.
 *
 * @example
 * ```typescript
 * type V = ValueOf<LabeledField<"x", number>>; // number
 * ```
 */
export type ValueOf<F> = F extends LabeledField<string, infer Value>
  ? Value
  : never;

/**
 * Look up a field by label name in a list of `LabeledField`s.
 *
 * @example
 * ```typescript
 * type F = FieldByName<[LabeledField<"x", number>, LabeledField<"y", string>], "y">;
 * // LabeledField<"y", string>
 * ```
 */
export type FieldByName<
  Fields extends readonly LabeledField[],
  Name extends string,
> = Fields extends readonly [infer F, ...infer Rest]
  ? F extends LabeledField<Name, infer V>
    ? LabeledField<Name, V>
    : Rest extends readonly LabeledField[]
      ? FieldByName<Rest, Name>
      : never
  : never;

/**
 * Extract the value type for a given label from a list of `LabeledField`s.
 *
 * @example
 * ```typescript
 * type V = ValueByName<[LabeledField<"x", number>, LabeledField<"y", string>], "x">;
 * // number
 * ```
 */
export type ValueByName<
  Fields extends readonly LabeledField[],
  Name extends string,
> = ValueOf<FieldByName<Fields, Name>>;

/**
 * Replace the value of a field by name, preserving the field's position.
 *
 * @example
 * ```typescript
 * type U = UpdateField<
 *   [LabeledField<"x", number>, LabeledField<"y", string>],
 *   "x",
 *   boolean
 * >; // [LabeledField<"x", boolean>, LabeledField<"y", string>]
 * ```
 */
export type UpdateField<
  Fields extends readonly LabeledField[],
  Name extends string,
  V,
> = Fields extends readonly [infer F, ...infer Rest]
  ? F extends LabeledField<Name, unknown>
    ? [LabeledField<Name, V>, ...(Rest extends readonly LabeledField[] ? Rest : [])]
    : Rest extends readonly LabeledField[]
      ? [F, ...UpdateField<Rest, Name, V>]
      : [F]
  : [];

/**
 * Pick a subset of fields by label names.
 *
 * @example
 * ```typescript
 * type P = ProjectFields<
 *   [LabeledField<"x", number>, LabeledField<"y", string>, LabeledField<"z", boolean>],
 *   ["x", "z"]
 * >; // [LabeledField<"x", number>, LabeledField<"z", boolean>]
 * ```
 */
export type ProjectFields<
  Fields extends readonly LabeledField[],
  Names extends readonly string[],
> = Names extends readonly [infer N, ...infer RestNames]
  ? N extends string
    ? RestNames extends readonly string[]
      ? [FieldByName<Fields, N>, ...ProjectFields<Fields, RestNames>]
      : [FieldByName<Fields, N>]
    : []
  : [];

// ============================================================================
// Map Result Type
// ============================================================================

/**
 * Type-level map: apply a type function (indexed access) to each tuple element.
 * Since TypeScript lacks type-level lambdas, this maps each element through
 * a function at the value level; the result type is `unknown[]` unless the
 * caller narrows it.
 */
export type MapResult<
  T extends readonly unknown[],
  F,
> = { [K in keyof T]: F extends (arg: T[K]) => infer R ? R : unknown };
