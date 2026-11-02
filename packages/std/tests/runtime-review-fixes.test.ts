/**
 * Deep review 1.0 — std runtime findings #18, #22–#31.
 * Every test calls the real runtime functions.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  eqNumber,
  ordNumber,
  hashNumber,
  hashString,
  boundedBigInt,
} from "../src/typeclasses/index.js";
import {
  range,
  rangeInclusive,
  rangeSize,
  rangeReversed,
  rangeToArray,
  rangeLast,
} from "../src/data/range.js";
import {
  groupBy,
  keyBy,
  countBy,
  associate,
  takeRight,
  zipObject,
} from "../src/extensions/array.js";
import {
  invert,
  fromPairs,
  mapKeys,
  deepEqual,
  pickBy,
  mapValues,
} from "../src/extensions/object.js";
import {
  toBase64,
  fromBase64,
  unescapeHtml,
  escapeHtml,
  stripMargin,
} from "../src/extensions/string.js";
import {
  formatDateTime,
  formatDate,
  formatTime,
  dayOfYear,
  weekOfYear,
} from "../src/extensions/date.js";
import { fallbackTo, timeout, timeoutOr } from "../src/extensions/promise.js";
import { memoize } from "../src/extensions/function.js";
import {
  isPrime,
  isPowerOfTwo,
  toHex,
  toBin,
  toOct,
  digits,
  rangeTo,
  rangeUntil,
  toWords,
  toOrdinal,
  toFileSize,
} from "../src/extensions/number.js";

describe("#18 std primitive Eq/Ord/Hash for number", () => {
  it("eqNumber keeps === semantics (it backs the === operator rewrite)", () => {
    expect(eqNumber.equals(NaN, NaN)).toBe(false);
    expect(eqNumber.equals(0, -0)).toBe(true);
  });

  it("ordNumber is a total order: NaN sorts last and equals itself", () => {
    expect(ordNumber.compare(NaN, NaN)).toBe(0);
    expect(ordNumber.equals(NaN, NaN)).toBe(true);
    expect(ordNumber.compare(NaN, 1)).toBe(1);
    expect(ordNumber.compare(1, NaN)).toBe(-1);
    expect(ordNumber.lessThan(1, NaN)).toBe(true);
    expect([3, NaN, 1].sort(ordNumber.compare)).toEqual([1, 3, NaN]);
    expect(ordNumber.compare(0, -0)).toBe(0);
  });

  it("hashNumber does not collapse (-1,1), NaN and ±Infinity to 0", () => {
    const values = [0, 0.25, 0.5, -0.5, NaN, Infinity, -Infinity, 2 ** 40];
    expect(new Set(values.map(hashNumber.hash)).size).toBe(values.length);
    expect(hashNumber.hash(-0)).toBe(hashNumber.hash(0));
    expect(hashNumber.hash(NaN)).toBe(hashNumber.hash(Number("x")));
    expect(Number.isInteger(hashString.hash("abc"))).toBe(true);
  });

  it("Bounded<bigint> documents that its bounds are a convention", () => {
    // bigint is unbounded; the instance mirrors boundedNumber's safe-integer range.
    expect(boundedBigInt.maxBound()).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
});

describe("#22 Range size/reversed", () => {
  it("size counts stepped and single-element ranges", () => {
    expect(rangeSize(range(0, 10, 3))).toBe(4); // 0,3,6,9
    expect(rangeSize(rangeInclusive(0, 0))).toBe(1);
    expect(rangeSize(rangeInclusive(1, 10, 2))).toBe(5);
    expect(rangeSize(range(0, 0))).toBe(0);
    expect(rangeSize(range(10, 0, -3))).toBe(4); // 10,7,4,1
    expect(rangeSize(range(0, 10, -1))).toBe(0);
  });

  it("size always matches the iterated length", () => {
    for (const r of [
      range(0, 10, 3),
      range(0, 9, 3),
      rangeInclusive(0, 9, 3),
      rangeInclusive(5, -5, -2),
      range(5, -5, -2),
      rangeInclusive(3, 3),
      range(3, 3),
    ]) {
      expect(rangeSize(r)).toBe(rangeToArray(r).length);
    }
  });

  it("reversed yields exactly the original elements backwards", () => {
    expect(rangeToArray(rangeReversed(range(0, 10)))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rangeToArray(rangeReversed(range(0, 10, 3)))).toEqual([9, 6, 3, 0]);
    expect(rangeToArray(rangeReversed(rangeInclusive(1, 10, 2)))).toEqual([9, 7, 5, 3, 1]);
    expect(rangeToArray(rangeReversed(range(0, 0)))).toEqual([]);
    expect(rangeLast(rangeReversed(range(0, 10)))).toBe(0);
  });
});

describe("#23 record builders are safe for any key", () => {
  it("groupBy/countBy/keyBy/associate handle constructor/toString/__proto__", () => {
    const keys = ["constructor", "toString", "__proto__", "hasOwnProperty"];
    const g = groupBy(keys, (k) => k);
    for (const k of keys) expect(g[k]).toEqual([k]);
    const c = countBy(keys, (k) => k);
    for (const k of keys) expect(c[k]).toBe(1);
    const kb = keyBy(keys, (k) => k);
    expect(Object.keys(kb).sort()).toEqual([...keys].sort());
    const a = associate(keys, (k) => [k, 1] as [string, number]);
    expect(Object.keys(a).sort()).toEqual([...keys].sort());
    const z = zipObject(["__proto__"], [1]);
    expect(Object.keys(z)).toEqual(["__proto__"]);
  });

  it("invert/fromPairs/mapKeys/pickBy/mapValues keep a __proto__ key as data", () => {
    expect(Object.keys(invert({ a: "__proto__" }))).toEqual(["__proto__"]);
    expect(Object.keys(fromPairs([["__proto__", 1]]))).toEqual(["__proto__"]);
    expect(Object.keys(mapKeys({ a: 1 }, () => "__proto__"))).toEqual(["__proto__"]);
    const src = JSON.parse('{"__proto__": 1}') as Record<string, number>;
    expect(Object.keys(pickBy(src, () => true))).toEqual(["__proto__"]);
    expect(Object.keys(mapValues(src, (v) => v + 1))).toEqual(["__proto__"]);
  });
});

describe("#24 deepEqual", () => {
  it("compares Dates, Maps, Sets, RegExps by content", () => {
    expect(deepEqual(new Date(1), new Date(2))).toBe(false);
    expect(deepEqual(new Date(1), new Date(1))).toBe(true);
    expect(deepEqual(new Map([[1, 2]]), new Map([[1, 3]]))).toBe(false);
    expect(deepEqual(new Map([[1, { a: 1 }]]), new Map([[1, { a: 1 }]]))).toBe(true);
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(deepEqual(/a/g, /a/i)).toBe(false);
    expect(deepEqual(/a/g, /a/g)).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  });

  it("arrays are not equal to array-like objects", () => {
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual({ 0: 1 }, [1])).toBe(false);
  });

  it("NaN equals NaN; different prototypes differ", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual({ a: NaN }, { a: NaN })).toBe(true);
    class P {
      x = 1;
    }
    expect(deepEqual(new P(), { x: 1 })).toBe(false);
  });

  it("handles cycles", () => {
    const a: Record<string, unknown> = { v: 1 };
    a.self = a;
    const b: Record<string, unknown> = { v: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
  });
});

describe("#25 takeRight", () => {
  it("takeRight(arr, 0) is empty", () => {
    expect(takeRight([1, 2, 3], 0)).toEqual([]);
    expect(takeRight([1, 2, 3], -1)).toEqual([]);
    expect(takeRight([1, 2, 3], 2)).toEqual([2, 3]);
    expect(takeRight([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});

describe("#26 base64 is UTF-8", () => {
  it("round-trips non-Latin-1 text and matches Buffer's UTF-8 encoding", () => {
    for (const s of ["héllo", "日本語", "emoji 😀", "", "plain"]) {
      expect(toBase64(s)).toBe(Buffer.from(s, "utf8").toString("base64"));
      expect(fromBase64(toBase64(s))).toBe(s);
    }
  });
});

describe("#27 date formatting/day-of-year", () => {
  it("formatDateTime uses the same (local) calendar for date and time", () => {
    const d = new Date(2024, 0, 1, 0, 30, 15); // local midnight-ish
    expect(formatDate(d)).toBe("2024-01-01");
    expect(formatTime(d)).toBe("00:30:15");
    expect(formatDateTime(d)).toBe("2024-01-01 00:30:15");
  });

  it("dayOfYear counts calendar days regardless of DST", () => {
    // Node re-reads process.env.TZ on assignment; use a zone with DST.
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(dayOfYear(new Date(2024, 2, 11, 0, 0))).toBe(71); // day after DST start
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
    expect(dayOfYear(new Date(2024, 0, 1, 0, 0))).toBe(1);
    expect(dayOfYear(new Date(2024, 11, 31, 23, 59))).toBe(366);
    // Every day of the year, at 00:00 local, is exactly one more than the previous day.
    for (let i = 0; i < 366; i++) {
      expect(dayOfYear(new Date(2024, 0, 1 + i, 0, 0))).toBe(i + 1);
    }
  });

  it("weekOfYear is stable within a day", () => {
    const morning = weekOfYear(new Date(2024, 0, 6, 0, 0));
    const evening = weekOfYear(new Date(2024, 0, 6, 23, 0));
    expect(morning).toBe(evening);
  });
});

describe("#28 promise helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("fallbackTo does not leave a rejected fallback unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const v = await fallbackTo(Promise.resolve(1), Promise.reject(new Error("fb")));
      expect(v).toBe(1);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("fallbackTo still surfaces a fallback rejection when it is used", async () => {
    await expect(
      fallbackTo(Promise.reject(new Error("a")), Promise.reject(new Error("b")))
    ).rejects.toThrow("b");
  });

  it("timeout/timeoutOr clear their timer when the promise settles first", async () => {
    vi.useFakeTimers();
    await timeout(Promise.resolve(1), 10_000);
    expect(vi.getTimerCount()).toBe(0);
    await timeoutOr(Promise.resolve(1), 10_000, 2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("timeout still rejects after ms", async () => {
    await expect(timeout(new Promise(() => {}), 5, "late")).rejects.toThrow("late");
  });
});

describe("#29 string escaping", () => {
  it("unescapeHtml decodes once (no double decoding)", () => {
    expect(unescapeHtml("&amp;lt;")).toBe("&lt;");
    expect(unescapeHtml(escapeHtml("<a href='x'>&amp;</a>"))).toBe("<a href='x'>&amp;</a>");
  });

  it("stripMargin treats marginChar literally", () => {
    expect(stripMargin("  db\n  dc", "d")).toBe("b\nc");
    expect(stripMargin("  .x\n  .y", ".")).toBe("x\ny");
    expect(stripMargin("  ab1\n  ab2", "ab")).toBe("1\n2");
    expect(stripMargin("  |a\n\n  |b")).toBe("a\n\nb");
  });
});

describe("#30 memoize default key", () => {
  it("does not throw on BigInt and keeps undefined/null/NaN distinct", () => {
    let calls = 0;
    const f = memoize((x: unknown) => {
      calls++;
      return typeof x;
    });
    expect(f(1n)).toBe("bigint");
    expect(f(undefined)).toBe("undefined");
    expect(f(null)).toBe("object");
    expect(f(NaN)).toBe("number");
    expect(f(1n)).toBe("bigint");
    expect(calls).toBe(4);
  });

  it("still caches structurally equal object args", () => {
    let calls = 0;
    const f = memoize((o: { a: number }) => (calls++, o.a));
    f({ a: 1 });
    f({ a: 1 });
    expect(calls).toBe(1);
  });

  it("supports a bounded cache (maxSize)", () => {
    let calls = 0;
    const f = memoize((n: number) => (calls++, n * 2), undefined, 2);
    f(1);
    f(2);
    f(3); // evicts 1
    f(1);
    expect(calls).toBe(4);
    f(3);
    expect(calls).toBe(4);
  });
});

describe("#31 number helpers", () => {
  it("isPrime rejects non-integers", () => {
    expect(isPrime(4.5)).toBe(false);
    expect(isPrime(7)).toBe(true);
  });

  it("isPowerOfTwo/toHex/toBin/toOct are not limited to 32 bits", () => {
    expect(isPowerOfTwo(2 ** 32)).toBe(true);
    expect(isPowerOfTwo(2 ** 32 + 1)).toBe(false);
    expect(isPowerOfTwo(0.5)).toBe(false);
    expect(toHex(2 ** 32)).toBe("100000000");
    expect(toBin(2 ** 33)).toBe("1" + "0".repeat(33));
    expect(toOct(2 ** 33)).toBe((2 ** 33).toString(8));
    expect(toHex(255)).toBe("ff");
  });

  it("digits/rangeTo reject parameters that would loop forever", () => {
    expect(() => digits(10, 1)).toThrow(RangeError);
    expect(() => digits(10, 0)).toThrow(RangeError);
    expect(() => rangeTo(5, 1, 0)).toThrow(RangeError);
    expect(() => rangeUntil(1, 5, 0)).toThrow(RangeError);
  });

  it("toWords/toOrdinal/toFileSize edge cases", () => {
    expect(toWords(-0.5)).toBe("zero");
    expect(toWords(-1.5)).toBe("negative one");
    expect(toOrdinal(-1)).toBe("-1st");
    expect(toOrdinal(-12)).toBe("-12th");
    expect(toFileSize(0.5)).toBe("0.5 B");
    expect(toFileSize(-2048)).toBe("-2 KB");
  });
});
