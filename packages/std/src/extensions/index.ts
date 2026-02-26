// Extension namespace objects
//
// These are used with registerExtensions() to enable Scala 3-style
// extension methods on concrete types:
//
//   import { registerExtensions, extend } from "typesugar";
//   import { NumberExt } from "@typesugar/std";
//
//   registerExtensions("number", NumberExt);
//   extend(42).clamp(0, 100); // → NumberExt.clamp(42, 0, 100)
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
