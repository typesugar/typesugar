/**
 * @typesugar/erased — Typeclass-based type erasure for heterogeneous collections.
 *
 * Inspired by Boost.TypeErasure and Rust's `dyn Trait`. Wrap values of
 * different concrete types into a uniform {@link Erased} representation
 * that carries a vtable of capability methods, then operate on them
 * through a shared interface.
 *
 * **Usage:**
 * ```typescript
 * // Auto-resolve vtable from typeclass instances (requires transformer)
 * const e = erased<[Show, Eq]>(myPoint);
 *
 * // Or manual vtable construction
 * const e = eraseWith(value, { show: (v) => String(v), equals: (a, b) => a === b });
 * ```
 *
 * @packageDocumentation
 */

// Core types
export type {
  Capability,
  Vtable,
  Erased,
  UnionOfVtables,
  WithShow,
  WithEq,
  WithOrd,
  WithHash,
  WithClone,
  WithDebug,
} from "./types.js";

// Built-in capabilities
export type {
  ShowCapability,
  EqCapability,
  OrdCapability,
  HashCapability,
  CloneCapability,
  DebugCapability,
  JsonCapability,
} from "./capabilities.js";

// Erased value construction and method dispatch
export {
  eraseWith,
  showable,
  equatable,
  showableEq,
  unwrapErased,
  callMethod,
  show,
  equals,
  compare,
  hash,
  clone,
  debug,
} from "./erased.js";

// Heterogeneous collection utilities
export type { ErasedList } from "./collections.js";
export { mapErased, filterErased, showAll, sortErased, dedup, groupByHash } from "./collections.js";

// Capability widening / narrowing
export { widen, narrow, extendCapabilities, hasCapability } from "./widen-narrow.js";

// Macro
export { erasedMacro } from "./macros.js";

// ============================================================================
// Runtime Stub
// ============================================================================

import type { Capability, Erased } from "./types.js";

/**
 * Erase a value's type, keeping only specified capabilities.
 *
 * The `erased()` macro auto-resolves vtables from typeclass instances at
 * compile time. Use this when you have `@instance` or `@derive` annotations
 * for the required typeclasses.
 *
 * @example
 * ```typescript
 * @derive(Show, Eq)
 * interface Point { x: number; y: number; }
 *
 * const p = { x: 1, y: 2 };
 * const e = erased<[Show, Eq]>(p);
 * // e.show() works, e.equals() works
 * ```
 *
 * @param value - The value to erase
 * @returns An erased value with auto-generated vtable
 * @throws If the typesugar transformer is not configured
 */
export function erased<Caps extends readonly Capability[]>(_value: unknown): Erased<Caps> {
  throw new Error(
    "erased() requires the typesugar transformer. " +
      "Ensure your build is configured with unplugin-typesugar or ts-patch. " +
      "For manual vtable construction, use eraseWith() instead."
  );
}
