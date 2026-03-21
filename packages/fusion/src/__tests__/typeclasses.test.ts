import { describe, it, expect } from "vitest";
import { lazy } from "../lazy-entry.js";
import {
  lazyPipelineFunctor,
  lazyPipelineFilterable,
  lazyPipelineFoldable,
  liftLazy,
  filterMap,
  foldLazy,
} from "../typeclasses.js";
import { getInstances } from "@typesugar/macros";

// ============================================================================
// Functor<LazyPipeline>
// ============================================================================

describe("Functor<LazyPipeline>", () => {
  it("map transforms elements via the Functor instance", () => {
    const result = lazyPipelineFunctor.map(lazy([1, 2, 3]), (x) => x * 10).toArray();
    expect(result).toEqual([10, 20, 30]);
  });

  it("satisfies identity law: map(id) === id", () => {
    const source = [1, 2, 3, 4, 5];
    const result = lazyPipelineFunctor.map(lazy(source), (x) => x).toArray();
    expect(result).toEqual(source);
  });

  it("satisfies composition law: map(f).map(g) === map(g . f)", () => {
    const source = [1, 2, 3];
    const f = (x: number) => x + 1;
    const g = (x: number) => x * 2;

    const composed = lazyPipelineFunctor.map(lazyPipelineFunctor.map(lazy(source), f), g).toArray();
    const direct = lazyPipelineFunctor.map(lazy(source), (x) => g(f(x))).toArray();

    expect(composed).toEqual(direct);
  });
});

// ============================================================================
// Filterable<LazyPipeline>
// ============================================================================

describe("Filterable<LazyPipeline>", () => {
  it("filter keeps matching elements via the Filterable instance", () => {
    const result = lazyPipelineFilterable
      .filter(lazy([1, 2, 3, 4, 5]), (x) => x % 2 === 0)
      .toArray();
    expect(result).toEqual([2, 4]);
  });

  it("filter with always-true predicate returns all elements", () => {
    const result = lazyPipelineFilterable.filter(lazy([1, 2, 3]), () => true).toArray();
    expect(result).toEqual([1, 2, 3]);
  });

  it("filter with always-false predicate returns empty", () => {
    const result = lazyPipelineFilterable.filter(lazy([1, 2, 3]), () => false).toArray();
    expect(result).toEqual([]);
  });
});

// ============================================================================
// Foldable<LazyPipeline>
// ============================================================================

describe("Foldable<LazyPipeline>", () => {
  it("foldLeft accumulates left-to-right", () => {
    const result = lazyPipelineFoldable.foldLeft(lazy([1, 2, 3, 4]), 0, (acc, x) => acc + x);
    expect(result).toBe(10);
  });

  it("foldRight accumulates right-to-left", () => {
    const result = lazyPipelineFoldable.foldRight(lazy(["a", "b", "c"]), "", (x, acc) => x + acc);
    expect(result).toBe("abc");
  });

  it("foldLeft with string concatenation preserves order", () => {
    const result = lazyPipelineFoldable.foldLeft(lazy(["a", "b", "c"]), "", (acc, x) => acc + x);
    expect(result).toBe("abc");
  });

  it("foldRight with subtraction differs from foldLeft", () => {
    // (1 - (2 - (3 - 0))) = 1 - (2 - 3) = 1 - (-1) = 2
    const rightResult = lazyPipelineFoldable.foldRight(lazy([1, 2, 3]), 0, (a, b) => a - b);
    expect(rightResult).toBe(2);

    // ((0 - 1) - 2) - 3 = -6
    const leftResult = lazyPipelineFoldable.foldLeft(lazy([1, 2, 3]), 0, (acc, x) => acc - x);
    expect(leftResult).toBe(-6);
  });

  it("foldLeft on empty pipeline returns init", () => {
    const result = lazyPipelineFoldable.foldLeft(lazy([] as number[]), 42, (acc, x) => acc + x);
    expect(result).toBe(42);
  });

  it("foldRight on empty pipeline returns init", () => {
    const result = lazyPipelineFoldable.foldRight(lazy([] as number[]), 42, (x, acc) => x + acc);
    expect(result).toBe(42);
  });
});

