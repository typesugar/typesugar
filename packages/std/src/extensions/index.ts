// Extension classes for fluent API
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
export {
  filterMapKeys,
  filterMapValues,
  setUnion,
  setIntersection,
  setDifference,
} from "./map";
