/**
 * @typesugar/hlist — Heterogeneous Lists for TypeScript
 *
 * Type-safe heterogeneous sequences inspired by Boost.Fusion/Hana and
 * Shapeless. Every element's type is tracked individually at the type level,
 * while the runtime representation is a plain array.
 *
 * @example
 * ```typescript
 * import { hlist, head, tail, concat, labeled, get } from "@typesugar/hlist";
 *
 * // Positional HList
 * const list = hlist(1, "hello", true);
 * head(list);              // 1, typed as number
 * tail(list);              // HList<[string, boolean]>
 * concat(list, hlist(42)); // HList<[number, string, boolean, number]>
 *
 * // Labeled HList (record-like with type-safe field access)
 * const rec = labeled({ x: 10, y: "hi" });
 * get(rec, "x"); // 10, typed as number
 * ```
 */

// Core types
export type {
  HList,
  HNil,
  HCons,
  LabeledField,
  LabeledHList,
  Head,
  Tail,
  Last,
  Init,
  Length,
  At,
  Concat,
  Reverse,
  Zip,
  SplitAt,
  LabelOf,
  ValueOf,
  FieldByName,
  ValueByName,
  UpdateField,
  ProjectFields,
  MapResult,
} from "./types.js";

// Runtime operations
export {
  hlist,
  hnil,
  labeled,
  head,
  tail,
  last,
  init,
  at,
  length,
  append,
  prepend,
  concat,
  reverse,
  zip,
  splitAt,
  get,
  set,
  labels,
  project,
  merge,
  map,
  foldLeft,
  forEach,
  toArray,
  fromArray,
} from "./operations.js";

// Macros
export { hlistMacro, labeledMacro, mapWithMacro, register } from "./macros.js";
