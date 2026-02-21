/**
 * Number Extension Methods
 *
 * The best from:
 * - Ruby (times, upto, downto, even?, odd?, between?, clamp, abs, round, ceil, floor, digits)
 * - Kotlin (coerceIn, coerceAtLeast, coerceAtMost, rangeTo, downTo, compareTo)
 * - Swift (isMultiple(of:), magnitude, negate)
 * - Rust (clamp, pow, checked_add, saturating_add, wrapping_add)
 * - Python (math module: gcd, lcm, factorial, comb, perm, isqrt)
 * - Scala (to, until, max, min, abs, signum, toByte, toShort, toInt, toLong)
 * - Haskell (div, mod, divMod, quot, rem, gcd, lcm, even, odd)
 * - Most-requested JS/TS: clamp, lerp, remap, isEven, isOdd, random range, ordinal
 */

// ============================================================================
// Arithmetic & Rounding
// ============================================================================

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function inverseLerp(start: number, end: number, value: number): number {
  return start === end ? 0 : (value - start) / (end - start);
}

export function remap(
  n: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number
): number {
  const t = inverseLerp(fromMin, fromMax, n);
  return lerp(toMin, toMax, t);
}

export function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function ceilTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.ceil(n * factor) / factor;
}

export function floorTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(n * factor) / factor;
}

export function truncTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.trunc(n * factor) / factor;
}

export function snap(n: number, step: number): number {
  return Math.round(n / step) * step;
}

// ============================================================================
// Predicates
// ============================================================================

export function isEven(n: number): boolean {
  return n % 2 === 0;
}

export function isOdd(n: number): boolean {
  return n % 2 !== 0;
}

export function isPositive(n: number): boolean {
  return n > 0;
}

export function isNegative(n: number): boolean {
  return n < 0;
}

export function isZero(n: number): boolean {
  return n === 0;
}

export function isInteger(n: number): boolean {
  return Number.isInteger(n);
}

export function isFiniteNum(n: number): boolean {
  return Number.isFinite(n);
}

export function isNaN_(n: number): boolean {
  return Number.isNaN(n);
}

export function isBetween(n: number, min: number, max: number): boolean {
  return n >= min && n <= max;
}

export function isMultipleOf(n: number, divisor: number): boolean {
  return divisor !== 0 && n % divisor === 0;
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

export function isPerfectSquare(n: number): boolean {
  if (n < 0) return false;
  const s = Math.sqrt(n);
  return s === Math.floor(s);
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

// ============================================================================
// Number Theory (Python math, Haskell Prelude)
// ============================================================================

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function lcm(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : Math.abs(a * b) / gcd(a, b);
}

export function factorial(n: number): number {
  if (n < 0) throw new RangeError("factorial of negative number");
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function fibonacci(n: number): number {
  if (n < 0) throw new RangeError("fibonacci of negative number");
  let [a, b] = [0, 1];
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

export function nCr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  r = Math.min(r, n - r);
  let result = 1;
  for (let i = 0; i < r; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

export function nPr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let result = 1;
  for (let i = 0; i < r; i++) result *= n - i;
  return result;
}

export function isqrt(n: number): number {
  if (n < 0) throw new RangeError("isqrt of negative number");
  return Math.floor(Math.sqrt(n));
}

export function digits(n: number, base: number = 10): number[] {
  if (!Number.isInteger(n)) throw new TypeError("digits requires an integer");
  n = Math.abs(n);
  if (n === 0) return [0];
  const result: number[] = [];
  while (n > 0) {
    result.unshift(n % base);
    n = Math.floor(n / base);
  }
  return result;
}

export function digitSum(n: number): number {
  return digits(n).reduce((a, b) => a + b, 0);
}

export function divisors(n: number): number[] {
  n = Math.abs(n);
  if (n === 0) return [];
  const result: number[] = [];
  for (let i = 1; i * i <= n; i++) {
    if (n % i === 0) {
      result.push(i);
      if (i !== n / i) result.push(n / i);
    }
  }
  return result.sort((a, b) => a - b);
}

// ============================================================================
// Conversion & Formatting
// ============================================================================

export function toBin(n: number): string {
  return (n >>> 0).toString(2);
}

export function toOct(n: number): string {
  return (n >>> 0).toString(8);
}

export function toHex(n: number): string {
  return (n >>> 0).toString(16);
}

export function toBase(n: number, base: number): string {
  return n.toString(base);
}

export function toOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function toWords(n: number): string {
  if (n === 0) return "zero";
  if (!Number.isFinite(n)) return String(n);

  const ones = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];

  const negative = n < 0;
  n = Math.abs(Math.floor(n));

  if (n < 20) return (negative ? "negative " : "") + ones[n];
  if (n < 100)
    return (
      (negative ? "negative " : "") + tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "")
    );
  if (n < 1000)
    return (
      (negative ? "negative " : "") +
      ones[Math.floor(n / 100)] +
      " hundred" +
      (n % 100 ? " and " + toWords(n % 100) : "")
    );

  const scales = ["", "thousand", "million", "billion", "trillion"];
  const parts: string[] = [];
  let scaleIdx = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      parts.unshift(toWords(chunk) + (scales[scaleIdx] ? " " + scales[scaleIdx] : ""));
    }
    n = Math.floor(n / 1000);
    scaleIdx++;
  }

  return (negative ? "negative " : "") + parts.join(", ");
}

