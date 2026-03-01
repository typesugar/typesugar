import { describe, it, expect } from "vitest";
import { LazyPipeline } from "../lazy.js";
import { lazy, range, iterate, repeat, generate } from "../lazy-entry.js";

// ---------------------------------------------------------------------------
// Helper: counting iterable to verify single-pass behavior
// ---------------------------------------------------------------------------

function counted<T>(source: Iterable<T>): { iterable: Iterable<T>; reads: () => number } {
  let reads = 0;
  const iterable: Iterable<T> = {
    [Symbol.iterator]() {
      const iter = source[Symbol.iterator]();
      return {
        next() {
          const result = iter.next();
          if (!result.done) reads++;
          return result;
        },
      };
    },
  };
  return { iterable, reads: () => reads };
}

// ===========================================================================
// Single operations
// ===========================================================================

describe("LazyPipeline — single operations", () => {
  it("map transforms elements", () => {
    expect(
      lazy([1, 2, 3])
        .map((x) => x * 2)
        .toArray()
    ).toEqual([2, 4, 6]);
  });

  it("filter keeps matching elements", () => {
    expect(
      lazy([1, 2, 3, 4, 5])
        .filter((x) => x % 2 === 0)
        .toArray()
    ).toEqual([2, 4]);
  });

  it("flatMap expands and flattens", () => {
    expect(
      lazy([1, 2, 3])
        .flatMap((x) => [x, x * 10])
        .toArray()
    ).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it("take limits output", () => {
    expect(lazy([1, 2, 3, 4, 5]).take(3).toArray()).toEqual([1, 2, 3]);
  });

  it("drop skips elements", () => {
    expect(lazy([1, 2, 3, 4, 5]).drop(2).toArray()).toEqual([3, 4, 5]);
  });

  it("takeWhile stops at first failure", () => {
    expect(
      lazy([1, 2, 3, 4, 1])
        .takeWhile((x) => x < 3)
        .toArray()
    ).toEqual([1, 2]);
  });

  it("dropWhile skips initial matching elements", () => {
    expect(
      lazy([1, 2, 3, 2, 1])
        .dropWhile((x) => x < 3)
        .toArray()
    ).toEqual([3, 2, 1]);
  });
});

// ===========================================================================
// Chained operations
// ===========================================================================

describe("LazyPipeline — chained operations", () => {
  it("filter then map", () => {
    expect(
      lazy([1, 2, 3, 4, 5])
        .filter((x) => x % 2 === 0)
        .map((x) => x * 10)
        .toArray()
    ).toEqual([20, 40]);
  });

  it("map then filter then take", () => {
    expect(
      lazy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        .map((x) => x * 2)
        .filter((x) => x > 5)
        .take(3)
        .toArray()
    ).toEqual([6, 8, 10]);
  });

  it("drop then filter then map", () => {
    expect(
      lazy([1, 2, 3, 4, 5, 6])
        .drop(2)
        .filter((x) => x % 2 === 0)
        .map((x) => x * 100)
        .toArray()
    ).toEqual([400, 600]);
  });

  it("flatMap then filter", () => {
    expect(
      lazy([1, 2, 3])
        .flatMap((x) => [x, -x])
        .filter((x) => x > 0)
        .toArray()
    ).toEqual([1, 2, 3]);
  });

  it("filter then flatMap then take", () => {
    expect(
      lazy([1, 2, 3, 4])
        .filter((x) => x % 2 === 0)
        .flatMap((x) => [x, x + 100])
        .take(3)
        .toArray()
    ).toEqual([2, 102, 4]);
  });
});

// ===========================================================================
// zip, scan, distinct, partition
// ===========================================================================

describe("LazyPipeline — zip, scan, distinct, partition", () => {
  it("zip pairs elements from two iterables", () => {
    expect(lazy([1, 2, 3]).zip([10, 20, 30]).toArray()).toEqual([
      [1, 10],
      [2, 20],
      [3, 30],
    ]);
  });

  it("zip stops when shorter iterable is exhausted", () => {
    expect(lazy([1, 2, 3, 4]).zip([10, 20]).toArray()).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });

  it("scan emits running accumulated values", () => {
    expect(
      lazy([1, 2, 3, 4])
        .scan((acc, x) => acc + x, 0)
        .toArray()
    ).toEqual([1, 3, 6, 10]);
  });

  it("distinct removes duplicates", () => {
    expect(lazy([1, 2, 2, 3, 1, 3, 2]).distinct().toArray()).toEqual([1, 2, 3]);
  });

  it("distinct with keyFn uses key for uniqueness", () => {
    expect(
      lazy([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }])
        .distinct((x) => x.id)
        .toArray()
    ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("partition splits into pass and fail arrays", () => {
    const [evens, odds] = lazy([1, 2, 3, 4, 5]).partition((x) => x % 2 === 0);
    expect(evens).toEqual([2, 4]);
    expect(odds).toEqual([1, 3, 5]);
  });

  it("zip then map", () => {
    expect(
      lazy([1, 2, 3])
        .zip([10, 20, 30])
        .map(([a, b]) => a + b)
        .toArray()
    ).toEqual([11, 22, 33]);
  });

  it("filter then distinct", () => {
    expect(
      lazy([1, 2, 2, 3, 1, 4])
        .filter((x) => x > 1)
        .distinct()
        .toArray()
    ).toEqual([2, 3, 4]);
  });
});

// ===========================================================================
// Terminal operations
// ===========================================================================

describe("LazyPipeline — terminal operations", () => {
  it("reduce accumulates", () => {
    expect(lazy([1, 2, 3, 4]).reduce((acc, x) => acc + x, 0)).toBe(10);
  });

  it("find returns first match", () => {
    expect(lazy([1, 2, 3, 4, 5]).find((x) => x > 3)).toBe(4);
  });

  it("find returns null when no match", () => {
    expect(lazy([1, 2, 3]).find((x) => x > 10)).toBe(null);
  });

  it("some returns true when match exists", () => {
    expect(lazy([1, 2, 3]).some((x) => x === 2)).toBe(true);
  });

  it("some returns false when no match", () => {
    expect(lazy([1, 2, 3]).some((x) => x === 5)).toBe(false);
  });

  it("every returns true when all match", () => {
    expect(lazy([2, 4, 6]).every((x) => x % 2 === 0)).toBe(true);
  });

  it("every returns false when any fails", () => {
    expect(lazy([2, 4, 5]).every((x) => x % 2 === 0)).toBe(false);
  });

  it("count counts elements", () => {
    expect(
      lazy([1, 2, 3, 4, 5])
        .filter((x) => x > 2)
        .count()
    ).toBe(3);
  });

  it("forEach executes for each element", () => {
    const seen: number[] = [];
    lazy([1, 2, 3]).forEach((x) => seen.push(x));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("first returns first element", () => {
    expect(lazy([10, 20, 30]).first()).toBe(10);
  });

  it("first returns null for empty", () => {
    expect(lazy([]).first()).toBe(null);
  });

  it("last returns last element", () => {
    expect(lazy([10, 20, 30]).last()).toBe(30);
  });

  it("last returns null for empty", () => {
    expect(lazy([]).last()).toBe(null);
  });
});

// ===========================================================================
// Aggregation operations
// ===========================================================================

describe("LazyPipeline — aggregations", () => {
  it("sum adds numbers", () => {
    expect(lazy([1, 2, 3, 4]).sum()).toBe(10);
  });

  it("sum of empty is 0", () => {
    expect(lazy([] as number[]).sum()).toBe(0);
  });

  it("min returns minimum", () => {
    expect(lazy([3, 1, 4, 1, 5]).min()).toBe(1);
  });

  it("min returns null for empty", () => {
    expect(lazy([] as number[]).min()).toBe(null);
  });

  it("max returns maximum", () => {
    expect(lazy([3, 1, 4, 1, 5]).max()).toBe(5);
  });

  it("max with custom comparator", () => {
    expect(lazy(["a", "ccc", "bb"]).max((a, b) => a.length - b.length)).toBe("ccc");
  });

  it("join concatenates strings", () => {
    expect(lazy(["a", "b", "c"]).join("-")).toBe("a-b-c");
  });

  it("join with default separator", () => {
    expect(lazy(["x", "y"]).join()).toBe("x,y");
  });

  it("toMap builds a Map", () => {
    const m = lazy(["a", "bb", "ccc"]).toMap(
      (s) => s,
      (s) => s.length
    );
    expect(m.get("a")).toBe(1);
    expect(m.get("bb")).toBe(2);
    expect(m.get("ccc")).toBe(3);
  });

  it("groupBy groups elements", () => {
    const groups = lazy([1, 2, 3, 4, 5, 6]).groupBy((x) => (x % 2 === 0 ? "even" : "odd"));
    expect(groups.get("even")).toEqual([2, 4, 6]);
    expect(groups.get("odd")).toEqual([1, 3, 5]);
  });
});

// ===========================================================================
// Single-pass verification
// ===========================================================================

describe("LazyPipeline — single-pass guarantee", () => {
  it("iterates source exactly once for filter+map+toArray", () => {
    const { iterable, reads } = counted([1, 2, 3, 4, 5]);
    lazy(iterable)
      .filter((x) => x % 2 === 0)
      .map((x) => x * 10)
      .toArray();
    expect(reads()).toBe(5);
  });

  it("iterates source exactly once for reduce", () => {
    const { iterable, reads } = counted([1, 2, 3]);
    lazy(iterable).reduce((a, b) => a + b, 0);
    expect(reads()).toBe(3);
  });

  it("iterates source exactly once for chained operations", () => {
    const { iterable, reads } = counted([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    lazy(iterable)
      .map((x) => x * 2)
      .filter((x) => x > 5)
      .take(3)
      .toArray();
    // take(3) should stop early — only reads up to the 5th source element
    // (1→2 skip, 2→4 skip, 3→6 emit, 4→8 emit, 5→10 emit → done)
    expect(reads()).toBe(5);
  });
});

// ===========================================================================
// Early termination
// ===========================================================================

describe("LazyPipeline — early termination", () => {
  it("take(3) on large array only iterates what's needed", () => {
    const { iterable, reads } = counted(Array.from({ length: 10000 }, (_, i) => i));
    lazy(iterable).take(3).toArray();
    expect(reads()).toBe(3);
  });

  it("find stops after finding", () => {
    const { iterable, reads } = counted([1, 2, 3, 4, 5]);
    const result = lazy(iterable).find((x) => x === 3);
    expect(result).toBe(3);
    expect(reads()).toBe(3);
  });

  it("some stops after first match", () => {
    const { iterable, reads } = counted([1, 2, 3, 4, 5]);
    const result = lazy(iterable).some((x) => x === 2);
    expect(result).toBe(true);
    expect(reads()).toBe(2);
  });

  it("takeWhile stops at first failure", () => {
    const { iterable, reads } = counted([1, 2, 3, 4, 5]);
    lazy(iterable)
      .takeWhile((x) => x < 3)
      .toArray();
    // Reads 1 (emit), 2 (emit), 3 (fails → stop)
    expect(reads()).toBe(3);
  });
});

// ===========================================================================
// Infinite sources
// ===========================================================================

describe("LazyPipeline — infinite sources", () => {
  it("iterate with take terminates", () => {
    expect(
      iterate(1, (x) => x * 2)
        .take(5)
        .toArray()
    ).toEqual([1, 2, 4, 8, 16]);
  });

  it("repeat with take terminates", () => {
    expect(repeat("x").take(3).toArray()).toEqual(["x", "x", "x"]);
  });

  it("generate with take terminates", () => {
    let counter = 0;
    expect(
      generate(() => counter++)
        .take(4)
        .toArray()
    ).toEqual([0, 1, 2, 3]);
  });

  it("range generates correct sequence", () => {
    expect(range(0, 5).toArray()).toEqual([0, 1, 2, 3, 4]);
  });

  it("range with custom step", () => {
    expect(range(0, 10, 3).toArray()).toEqual([0, 3, 6, 9]);
  });

  it("range with negative step", () => {
    expect(range(5, 0, -1).toArray()).toEqual([5, 4, 3, 2, 1]);
  });

  it("infinite iterate with filter and take", () => {
    const evens = iterate(0, (x) => x + 1)
      .filter((x) => x % 2 === 0)
      .take(5)
      .toArray();
    expect(evens).toEqual([0, 2, 4, 6, 8]);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("LazyPipeline — edge cases", () => {
  it("empty source produces empty array", () => {
    expect(lazy([]).toArray()).toEqual([]);
  });

  it("all elements filtered out", () => {
    expect(
      lazy([1, 2, 3])
        .filter(() => false)
        .toArray()
    ).toEqual([]);
  });

  it("take(0) produces empty", () => {
    expect(lazy([1, 2, 3]).take(0).toArray()).toEqual([]);
  });

  it("drop more than length", () => {
    expect(lazy([1, 2]).drop(10).toArray()).toEqual([]);
  });

  it("empty source with chained ops", () => {
    expect(
      lazy([] as number[])
        .map((x) => x * 2)
        .filter((x) => x > 0)
        .take(5)
        .toArray()
    ).toEqual([]);
  });

  it("single element pipeline", () => {
    expect(
      lazy([42])
        .map((x) => x + 1)
        .toArray()
    ).toEqual([43]);
  });

  it("flatMap to empty iterables produces empty", () => {
    expect(
      lazy([1, 2, 3])
        .flatMap(() => [])
        .toArray()
    ).toEqual([]);
  });

  it("every on empty is true (vacuous truth)", () => {
    expect(lazy([]).every(() => false)).toBe(true);
  });

  it("some on empty is false", () => {
    expect(lazy([]).some(() => true)).toBe(false);
  });

  it("count of empty is 0", () => {
    expect(lazy([]).count()).toBe(0);
  });

  it("works with Set as source", () => {
    expect(
      lazy(new Set([3, 1, 2]))
        .map((x) => x * 10)
        .toArray()
        .sort((a, b) => a - b)
    ).toEqual([10, 20, 30]);
  });

  it("works with Map as source", () => {
    const m = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(
      lazy(m)
        .map(([k, v]) => `${k}=${v}`)
        .toArray()
        .sort()
    ).toEqual(["a=1", "b=2"]);
  });

  it("works with generator as source", () => {
    function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    expect(
      lazy(gen())
        .map((x) => x * 2)
        .toArray()
    ).toEqual([2, 4, 6]);
  });
});

// ===========================================================================
// Correctness — compare against eager equivalents
// ===========================================================================

describe("LazyPipeline — correctness vs eager", () => {
  const data = Array.from({ length: 100 }, (_, i) => i);

  it("filter+map matches eager", () => {
    const pred = (x: number) => x % 3 === 0;
    const fn = (x: number) => x * x;
    const eager = data.filter(pred).map(fn);
    const fused = lazy(data).filter(pred).map(fn).toArray();
    expect(fused).toEqual(eager);
  });

  it("map+filter matches eager", () => {
    const fn = (x: number) => x * 2 - 50;
    const pred = (x: number) => x > 0;
    const eager = data.map(fn).filter(pred);
    const fused = lazy(data).map(fn).filter(pred).toArray();
    expect(fused).toEqual(eager);
  });

  it("flatMap+filter+take matches eager", () => {
    const expand = (x: number) => [x, x + 1000];
    const pred = (x: number) => x % 2 === 0;
    const eager = data.flatMap(expand).filter(pred).slice(0, 10);
    const fused = lazy(data).flatMap(expand).filter(pred).take(10).toArray();
    expect(fused).toEqual(eager);
  });

  it("reduce matches eager", () => {
    const eager = data.filter((x) => x > 50).reduce((a, b) => a + b, 0);
    const fused = lazy(data)
      .filter((x) => x > 50)
      .reduce((a, b) => a + b, 0);
    expect(fused).toBe(eager);
  });
});
