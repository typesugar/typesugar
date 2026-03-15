/**
 * Global Augmentations for Standard Type Extensions
 *
 * Adds extension method declarations to built-in TypeScript interfaces
 * (Number, String, Array, etc.) so that expressions like `(42).clamp(0, 100)`
 * type-check without TS2339 errors.
 *
 * The typesugar transformer rewrites these method calls to standalone
 * function calls at compile time (e.g., `clamp(42, 0, 100)`), so
 * these methods never exist at runtime on the prototypes.
 *
 * PEP-012 Wave 8
 */

import type { Range } from "../data/range";

declare global {
  // ==========================================================================
  // Number
  // ==========================================================================

  interface Number {
    // Math.* wrappers
    abs(): number;
    ceil(): number;
    floor(): number;
    round(): number;
    trunc(): number;
    sqrt(): number;
    cbrt(): number;
    sign(): number;
    log(): number;
    log10(): number;
    log2(): number;
    exp(): number;
    sin(): number;
    cos(): number;
    tan(): number;
    asin(): number;
    acos(): number;
    atan(): number;
    sinh(): number;
    cosh(): number;
    tanh(): number;
    atan2(x: number): number;
    hypot(b: number): number;

    // Arithmetic & Rounding
    clamp(min: number, max: number): number;
    lerp(end: number, t: number): number;
    inverseLerp(end: number, value: number): number;
    remap(fromMin: number, fromMax: number, toMin: number, toMax: number): number;
    roundTo(decimals: number): number;
    ceilTo(decimals: number): number;
    floorTo(decimals: number): number;
    truncTo(decimals: number): number;
    snap(step: number): number;

    // Predicates
    isEven(): boolean;
    isOdd(): boolean;
    isPositive(): boolean;
    isNegative(): boolean;
    isZero(): boolean;
    isInteger(): boolean;
    isFiniteNum(): boolean;
    isNaN_(): boolean;
    isBetween(min: number, max: number): boolean;
    isMultipleOf(divisor: number): boolean;
    isPrime(): boolean;
    isPerfectSquare(): boolean;
    isPowerOfTwo(): boolean;

    // Number theory
    gcd(b: number): number;
    lcm(b: number): number;
    factorial(): number;
    fibonacci(): number;
    nCr(r: number): number;
    nPr(r: number): number;
    isqrt(): number;
    digits(base?: number): number[];
    digitSum(): number;
    divisors(): number[];

    // Conversion & Formatting
    toBin(): string;
    toOct(): string;
    toHex(): string;
    toBase(base: number): string;
    toOrdinal(): string;
    toWords(): string;
    toRoman(): string;
    padStart(length: number, fill?: string): string;
    toPercent(decimals?: number): string;
    toFileSize(decimals?: number): string;
    toDuration(): string;
    toCompact(): string;

    // Iteration & Ranges
    to(end: number): Range;
    until(end: number): Range;
    times<T>(fn: (i: number) => T): T[];
    timesVoid(fn: (i: number) => void): void;
    upTo(end: number, step?: number): Generator<number>;
    downTo(end: number, step?: number): Generator<number>;
    rangeTo(end: number, step?: number): number[];
    rangeUntil(end: number, step?: number): number[];

    // Saturating & Wrapping Arithmetic
    saturatingAdd(b: number, max?: number): number;
    saturatingSub(b: number, min?: number): number;
    wrappingAdd(b: number, bits?: number): number;
    wrappingSub(b: number, bits?: number): number;

    // Random
    randomInt(max: number): number;
    randomFloat(max: number): number;
  }

  // ==========================================================================
  // String
  // ==========================================================================

  interface String {
    // Case transformations
    capitalize(): string;
    uncapitalize(): string;
    titleCase(): string;
    swapCase(): string;
    camelCase(): string;
    pascalCase(): string;
    snakeCase(): string;
    kebabCase(): string;
    constantCase(): string;
    dotCase(): string;
    pathCase(): string;
    sentenceCase(): string;

    // Splitting
    words(): string[];
    lines(): string[];
    chars(): string[];
    graphemes(): string[];

    // Trimming & Stripping
    trimIndent(): string;
    stripMargin(marginChar?: string): string;
    stripPrefix(prefix: string): string;
    stripSuffix(suffix: string): string;
    removeSurrounding(prefix: string, suffix?: string): string;
    squeeze(char?: string): string;
    collapseWhitespace(): string;

    // Padding & Alignment
    center(width: number, fill?: string): string;
    padLeft(width: number, fill?: string): string;
    padRight(width: number, fill?: string): string;
    zfill(width: number): string;

    // Truncation
    truncate(maxLength: number, suffix?: string): string;
    truncateWords(maxWords: number, suffix?: string): string;
    ellipsis(maxLength: number): string;

    // Search & Extract
    substringBefore(delimiter: string): string;
    substringAfter(delimiter: string): string;
    substringBeforeLast(delimiter: string): string;
    substringAfterLast(delimiter: string): string;
    between(start: string, end: string): string;
    scan(pattern: RegExp): string[];
    count(sub: string): number;

    // Transformation (replaceAll omitted — use built-in String.prototype.replaceAll)
    reverse(): string;
    insert(index: number, value: string): string;
    remove(pattern: string | RegExp): string;
    wrap(wrapper: string): string;
    unwrap(wrapper: string): string;
    indent(spaces?: number, char?: string): string;
    dedent(): string;
    mask(start?: number, end?: number, maskChar?: string): string;

    // Predicates
    isBlank(): boolean;
    isNotBlank(): boolean;
    isAlpha(): boolean;
    isAlphaNumeric(): boolean;
    isDigit(): boolean;
    isLowerCase(): boolean;
    isUpperCase(): boolean;
    isAscii(): boolean;
    isPalindrome(): boolean;
    isEmail(): boolean;
    isUrl(): boolean;
    isJson(): boolean;
    isUuid(): boolean;
    isHex(): boolean;

    // Conversion
    toSlug(): string;
    toNumber(): number | undefined;
    toInt(radix?: number): number | undefined;
    toFloat(): number | undefined;
    toBoolean(): boolean | undefined;
    toCharCodes(): number[];

    // Encoding
    escapeHtml(): string;
    unescapeHtml(): string;
    escapeRegex(): string;
    toBase64(): string;
    fromBase64(): string;
  }

  // ==========================================================================
  // Array<T>
  // ==========================================================================

  interface Array<T> {
    // Access
    head(): T | undefined;
    tail(): T[];
    init(): T[];
    last(): T | undefined;
    headOrThrow(): T;
    lastOrThrow(): T;
    nth(n: number): T | undefined;

    // Slicing
    take(n: number): T[];
    drop(n: number): T[];
    takeRight(n: number): T[];
    dropRight(n: number): T[];
    takeWhile(pred: (a: T) => boolean): T[];
    dropWhile(pred: (a: T) => boolean): T[];
    splitAt(n: number): [T[], T[]];
    span(pred: (a: T) => boolean): [T[], T[]];

    // Grouping
    groupBy<K extends string | number | symbol>(fn: (a: T) => K): Record<K, T[]>;
    keyBy<K extends string | number | symbol>(fn: (a: T) => K): Record<K, T>;
    countBy<K extends string | number | symbol>(fn: (a: T) => K): Record<K, number>;
    chunk(size: number): T[][];
    sliding(size: number, step?: number): T[][];
    partition(pred: (a: T) => boolean): [T[], T[]];

    // Zipping
    zip<B>(b: readonly B[]): [T, B][];
    zip3<B, C>(b: readonly B[], c: readonly C[]): [T, B, C][];
    zipWith<B, C>(b: readonly B[], fn: (a: T, b: B) => C): C[];
    zipWithIndex(): [T, number][];
    zipWithNext(): [T, T][];
    unzip(): T extends [infer A, infer B] ? [A[], B[]] : never;

    // Uniqueness
    unique(): T[];
    uniqueBy<K>(fn: (a: T) => K): T[];
    duplicates(): T[];
    frequencies(): Map<T, number>;

    // Set operations
    difference(b: readonly T[]): T[];
    intersection(b: readonly T[]): T[];
    union(b: readonly T[]): T[];
    symmetricDifference(b: readonly T[]): T[];
    isSubsetOf(b: readonly T[]): boolean;
    isSupersetOf(b: readonly T[]): boolean;

    // Folding & Scanning
    foldRight<B>(init: B, fn: (a: T, acc: B) => B): B;
    scanLeft<B>(init: B, fn: (acc: B, a: T) => B): B[];
    scanRight<B>(init: B, fn: (a: T, acc: B) => B): B[];

    // Aggregation
    sumBy(fn: (a: T) => number): number;
    minBy(fn: (a: T) => number): T | undefined;
    maxBy(fn: (a: T) => number): T | undefined;
    average(): number;
    median(): number;
    product(): number;

    // Sorting
    sortBy<K>(fn: (a: T) => K): T[];
    sortByDesc<K>(fn: (a: T) => K): T[];

    // Transformation
    intersperse(sep: T): T[];
    intercalate(sep: readonly T[]): T extends (infer U)[] ? U[] : never;
    compact(): NonNullable<T>[];
    flatten(): T extends infer U | (infer U)[] ? U[] : T[];
    flattenDeep(): unknown[];
    rotate(n: number): T[];
    transpose(): T extends readonly (infer U)[] ? U[][] : never;
    interleave(b: readonly T[]): T[];

    // Random & Sampling
    shuffle(): T[];
    sample(): T | undefined;
    sampleN(n: number): T[];

    // Predicates
    none(pred: (a: T) => boolean): boolean;
    isPrefixOf(arr: readonly T[]): boolean;
    isSuffixOf(arr: readonly T[]): boolean;
    isSorted(compare?: (a: T, b: T) => number): boolean;

    // Tails & Inits
    tails(): T[][];
    inits(): T[][];

    // String-like
    mkString(sep?: string, prefix?: string, suffix?: string): string;

    // Conversion
    associate<K extends string | number | symbol, V>(fn: (a: T) => [K, V]): Record<K, V>;
    toMap<K, V>(fn: (a: T) => [K, V]): Map<K, V>;
    toSet(): Set<T>;
    zipObject<V>(values: readonly V[]): T extends string | number | symbol ? Record<T, V> : never;
  }

  // ==========================================================================
  // Boolean
  // ==========================================================================

  interface Boolean {
    // Conversion (toString omitted — conflicts with Boolean.prototype.toString)
    toInt(): 0 | 1;
    toSign(): -1 | 1;
    toYesNo(): "yes" | "no";
    toOnOff(): "on" | "off";

    // Rust-inspired
    thenSome<A>(value: A): A | undefined;
    then<A>(fn: () => A): A | undefined;
    elseSome<A>(value: A): A | undefined;

    // Haskell-inspired
    fold<A>(onFalse: () => A, onTrue: () => A): A;

    // Logic
    toggle(): boolean;
    and(b: boolean): boolean;
    or(b: boolean): boolean;
    xor(b: boolean): boolean;
    nand(b: boolean): boolean;
    nor(b: boolean): boolean;
    implies(b: boolean): boolean;

    // Guard / Assert
    guard(error?: string | Error): void;
    expect<A>(value: A, error?: string): A;

    // Comparison
    compareTo(b: boolean): -1 | 0 | 1;
  }

  // ==========================================================================
  // Date
  // ==========================================================================

  interface Date {
    // Arithmetic
    addMilliseconds(ms: number): Date;
    addSeconds(seconds: number): Date;
    addMinutes(minutes: number): Date;
    addHours(hours: number): Date;
    addDays(days: number): Date;
    addWeeks(weeks: number): Date;
    addMonths(months: number): Date;
    addYears(years: number): Date;

    // Difference
    diffInMilliseconds(b: Date): number;
    diffInSeconds(b: Date): number;
    diffInMinutes(b: Date): number;
    diffInHours(b: Date): number;
    diffInDays(b: Date): number;
    diffInWeeks(b: Date): number;
    diffInMonths(b: Date): number;
    diffInYears(b: Date): number;

    // Start/End of Period
    startOfDay(): Date;
    endOfDay(): Date;
    startOfWeek(weekStartsOn?: number): Date;
    startOfMonth(): Date;
    endOfMonth(): Date;
    startOfYear(): Date;
    endOfYear(): Date;

    // Comparison & Predicates
    isAfter(other: Date): boolean;
    isBefore(other: Date): boolean;
    isSameDay(b: Date): boolean;
    isSameMonth(b: Date): boolean;
    isSameYear(b: Date): boolean;
    isBetweenDates(start: Date, end: Date): boolean;
    isToday(): boolean;
    isYesterday(): boolean;
    isTomorrow(): boolean;
    isWeekend(): boolean;
    isWeekday(): boolean;
    isLeapYear(): boolean;

    // Formatting
    formatRelative(now?: Date): string;
    formatISO(): string;
    formatDate(): string;
    formatTime(): string;
    formatDateTime(): string;
    dayOfYear(): number;
    weekOfYear(): number;
    daysInMonth(): number;
    daysInYear(): number;
    quarter(): number;

    // Clamp & Range
    clampDate(min: Date, max: Date): Date;
    eachDay(end: Date): Date[];
  }

  // ==========================================================================
  // Map<K, V>
  // ==========================================================================

  interface Map<K, V> {
    getOrDefault(key: K, defaultValue: V): V;
    getOrPut(key: K, factory: () => V): V;
    mapMapValues<U>(fn: (value: V, key: K) => U): Map<K, U>;
    mapMapKeys<K2>(fn: (key: K, value: V) => K2): Map<K2, V>;
    filterMap(pred: (value: V, key: K) => boolean): Map<K, V>;
    filterMapKeys(pred: (key: K) => boolean): Map<K, V>;
    filterMapValues(pred: (value: V) => boolean): Map<K, V>;
    mergeMap(b: Map<K, V>, resolve?: (va: V, vb: V, key: K) => V): Map<K, V>;
    mapUnion(b: Map<K, V>): Map<K, V>;
    mapIntersection(b: Map<K, V>): Map<K, V>;
    mapDifference(b: Map<K, V>): Map<K, V>;
    invertMap(): Map<V, K>;
    groupMapBy<G>(fn: (value: V, key: K) => G): Map<G, Map<K, V>>;
    mapToPairs(): [K, V][];
    mapFold<B>(init: B, fn: (acc: B, value: V, key: K) => B): B;
  }

  // ==========================================================================
  // Promise<T>
  // ==========================================================================

  interface Promise<T> {
    timeout(ms: number, message?: string): Promise<T>;
    timeoutOr(ms: number, fallback: T): Promise<T>;
    tap(fn: (value: T) => void | Promise<void>): Promise<T>;
    tapError(fn: (error: Error) => void | Promise<void>): Promise<T>;
    recover(fn: (error: Error) => T | Promise<T>): Promise<T>;
    fallbackTo(fallback: Promise<T>): Promise<T>;
  }
}

export {};
