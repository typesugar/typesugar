/**
 * @typesugar/erased — Typeclass-based type erasure for heterogeneous collections.
 *
 * Inspired by Boost.TypeErasure and Rust's `dyn Trait`. Wrap values of
 * different concrete types into a uniform {@link Erased} representation
 * that carries a vtable of capability methods, then operate on them
 * through a shared interface.
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
export {
  mapErased,
  filterErased,
  showAll,
  sortErased,
  dedup,
  groupByHash,
} from "./collections.js";

// Capability widening / narrowing
export {
  widen,
  narrow,
  extendCapabilities,
  hasCapability,
} from "./widen-narrow.js";

// Macro (Phase 1 stub)
export { erasedMacro } from "./macros.js";
