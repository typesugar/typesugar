/**
 * Runtime registration of standalone extension methods.
 *
 * When @typesugar/std is imported from dist, the @extension decorator
 * has already been stripped. This module registers all extension methods
 * at module load time so the transformer can rewrite them even when
 * compiling against the built dist.
 *
 * Uses globalThis.__typesugar_registerExtension (set by @typesugar/core)
 * to avoid a direct import dependency on @typesugar/core.
 */

type RegisterFn = (info: { methodName: string; forType: string; qualifier?: string }) => void;

const register: RegisterFn | undefined = (globalThis as any).__typesugar_registerExtension;

if (register) {
  // Number extensions
  const numberMethods = [
    "abs",
    "acos",
    "asin",
    "atan",
    "atan2",
    "cbrt",
    "ceil",
    "ceilTo",
    "clamp",
    "cos",
    "cosh",
    "digitSum",
    "digits",
    "divisors",
    "downTo",
    "exp",
    "factorial",
    "fibonacci",
    "floor",
    "floorTo",
    "gcd",
    "hypot",
    "inverseLerp",
    "isEven",
    "isFiniteNum",
    "isInteger",
    "isMultipleOf",
    "isNaN_",
    "isNegative",
    "isOdd",
    "isPerfectSquare",
    "isPositive",
    "isPowerOfTwo",
    "isPrime",
    "isZero",
    "isqrt",
    "lcm",
    "lerp",
    "log",
    "log10",
    "log2",
    "nCr",
    "nPr",
    "negate",
    "randomFloat",
    "randomInt",
    "remap",
    "round",
    "roundTo",
    "saturatingAdd",
    "saturatingSub",
    "sign",
    "sin",
    "sinh",
    "snap",
    "sqrt",
    "step",
    "tan",
    "tanh",
    "times",
    "timesVoid",
    "to",
    "toBase",
    "toBin",
    "toCompact",
    "toFileSize",
    "toHex",
    "toOct",
    "toOrdinal",
    "toPercent",
    "toRoman",
    "toWords",
    "trunc",
    "truncTo",
    "upTo",
    "wrappingAdd",
    "wrappingSub",
  ];
  for (const m of numberMethods) {
    register({ methodName: m, forType: "number" });
  }

  // String extensions
  const stringMethods = [
    "camelCase",
    "capitalize",
    "contains",
    "isBlank",
    "isPalindrome",
    "kebabCase",
    "padStart",
    "pascalCase",
    "reverse",
    "snakeCase",
    "truncate",
    "words",
  ];
  for (const m of stringMethods) {
    register({ methodName: m, forType: "string" });
  }

  // Array extensions
  const arrayMethods = [
    "chunk",
    "compact",
    "first",
    "flatten",
    "groupBy",
    "head",
    "intersperse",
    "last",
    "partition",
    "shuffle",
    "sortBy",
    "tail",
    "takeWhile",
    "dropWhile",
    "unique",
    "uniqueBy",
    "zip",
    "zipWith",
  ];
  for (const m of arrayMethods) {
    register({ methodName: m, forType: "Array" });
  }
}
