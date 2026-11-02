/**
 * Extension Methods for Standard Types
 *
 * All modules use "use extension" directive, making their exports callable
 * as methods on the appropriate types. Just import the functions you need:
 *
 *   import { clamp, isEven } from "@typesugar/std";
 *
 *   (-5).abs();           // → Math.abs(-5) → 5
 *   n.clamp(0, 100);      // → clamp(n, 0, 100)
 *   n.isEven();           // → isEven(n)
 *   arr.head();           // → head(arr)
 *   s.capitalize();       // → capitalize(s)
 *
 * Global augmentations are imported below so that extension methods
 * type-check on built-in types (Number, String, Array, etc.) without
 * TS2339 errors. The transformer rewrites these calls to function calls.
 *
 * Legacy: NumberExt, StringExt, etc. namespaces are still exported for
 * backward compatibility with registerExtensions().
 */

// Global type augmentations for built-in interfaces (PEP-012 Wave 8)
import "./global-augmentations";

// Legacy extension namespace objects (deprecated, use direct imports instead)
//
export { NumberExt } from "./number";
export { StringExt } from "./string";
export { ArrayExt } from "./array";
export { ObjectExt } from "./object";
export { BooleanExt } from "./boolean";
export { DateExt } from "./date";
export { MapExt, SetExt } from "./map";
export { PromiseExt } from "./promise";
export { FunctionExt } from "./function";

// Re-export all from modules without conflicting names
export * from "./number";
export * from "./date";
export * from "./promise";
export * from "./function";

// Re-export specific items from modules with conflicting names
// Using aliases for duplicates: toInt, toMap, groupBy

// String utilities
export {
  capitalize,
  truncate,
  words,
  camelCase,
  kebabCase,
  pascalCase,
  snakeCase,
  isBlank,
  reverse,
  isPalindrome,
  toInt as parseIntSafe,
} from "./string";

// Boolean utilities
export { toInt as boolToInt } from "./boolean";

// Array utilities (`last` is exported below: it serves both Array and Range)
export {
  head,
  tail,
  chunk,
  compact,
  flatten,
  groupBy as arrayGroupBy,
  partition,
  shuffle,
  sortBy,
  unique,
  uniqueBy,
  zip,
  zipWith,
  intersperse,
  takeWhile,
  dropWhile,
  toMap as arrayToMap,
} from "./array";

// Object utilities
export {
  pick,
  omit,
  deepMerge,
  mapKeys,
  mapValues,
  invert,
  defaults,
  toMap as objectToMap,
} from "./object";

import { last as arrayLast } from "./array";
import { last as rangeLast } from "./range";
import type { Range } from "../data/range";

// Map/Set utilities
export { filterMapKeys, filterMapValues, setUnion, setIntersection, setDifference } from "./map";

// Range utilities
// Note: `to` and `until` come from "./number" via `export * from "./number"`.
// Range methods are exported under their METHOD names, because the extension
// resolver pairs `r.size()` with an imported `size` (docs review 2026-10:
// `(1).to(10).size()` etc. type-checked but threw at runtime). None of these
// names is exported by anything else at the root except `last` (Array), which
// dispatches below. The range-prefixed functions in data/range.ts remain.
export {
  step,
  reversed,
  toArray,
  iterator,
  first,
  contains,
  size,
  isEmpty,
  forEach,
  map,
  filter,
  reduce,
  RangeExtensions,
} from "./range";

/**
 * Last element of an array, or of a {@link Range} (`arr.last()` /
 * `(1).to(10).last()`). Undefined when empty.
 */
export function last<A>(arr: readonly A[]): A | undefined;
export function last(r: Range): number | undefined;
export function last<A>(x: readonly A[] | Range): A | number | undefined {
  return Array.isArray(x) ? arrayLast(x as readonly A[]) : rangeLast(x as Range);
}