// ============================================================================
// Convenience combinators
// ============================================================================

describe("Convenience combinators", () => {
  it("liftLazy lifts a function to work on pipelines", () => {
    const double = liftLazy((x: number) => x * 2);
    const result = double(lazy([1, 2, 3])).toArray();
    expect(result).toEqual([2, 4, 6]);
  });

  it("filterMap applies map then filter", () => {
    const result = filterMap(
      lazy([1, 2, 3, 4, 5]),
      (x) => x * 2,
      (x) => x > 5
    ).toArray();
    expect(result).toEqual([6, 8, 10]);
  });

  it("foldLazy folds a pipeline", () => {
    const result = foldLazy(lazy([1, 2, 3, 4]), 0, (acc, x) => acc + x);
    expect(result).toBe(10);
  });
});

// ============================================================================
// Integration: Functor + Filterable + Foldable composed
// ============================================================================

describe("Typeclass composition", () => {
  it("map + filter + fold via typeclass instances", () => {
    const pipeline = lazy([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mapped = lazyPipelineFunctor.map(pipeline, (x) => x * 2);
    const filtered = lazyPipelineFilterable.filter(mapped, (x) => x > 10);
    const sum = lazyPipelineFoldable.foldLeft(filtered, 0, (acc, x) => acc + x);
    // x*2 > 10 means x > 5: doubles of 6..10 = 12+14+16+18+20 = 80
    expect(sum).toBe(80);
  });

  it("chained filterMap + fold composes all three typeclasses", () => {
    const pipeline = lazy([1, 2, 3, 4, 5, 6, 7, 8]);
    const transformed = filterMap(
      pipeline,
      (x) => x * 3,
      (x) => x > 10
    );
    const product = lazyPipelineFoldable.foldLeft(transformed, 1, (acc, x) => acc * x);
    // x*3 > 10 means x > 3.33: 4*3=12, 5*3=15, 6*3=18, 7*3=21, 8*3=24
    // product = 12 * 15 * 18 * 21 * 24 = 1_632_960
    expect(product).toBe(12 * 15 * 18 * 21 * 24);
  });
});

// ============================================================================
// @op typeclass registration — instances registered with the global registry
// ============================================================================

describe("@op typeclass registration", () => {
  it("Functor<LazyPipeline> is registered in the instance registry", () => {
    // Importing typeclasses.ts triggers registerInstanceWithMeta calls
    const instances = getInstances();
    const entry = instances.get("Functor<LazyPipeline>");
    expect(entry).toBeDefined();
    expect(entry!.instanceName).toBe("lazyPipelineFunctor");
    expect(entry!.sourceModule).toBe("@typesugar/fusion");
  });

  it("Filterable<LazyPipeline> is registered in the instance registry", () => {
    const instances = getInstances();
    const entry = instances.get("Filterable<LazyPipeline>");
    expect(entry).toBeDefined();
    expect(entry!.instanceName).toBe("lazyPipelineFilterable");
    expect(entry!.sourceModule).toBe("@typesugar/fusion");
  });

  it("Foldable<LazyPipeline> is registered in the instance registry", () => {
    const instances = getInstances();
    const entry = instances.get("Foldable<LazyPipeline>");
    expect(entry).toBeDefined();
    expect(entry!.instanceName).toBe("lazyPipelineFoldable");
    expect(entry!.sourceModule).toBe("@typesugar/fusion");
  });

  it("all three LazyPipeline instances are not marked as derived", () => {
    const instances = getInstances();
    for (const tc of ["Functor", "Filterable", "Foldable"]) {
      const entry = instances.get(`${tc}<LazyPipeline>`);
      expect(entry).toBeDefined();
      expect(entry!.derived).toBe(false);
    }
  });
});
