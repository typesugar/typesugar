/**
 * Typeclass derived-op regression tests (deep-review findings #10, #14-#17, #20, #22).
 */
import { describe, it, expect } from "vitest";
import { attempt, fromEither } from "./monad-error.js";
import { separate } from "./alternative.js";
import { traverseFilter } from "./traverse.js";
import { mfilter, whileM } from "./monad.js";
import { replicateA } from "./applicative.js";
import { product3, product4, product5 } from "./semigroupal.js";
import { ordNumber } from "./eq.js";
import { semigroupRecord } from "./semigroup.js";
import { ordLaws } from "../laws/eq.js";
import {
  eitherMonadError,
  arrayMonad,
  arrayTraverse,
  arrayAlternative,
  optionMonad,
} from "../instances.js";
import { flatMapOption, flatMapIO, flatMapList } from "../instances.js";
import { Some, None, type Option } from "../data/option.js";
import { fromArray, toArray } from "../data/list.js";
import { IO, unsafeRunIO } from "../io/io.js";
import { Left, Right, isRight } from "../data/either.js";
import type { Either } from "../data/either.js";

describe("MonadError / Alternative use the real Either (#10)", () => {
  const ME = eitherMonadError<string>();

  it("fromEither(Right(1)) is Right(1)", () => {
    expect(fromEither(ME as never)(Right(1)) as unknown).toEqual(Right(1));
  });

  it("fromEither(Left(e)) is Left(e)", () => {
    expect(fromEither(ME as never)(Left("bad")) as unknown).toEqual(Left("bad"));
  });

  it("attempt produces the package's Either shape", () => {
    const r = attempt(ME as never)(Left("bad") as never) as unknown as Either<
      string,
      Either<string, number>
    >;
    expect(isRight(r)).toBe(true);
    expect((r as { right: unknown }).right).toEqual(Left("bad"));
  });

  it("separate splits real Eithers", () => {
    const { left, right } = separate({ ...arrayAlternative, flatMap: arrayMonad.flatMap } as never)(
      [Left(1), Right("a"), Left(2)] as never
    ) as unknown as { left: number[]; right: string[] };
    expect(left).toEqual([1, 2]);
    expect(right).toEqual(["a"]);
  });
});

describe("traverseFilter returns F<B>, not nested arrays (#14)", () => {
  it("drops undefined results", () => {
    const tf = traverseFilter({
      ...arrayTraverse,
      filterMap: <A, B>(fa: A[], f: (a: A) => B | undefined) =>
        fa.map(f).filter((b): b is B => b !== undefined),
    } as never)(optionMonad as never);
    const r = (tf as unknown as (fa: number[], f: (a: number) => unknown) => unknown)(
      [1, 2, 3],
      (x) => (x === 2 ? undefined : x)
    );
    expect(r).toEqual([1, 3]);
  });
});

describe("mfilter keeps each element once (#15)", () => {
  it("[1,2,3] filtered by >1 is [2,3]", () => {
    const r = mfilter(arrayMonad as never, [] as never)([1, 2, 3] as never, (x: number) => x > 1);
    expect(r).toEqual([2, 3]);
  });
});

describe("product3/4/5 return flat tuples (#16)", () => {
  const F = optionMonad as never;
  const P = {
    product: <A, B>(fa: A | null, fb: B | null): [A, B] | null =>
      fa === null || fb === null ? null : [fa, fb],
    map: optionMonad.map,
  } as never;
  void F;
  it("product3", () => expect(product3(P)(1 as never, 2 as never, 3 as never)).toEqual([1, 2, 3]));
  it("product4", () =>
    expect(product4(P)(1 as never, 2 as never, 3 as never, 4 as never)).toEqual([1, 2, 3, 4]));
  it("product5", () =>
    expect(product5(P)(1 as never, 2 as never, 3 as never, 4 as never, 5 as never)).toEqual([
      1, 2, 3, 4, 5,
    ]));
});

