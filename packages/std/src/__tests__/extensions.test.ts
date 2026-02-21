import { describe, it, expect } from "vitest";

// Number extensions
import {
  clamp,
  lerp,
  roundTo,
  isEven,
  isOdd,
  isPrime,
  isBetween,
  gcd,
  lcm,
  factorial,
  digits,
  toHex,
  toBin,
  toOrdinal,
  toFileSize,
  times,
  upTo,
  saturatingAdd,
  randomInt,
  remap,
} from "../extensions/number";

// String extensions
import {
  capitalize,
  uncapitalize,
  camelCase,
  snakeCase,
  kebabCase,
  pascalCase,
  words,
  lines,
  isBlank,
  reverse as reverseStr,
  truncate,
  center,
  toSlug,
  substringBefore,
  substringAfter,
  count as countStr,
  escapeHtml,
} from "../extensions/string";

// Array extensions
import {
  head,
  last,
  tail,
  init,
  take,
  drop,
  chunk,
  zip,
  unique,
  groupBy,
  partition,
  flatten,
  intersperse,
  sumBy,
  maxBy,
  sortBy,
  rotate,
  tails,
  mkString,
} from "../extensions/array";

// Object extensions
import {
  pick,
  omit,
  mapValues,
  mapKeys,
  invert,
  deepClone,
  deepEqual,
  isEmpty as isEmptyObj,
  hasKey,
  getPath,
  setPath,
  toPairs,
} from "../extensions/object";

// Boolean extensions
import {
  toInt,
  thenSome,
  fold as boolFold,
  toggle,
  xor,
  implies,
  guard,
  toYesNo,
} from "../extensions/boolean";

// Date extensions
import {
  addDays,
  addMonths,
  diffInDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isWeekend,
  isLeapYear,
  daysInMonth,
  quarter,
  eachDay,
} from "../extensions/date";

// Map/Set extensions
import {
  getOrDefault,
  getOrPut,
  mapMapValues,
  filterMap,
  mergeMap,
  mapIntersection,
  mapDifference,
  invertMap,
  mapToObject,
  setUnion,
  setIntersection,
  setDifference,
  isSubset,
  isDisjoint,
  setPartition,
  powerSet,
} from "../extensions/map";

// Tuple extensions
import {
  pair,
  fst,
  snd,
  swap,
  bimap,
  both,
  curryPair,
  uncurryPair,
  triple,
  zipToPairs,
  unzipPairs,
} from "../data/tuple";

// Range extensions
import {
  range,
  rangeInclusive,
  rangeToArray,
  rangeContains,
  rangeMap,
  rangeFilter,
  rangeReduce,
  rangeReversed,
  rangeBy,
} from "../data/range";

// Typeclasses
import {
  boundedNumber,
  enumBoolean,
  numericNumber,
  parseableNumber,
  defaultNumber,
  defaultString,
  sizedArray,
  sizedString,
} from "../typeclasses";

// ============================================================================
// Number Extensions
// ============================================================================