export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000 || !Number.isInteger(n))
    throw new RangeError("Roman numerals require 1-3999");

  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

export function padStart(n: number, length: number, fill: string = "0"): string {
  return String(n).padStart(length, fill);
}

export function toPercent(n: number, decimals: number = 0): string {
  return (n * 100).toFixed(decimals) + "%";
}

export function toFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / k ** i).toFixed(decimals)) + " " + sizes[i];
}

export function toDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${ms}ms`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (abs < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function toCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ============================================================================
// Iteration (Ruby times/upto/downto, Kotlin rangeTo, Scala to/until)
// ============================================================================

export function times<T>(n: number, fn: (i: number) => T): T[] {
  const result: T[] = [];
  for (let i = 0; i < n; i++) result.push(fn(i));
  return result;
}

export function timesVoid(n: number, fn: (i: number) => void): void {
  for (let i = 0; i < n; i++) fn(i);
}

export function* upTo(start: number, end: number, step: number = 1): Generator<number> {
  for (let i = start; i <= end; i += step) yield i;
}

export function* downTo(start: number, end: number, step: number = 1): Generator<number> {
  for (let i = start; i >= end; i -= step) yield i;
}

export function rangeTo(start: number, end: number, step?: number): number[] {
  const s = step ?? (start <= end ? 1 : -1);
  const result: number[] = [];
  if (s > 0) {
    for (let i = start; i <= end; i += s) result.push(i);
  } else {
    for (let i = start; i >= end; i += s) result.push(i);
  }
  return result;
}

export function rangeUntil(start: number, end: number, step?: number): number[] {
  const s = step ?? (start <= end ? 1 : -1);
  const result: number[] = [];
  if (s > 0) {
    for (let i = start; i < end; i += s) result.push(i);
  } else {
    for (let i = start; i > end; i += s) result.push(i);
  }
  return result;
}

// ============================================================================
// Saturating & Wrapping Arithmetic (Rust)
// ============================================================================

export function saturatingAdd(a: number, b: number, max: number = Number.MAX_SAFE_INTEGER): number {
  const result = a + b;
  return result > max ? max : result;
}

export function saturatingSub(a: number, b: number, min: number = Number.MIN_SAFE_INTEGER): number {
  const result = a - b;
  return result < min ? min : result;
}

export function wrappingAdd(a: number, b: number, bits: number = 32): number {
  const max = 2 ** bits;
  return (((a + b) % max) + max) % max;
}

export function wrappingSub(a: number, b: number, bits: number = 32): number {
  const max = 2 ** bits;
  return (((a - b) % max) + max) % max;
}

// ============================================================================
// Random (commonly requested in JS/TS)
// ============================================================================

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// ============================================================================
// Aggregate — collect all into a namespace-like object for extension
// ============================================================================

export const NumberExt = {
  clamp,
  lerp,
  inverseLerp,
  remap,
  roundTo,
  ceilTo,
  floorTo,
  truncTo,
  snap,
  isEven,
  isOdd,
  isPositive,
  isNegative,
  isZero,
  isInteger,
  isFinite: isFiniteNum,
  isNaN: isNaN_,
  isBetween,
  isMultipleOf,
  isPrime,
  isPerfectSquare,
  isPowerOfTwo,
  gcd,
  lcm,
  factorial,
  fibonacci,
  nCr,
  nPr,
  isqrt,
  digits,
  digitSum,
  divisors,
  toBin,
  toOct,
  toHex,
  toBase,
  toOrdinal,
  toWords,
  toRoman,
  padStart,
  toPercent,
  toFileSize,
  toDuration,
  toCompact,
  times,
  timesVoid,
  upTo,
  downTo,
  rangeTo,
  rangeUntil,
  saturatingAdd,
  saturatingSub,
  wrappingAdd,
  wrappingSub,
  randomInt,
  randomFloat,
} as const;