describe("ordNumber is a lawful total order including NaN (#17)", () => {
  it("NaN equals itself and sorts last", () => {
    expect(ordNumber.eqv(NaN, NaN)).toBe(true);
    expect(ordNumber.compare(NaN, 1)).toBe(1);
    expect(ordNumber.compare(1, NaN)).toBe(-1);
    expect(ordNumber.compare(NaN, NaN)).toBe(0);
    expect(ordNumber.lessThan(1, NaN)).toBe(true);
    expect(ordNumber.compare(-0, 0)).toBe(0);
    expect([3, NaN, 1].sort(ordNumber.compare)).toEqual([1, 3, NaN]);
  });

  it("passes its own ordLaws with NaN in the sample", () => {
    const samples = [NaN, -1, 0, -0, 1, Infinity, -Infinity];
    for (const law of ordLaws(ordNumber) as unknown as Array<{
      name: string;
      arity: number;
      check: (...xs: number[]) => boolean;
    }>) {
      const combos: number[][] =
        law.arity === 1
          ? samples.map((x) => [x])
          : law.arity === 2
            ? samples.flatMap((x) => samples.map((y) => [x, y]))
            : samples.flatMap((x) => samples.flatMap((y) => samples.map((z) => [x, y, z])));
      for (const args of combos) {
        expect([law.name, args, law.check(...args)]).toEqual([law.name, args, true]);
      }
    }
  });
});

describe("semigroupRecord only combines own keys (#20)", () => {
  const S = semigroupRecord<string, number>({ combine: (a, b) => a + b });

  it("a 'constructor' key is not combined with Object.prototype.constructor", () => {
    expect(S.combine({ a: 1 }, { constructor: 2 } as Record<string, number>)).toEqual({
      a: 1,
      constructor: 2,
    });
  });

  it("a '__proto__' key is stored as data, not as the prototype", () => {
    const y = JSON.parse('{"__proto__": 5}') as Record<string, number>;
    const r = S.combine({ a: 1 }, y);
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(r, "__proto__")).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["__proto__", "a"]);
  });

  it("still combines shared keys", () => {
    expect(S.combine({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 5 });
  });
});

describe("generic loops are linear and safe for non-deterministic F (#22)", () => {
  it("arrayTraverse over 20k elements is fast", () => {
    const xs = Array.from({ length: 20000 }, (_, i) => i);
    const t = Date.now();
    const r = arrayTraverse.traverse(optionMonad as never)(xs, (x) => x as never) as unknown;
    expect(Date.now() - t).toBeLessThan(1000);
    expect((r as number[]).length).toBe(20000);
  });

  it("arrayTraverse with the Array applicative still enumerates all combinations", () => {
    const r = arrayTraverse.traverse(arrayMonad as never)([1, 2], (x) => [x, x * 10] as never);
    expect(r).toEqual([
      [1, 2],
      [1, 20],
      [10, 2],
      [10, 20],
    ]);
  });

  it("replicateA with the Array applicative", () => {
    expect(replicateA(arrayMonad as never)(2, ["a", "b"] as never)).toEqual([
      ["a", "a"],
      ["a", "b"],
      ["b", "a"],
      ["b", "b"],
    ]);
  });

  it("whileM collects results", () => {
    let n = 0;
    const p = { get: () => n < 3 };
    // Use an eager 'Id'-like monad over thunks: Option-as-value monad suffices.
    const M = {
      ...optionMonad,
      flatMap: (fa: unknown, f: (a: unknown) => unknown) =>
        f(typeof fa === "function" ? (fa as () => unknown)() : fa),
    } as never;
    const r = whileM(M)(
      (() => p.get()) as never,
      (() => {
        n++;
        return n;
      }) as never
    );
    expect(r).toEqual([1, 2, 3]);
  });
});

describe("the FlatMap bridge instances are complete FlatMaps (they have Apply's ap)", () => {
  // `@impl FlatMap<OptionF>` checks the instance against fp's FlatMap, which
  // extends Apply: without `ap`, `check --strict` reported the instance, and
  // a FlatMap summoned as it had no `ap` at run time (review 8).
  it("Option", () => {
    const inc = Some((n: number) => n + 1);
    expect(flatMapOption.ap(inc, Some(2))).toBe(3);
    expect(flatMapOption.ap(None as Option<(n: number) => number>, Some(2))).toBe(None);
    expect(flatMapOption.ap(inc, None as Option<number>)).toBe(None);
  });

  it("List", () => {
    const fs = fromArray([(n: number) => n + 1, (n: number) => n * 10]);
    expect(toArray(flatMapList.ap(fs, fromArray([1, 2])))).toEqual([2, 3, 10, 20]);
  });

  it("IO", async () => {
    expect(
      await unsafeRunIO(
        flatMapIO.ap(
          IO.pure((n: number) => n * 2),
          IO.pure(21)
        )
      )
    ).toBe(42);
  });
});