describe("NumberExt", () => {
  it("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("lerp", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  it("remap", () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(0, 0, 10, 0, 100)).toBe(0);
  });

  it("roundTo", () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(3.145, 2)).toBe(3.15);
  });

  it("isEven / isOdd", () => {
    expect(isEven(4)).toBe(true);
    expect(isEven(3)).toBe(false);
    expect(isOdd(3)).toBe(true);
  });

  it("isPrime", () => {
    expect(isPrime(2)).toBe(true);
    expect(isPrime(7)).toBe(true);
    expect(isPrime(4)).toBe(false);
    expect(isPrime(1)).toBe(false);
  });

  it("isBetween", () => {
    expect(isBetween(5, 1, 10)).toBe(true);
    expect(isBetween(0, 1, 10)).toBe(false);
  });

  it("gcd / lcm", () => {
    expect(gcd(12, 8)).toBe(4);
    expect(lcm(4, 6)).toBe(12);
  });

  it("factorial", () => {
    expect(factorial(0)).toBe(1);
    expect(factorial(5)).toBe(120);
  });

  it("digits", () => {
    expect(digits(12345)).toEqual([1, 2, 3, 4, 5]);
    expect(digits(0)).toEqual([0]);
  });

  it("toHex / toBin", () => {
    expect(toHex(255)).toBe("ff");
    expect(toBin(10)).toBe("1010");
  });

  it("toOrdinal", () => {
    expect(toOrdinal(1)).toBe("1st");
    expect(toOrdinal(2)).toBe("2nd");
    expect(toOrdinal(3)).toBe("3rd");
    expect(toOrdinal(11)).toBe("11th");
    expect(toOrdinal(21)).toBe("21st");
  });

  it("toFileSize", () => {
    expect(toFileSize(1024)).toBe("1 KB");
    expect(toFileSize(1048576)).toBe("1 MB");
    expect(toFileSize(1536)).toBe("1.5 KB");
  });

  it("times", () => {
    const result = times(3, (i) => i * 2);
    expect(result).toEqual([0, 2, 4]);
  });

  it("upTo", () => {
    expect([...upTo(1, 5)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("saturatingAdd", () => {
    expect(saturatingAdd(250, 10, 255)).toBe(255);
    expect(saturatingAdd(100, 50, 255)).toBe(150);
  });

  it("randomInt", () => {
    for (let i = 0; i < 100; i++) {
      const r = randomInt(1, 10);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(10);
    }
  });
});

// ============================================================================
// String Extensions
// ============================================================================

describe("StringExt", () => {
  it("capitalize / uncapitalize", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(uncapitalize("Hello")).toBe("hello");
  });

  it("camelCase / snakeCase / kebabCase / pascalCase", () => {
    expect(camelCase("hello world")).toBe("helloWorld");
    expect(snakeCase("helloWorld")).toBe("hello_world");
    expect(kebabCase("helloWorld")).toBe("hello-world");
    expect(pascalCase("hello world")).toBe("HelloWorld");
  });

  it("words / lines", () => {
    expect(words("hello world foo")).toEqual(["hello", "world", "foo"]);
    expect(lines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("isBlank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("  \t\n")).toBe(true);
    expect(isBlank("a")).toBe(false);
  });

  it("reverse", () => {
    expect(reverseStr("hello")).toBe("olleh");
  });

  it("truncate", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
    expect(truncate("hi", 10)).toBe("hi");
  });

  it("center", () => {
    expect(center("hi", 6)).toBe("  hi  ");
    expect(center("hi", 7)).toBe("  hi   ");
  });

  it("toSlug", () => {
    expect(toSlug("Hello World!")).toBe("hello-world");
    expect(toSlug("  Foo  Bar  ")).toBe("foo-bar");
  });

  it("substringBefore / substringAfter", () => {
    expect(substringBefore("hello-world", "-")).toBe("hello");
    expect(substringAfter("hello-world", "-")).toBe("world");
  });

  it("count", () => {
    expect(countStr("banana", "a")).toBe(3);
  });

  it("escapeHtml", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });
});

// ============================================================================
// Array Extensions
// ============================================================================

describe("ArrayExt", () => {
  it("head / last / tail / init", () => {
    expect(head([1, 2, 3])).toBe(1);
    expect(last([1, 2, 3])).toBe(3);
    expect(tail([1, 2, 3])).toEqual([2, 3]);
    expect(init([1, 2, 3])).toEqual([1, 2]);
    expect(head([])).toBeUndefined();
  });

  it("take / drop", () => {
    expect(take([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(drop([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });

  it("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("zip", () => {
    expect(zip([1, 2, 3], ["a", "b", "c"])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });

  it("unique", () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it("groupBy", () => {
    const result = groupBy([1, 2, 3, 4, 5], (n) => (n % 2 === 0 ? "even" : "odd"));
    expect(result).toEqual({ odd: [1, 3, 5], even: [2, 4] });
  });

  it("partition", () => {
    const [evens, odds] = partition([1, 2, 3, 4], (n) => n % 2 === 0);
    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3]);
  });

  it("flatten", () => {
    expect(flatten([[1, 2], [3], [4, 5]])).toEqual([1, 2, 3, 4, 5]);
  });

  it("intersperse", () => {
    expect(intersperse([1, 2, 3], 0)).toEqual([1, 0, 2, 0, 3]);
  });

  it("sumBy / maxBy", () => {
    expect(sumBy([{ v: 1 }, { v: 2 }, { v: 3 }], (x) => x.v)).toBe(6);
    expect(maxBy([{ v: 1 }, { v: 3 }, { v: 2 }], (x) => x.v)).toEqual({ v: 3 });
  });

  it("sortBy", () => {
    expect(sortBy([3, 1, 2], (x) => x)).toEqual([1, 2, 3]);
  });

  it("rotate", () => {
    expect(rotate([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], -1)).toEqual([4, 1, 2, 3]);
  });

  it("tails", () => {
    expect(tails([1, 2, 3])).toEqual([[1, 2, 3], [2, 3], [3], []]);
  });

  it("mkString", () => {
    expect(mkString([1, 2, 3], ", ")).toBe("1, 2, 3");
    expect(mkString([1, 2, 3], ", ", "[", "]")).toBe("[1, 2, 3]");
  });
});

// ============================================================================
// Object Extensions
// ============================================================================

describe("ObjectExt", () => {
  it("pick / omit", () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({ a: 1, c: 3 });
    expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("mapValues / mapKeys", () => {
    expect(mapValues({ a: 1, b: 2 }, (v) => v * 2)).toEqual({ a: 2, b: 4 });
    expect(mapKeys({ a: 1, b: 2 }, (k) => k.toUpperCase())).toEqual({ A: 1, B: 2 });
  });

  it("invert", () => {
    expect(invert({ a: "1", b: "2" })).toEqual({ "1": "a", "2": "b" });
  });

  it("deepClone / deepEqual", () => {
    const obj = { a: { b: [1, 2] } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.a).not.toBe(obj.a);
    expect(deepEqual(obj, clone)).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("isEmpty / hasKey", () => {
    expect(isEmptyObj({})).toBe(true);
    expect(isEmptyObj({ a: 1 })).toBe(false);
    expect(hasKey({ a: 1 }, "a")).toBe(true);
    expect(hasKey({ a: 1 }, "b")).toBe(false);
  });

  it("getPath / setPath", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getPath(obj, "a.b.c")).toBe(42);
    expect(getPath(obj, "a.x.y")).toBeUndefined();
    const updated = setPath(obj, "a.b.c", 99);
    expect(updated.a.b.c).toBe(99);
    expect(obj.a.b.c).toBe(42);
  });

  it("toPairs", () => {
    expect(toPairs({ a: 1, b: 2 })).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});

// ============================================================================
// Boolean Extensions
// ============================================================================

describe("BooleanExt", () => {
  it("toInt", () => {
    expect(toInt(true)).toBe(1);
    expect(toInt(false)).toBe(0);
  });

  it("thenSome", () => {
    expect(thenSome(true, 42)).toBe(42);
    expect(thenSome(false, 42)).toBeUndefined();
  });

  it("fold", () => {
    expect(
      boolFold(
        true,
        () => "no",
        () => "yes"
      )
    ).toBe("yes");
    expect(
      boolFold(
        false,
        () => "no",
        () => "yes"
      )
    ).toBe("no");
  });

  it("toggle", () => {
    expect(toggle(true)).toBe(false);
    expect(toggle(false)).toBe(true);
  });

  it("xor / implies", () => {
    expect(xor(true, false)).toBe(true);
    expect(xor(true, true)).toBe(false);
    expect(implies(true, false)).toBe(false);
    expect(implies(false, false)).toBe(true);
  });

  it("guard", () => {
    expect(() => guard(true)).not.toThrow();
    expect(() => guard(false)).toThrow("Guard failed");
    expect(() => guard(false, "custom")).toThrow("custom");
  });

  it("toYesNo", () => {
    expect(toYesNo(true)).toBe("yes");
    expect(toYesNo(false)).toBe("no");
  });
});

// ============================================================================
// Date Extensions
// ============================================================================

describe("DateExt", () => {
  const d = new Date(2024, 0, 15, 12, 30, 0); // Jan 15, 2024 12:30:00

  it("addDays / addMonths", () => {
    expect(addDays(d, 5).getDate()).toBe(20);
    expect(addMonths(d, 1).getMonth()).toBe(1);
  });

  it("diffInDays", () => {
    const d2 = new Date(2024, 0, 20, 12, 30, 0);
    expect(diffInDays(d2, d)).toBe(5);
  });

  it("startOfDay / endOfDay", () => {
    const start = startOfDay(d);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    const end = endOfDay(d);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("startOfMonth / endOfMonth", () => {
    expect(startOfMonth(d).getDate()).toBe(1);
    expect(endOfMonth(d).getDate()).toBe(31);
  });

  it("isSameDay", () => {
    expect(isSameDay(d, new Date(2024, 0, 15, 23, 59))).toBe(true);
    expect(isSameDay(d, new Date(2024, 0, 16))).toBe(false);
  });

  it("isWeekend", () => {
    expect(isWeekend(new Date(2024, 0, 13))).toBe(true); // Saturday
    expect(isWeekend(new Date(2024, 0, 15))).toBe(false); // Monday
  });

  it("isLeapYear", () => {
    expect(isLeapYear(new Date(2024, 0, 1))).toBe(true);
    expect(isLeapYear(new Date(2023, 0, 1))).toBe(false);
  });

  it("daysInMonth", () => {
    expect(daysInMonth(new Date(2024, 1, 1))).toBe(29); // Feb 2024 (leap)
    expect(daysInMonth(new Date(2023, 1, 1))).toBe(28);
  });

  it("quarter", () => {
    expect(quarter(new Date(2024, 0, 1))).toBe(1);
    expect(quarter(new Date(2024, 5, 1))).toBe(2);
    expect(quarter(new Date(2024, 11, 1))).toBe(4);
  });

  it("eachDay", () => {
    const days = eachDay(new Date(2024, 0, 1), new Date(2024, 0, 3));
    expect(days.length).toBe(3);
  });
});

// ============================================================================
// Map/Set Extensions
// ============================================================================

describe("MapExt", () => {
  it("getOrDefault / getOrPut", () => {
    const m = new Map([["a", 1]]);
    expect(getOrDefault(m, "a", 0)).toBe(1);
    expect(getOrDefault(m, "b", 0)).toBe(0);

    const v = getOrPut(m, "b", () => 42);
    expect(v).toBe(42);
    expect(m.get("b")).toBe(42);
  });

  it("mapValues", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const result = mapMapValues(m, (v) => v * 10);
    expect(result.get("a")).toBe(10);
    expect(result.get("b")).toBe(20);
  });

  it("filter", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const result = filterMap(m, (v) => v > 1);
    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(false);
  });

  it("merge", () => {
    const a = new Map([
      ["x", 1],
      ["y", 2],
    ]);
    const b = new Map([
      ["y", 20],
      ["z", 30],
    ]);
    const result = mergeMap(a, b, (va, vb) => va + vb);
    expect(result.get("x")).toBe(1);
    expect(result.get("y")).toBe(22);
    expect(result.get("z")).toBe(30);
  });

  it("intersection / difference", () => {
    const a = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const b = new Map([
      ["b", 20],
      ["c", 30],
    ]);
    expect(mapIntersection(a, b).size).toBe(1);
    expect(mapDifference(a, b).size).toBe(1);
  });

  it("invert", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const inv = invertMap(m);
    expect(inv.get(1)).toBe("a");
    expect(inv.get(2)).toBe("b");
  });

  it("toObject", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(mapToObject(m)).toEqual({ a: 1, b: 2 });
  });
});

describe("SetExt", () => {
  it("union / intersection / difference", () => {
    const a = new Set([1, 2, 3]);
    const b = new Set([2, 3, 4]);
    expect(setUnion(a, b)).toEqual(new Set([1, 2, 3, 4]));
    expect(setIntersection(a, b)).toEqual(new Set([2, 3]));
    expect(setDifference(a, b)).toEqual(new Set([1]));
  });

  it("isSubset / isDisjoint", () => {
    expect(isSubset(new Set([1, 2]), new Set([1, 2, 3]))).toBe(true);
    expect(isSubset(new Set([1, 4]), new Set([1, 2, 3]))).toBe(false);
    expect(isDisjoint(new Set([1, 2]), new Set([3, 4]))).toBe(true);
    expect(isDisjoint(new Set([1, 2]), new Set([2, 3]))).toBe(false);
  });

  it("partition", () => {
    const [evens, odds] = setPartition(new Set([1, 2, 3, 4]), (n) => n % 2 === 0);
    expect(evens).toEqual(new Set([2, 4]));
    expect(odds).toEqual(new Set([1, 3]));
  });

  it("powerSet", () => {
    const ps = powerSet(new Set([1, 2]));
    expect(ps.size).toBe(4);
  });
});

// ============================================================================
// Tuple Extensions
// ============================================================================

describe("TupleExt", () => {
  it("pair / fst / snd", () => {
    const p = pair(1, "a");
    expect(fst(p)).toBe(1);
    expect(snd(p)).toBe("a");
  });

  it("swap", () => {
    expect(swap(pair(1, "a"))).toEqual(["a", 1]);
  });

  it("bimap", () => {
    expect(
      bimap(
        pair(1, "a"),
        (n) => n * 2,
        (s) => s.toUpperCase()
      )
    ).toEqual([2, "A"]);
  });

  it("both", () => {
    expect(both(pair(1, 2), (n) => n * 10)).toEqual([10, 20]);
  });

  it("curry / uncurry", () => {
    const add = uncurryPair((a: number, b: number) => a + b);
    expect(add(pair(1, 2))).toBe(3);

    const curried = curryPair((p: readonly [number, number]) => p[0] + p[1]);
    expect(curried(1)(2)).toBe(3);
  });

  it("triple", () => {
    const t = triple(1, "a", true);
    expect(t).toEqual([1, "a", true]);
  });

  it("zipToPairs / unzipPairs", () => {
    const pairs = zipToPairs([1, 2, 3], ["a", "b", "c"]);
    expect(pairs).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
    const [ns, ss] = unzipPairs(pairs);
    expect(ns).toEqual([1, 2, 3]);
    expect(ss).toEqual(["a", "b", "c"]);
  });
});

// ============================================================================
// Range Extensions
// ============================================================================

describe("RangeExt", () => {
  it("range (exclusive)", () => {
    expect(rangeToArray(range(1, 5))).toEqual([1, 2, 3, 4]);
  });

  it("rangeInclusive", () => {
    expect(rangeToArray(rangeInclusive(1, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("rangeBy (step)", () => {
    expect(rangeToArray(rangeBy(range(0, 10), 3))).toEqual([0, 3, 6, 9]);
  });

  it("rangeReversed", () => {
    const r = rangeReversed(rangeInclusive(1, 5));
    const arr = rangeToArray(r);
    expect(arr).toEqual([5, 4, 3, 2, 1]);
  });

  it("rangeContains", () => {
    expect(rangeContains(range(1, 10), 5)).toBe(true);
    expect(rangeContains(range(1, 10), 10)).toBe(false);
    expect(rangeContains(rangeInclusive(1, 10), 10)).toBe(true);
  });

  it("rangeMap / rangeFilter / rangeReduce", () => {
    expect(rangeMap(range(1, 4), (n) => n * n)).toEqual([1, 4, 9]);
    expect(rangeFilter(range(1, 10), (n) => n % 2 === 0)).toEqual([2, 4, 6, 8]);
    expect(rangeReduce(rangeInclusive(1, 5), 0, (acc, n) => acc + n)).toBe(15);
  });
});

// ============================================================================
// Typeclasses
// ============================================================================

describe("Typeclasses", () => {
  it("Bounded<number>", () => {
    expect(boundedNumber.minBound()).toBe(Number.MIN_SAFE_INTEGER);
    expect(boundedNumber.maxBound()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("Enum<boolean>", () => {
    expect(enumBoolean.succ(false)).toBe(true);
    expect(enumBoolean.pred(true)).toBe(false);
    expect(enumBoolean.toEnum(0)).toBe(false);
    expect(enumBoolean.fromEnum(true)).toBe(1);
  });

  it("Numeric<number>", () => {
    expect(numericNumber.add(1, 2)).toBe(3);
    expect(numericNumber.mul(3, 4)).toBe(12);
    expect(numericNumber.negate(5)).toBe(-5);
    expect(numericNumber.abs(-7)).toBe(7);
    expect(numericNumber.signum(-3)).toBe(-1);
    expect(numericNumber.fromNumber(42)).toBe(42);
  });

  it("Parseable<number>", () => {
    const ok = parseableNumber.parse("42");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toBe(42);

    const fail = parseableNumber.parse("not a number");
    expect(fail.ok).toBe(false);
  });

  it("Defaultable", () => {
    expect(defaultNumber.defaultValue()).toBe(0);
    expect(defaultString.defaultValue()).toBe("");
  });

  it("Sized", () => {
    const sa = sizedArray<number>();
    expect(sa.size([1, 2, 3])).toBe(3);
    expect(sa.isEmpty([])).toBe(true);
    expect(sizedString.size("hello")).toBe(5);
  });
});
