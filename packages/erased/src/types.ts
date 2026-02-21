/**
 * Core types for typeclass-based type erasure.
 *
 * An {@link Erased} value wraps an unknown value together with a vtable
 * of capability methods. This lets heterogeneous values coexist in a
 * single collection while retaining type-safe access to their shared
 * capabilities.
 *
 * @module
 */

/**
 * A capability is a named set of methods that a type must support.
 *
 * Each capability corresponds to a typeclass (Show, Eq, Ord, etc.) and
 * carries a `methods` record describing the operations it provides.
 *
 * @typeParam Name - A string literal identifying the capability.
 */
export interface Capability<Name extends string = string> {
  readonly name: Name;
  readonly methods: Record<string, (...args: any[]) => any>;
}

/**
 * Extract the methods record from a {@link Capability}.
 *
 * @typeParam C - The capability to extract methods from.
 */
export type Vtable<C extends Capability> = C["methods"];

/**
 * An erased value — carries a value and its vtable of capability methods.
 *
 * The concrete type of the wrapped value is hidden (`unknown`), but the
 * vtable guarantees that all methods from `Caps` are available at runtime.
 *
 * @typeParam Caps - The tuple of capabilities this erased value supports.
 */
export interface Erased<Caps extends readonly Capability[]> {
  readonly __erased__: true;
  readonly __value: unknown;
  readonly __vtable: UnionOfVtables<Caps>;
}

/**
 * Merge all capability methods from a tuple of capabilities into a single
 * flat record type.
 *
 * @typeParam Caps - A readonly tuple of {@link Capability} types.
 */
export type UnionOfVtables<Caps extends readonly Capability[]> =
  Caps extends readonly [
    infer First extends Capability,
    ...infer Rest extends Capability[],
  ]
    ? Vtable<First> & UnionOfVtables<Rest>
    : {};

// ---------------------------------------------------------------------------
// Structural vtable constraints
// ---------------------------------------------------------------------------
// These check for the presence of specific methods in the vtable,
// regardless of capability ordering in the tuple.

/** Constraint: vtable includes `show`. */
export type WithShow = Erased<readonly Capability[]> & {
  readonly __vtable: { show(value: unknown): string };
};

/** Constraint: vtable includes `equals`. */
export type WithEq = Erased<readonly Capability[]> & {
  readonly __vtable: { equals(a: unknown, b: unknown): boolean };
};

/** Constraint: vtable includes `compare`. */
export type WithOrd = Erased<readonly Capability[]> & {
  readonly __vtable: { compare(a: unknown, b: unknown): number };
};

/** Constraint: vtable includes `hash`. */
export type WithHash = Erased<readonly Capability[]> & {
  readonly __vtable: { hash(value: unknown): number };
};

/** Constraint: vtable includes `clone`. */
export type WithClone = Erased<readonly Capability[]> & {
  readonly __vtable: { clone(value: unknown): unknown };
};

/** Constraint: vtable includes `debug`. */
export type WithDebug = Erased<readonly Capability[]> & {
  readonly __vtable: { debug(value: unknown): string };
};
