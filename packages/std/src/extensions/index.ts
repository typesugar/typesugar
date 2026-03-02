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
 * Legacy: NumberExt, StringExt, etc. namespaces are still exported for
 * backward compatibility with registerExtensions().
 */

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
  toInt as parseIntSafe,
} from "./string";

// Boolean utilities
export { toInt as boolToInt } from "./boolean";

// Array utilities
export {
  head,
  tail,
  last,
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

// Map/Set utilities
export { filterMapKeys, filterMapValues, setUnion, setIntersection, setDifference } from "./map";
