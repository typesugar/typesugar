/**
 * PEP-053 Wave 2 — former-builtin instances are extractable from their REAL
 * sources.
 *
 * The ~30 static `registerInstanceMethods` builtins (deleted in Wave 4) exist
 * because source extraction couldn't reach cross-package instances. This
 * matrix proves the Wave 2 capability against the actual declarations in
 * packages/fp and packages/std.
 *
 * Every import is RENAMED: the static builtin table is still registered under
 * the original names, and the registry fallback would mask an extraction
 * failure. A renamed import misses the registry, so a hoisted specialization
 * can only come from genuine source extraction.
 *
 * Expected outcomes match the PEP's fallback decision:
 * - self-contained method bodies (array/option/promise instances, the
 *   Array/Promise FlatMaps and their std aliases) → inline cross-module
 * - bodies referencing module-local helpers or the instance module's imports
 *   (Either factories via isRight/Right/Left, Iterable FlatMaps via
 *   iterableMap et al.) → fall back to dictionary passing (always correct;
 *   revisit via import emission if Wave 4 bench parity needs it)
 *
 * Effect-package instances follow the same namespace-import pattern as the
 * fallback group and are covered by shape in the pipeline tests (pulling the
 * `effect` library into a test program is not worth the weight here).
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { transformCode } from "@typesugar/transformer/pipeline";

const FP = "./packages/fp/src/instances";
const STD_FLATMAP = "./packages/std/src/typeclasses/flatmap";
const STD_SPEC = "./packages/std/src/specialize/index";

const CONSUMER = `
import {
  optionFunctor as srcOptionFunctor,
  optionMonad as srcOptionMonad,
  optionFoldable as srcOptionFoldable,
  optionSemigroupK as srcOptionSemigroupK,
  arrayFunctor as srcArrayFunctor,
  arrayMonad as srcArrayMonad,
  arrayFoldable as srcArrayFoldable,
  promiseFunctor as srcPromiseFunctor,
  promiseMonad as srcPromiseMonad,
  eitherFunctor as srcEitherFunctor,
  eitherMonad as srcEitherMonad,
  eitherFoldable as srcEitherFoldable,
} from "${FP}";
import {
  flatMapArray as srcFlatMapArray,
  flatMapPromise as srcFlatMapPromise,
  flatMapIterable as srcFlatMapIterable,
  flatMapAsyncIterable as srcFlatMapAsyncIterable,
} from "${STD_FLATMAP}";
import {
  stdFlatMapArray as srcStdFlatMapArray,
  stdFlatMapPromise as srcStdFlatMapPromise,
  stdFlatMapIterable as srcStdFlatMapIterable,
} from "${STD_SPEC}";

function mapOptionF(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function mapOptionM(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function foldOption(F: any, fa: any) { return F.foldLeft(fa, 0, (b: number, a: number) => b + a); }
function combineOption(F: any, fa: any, fb: any) { return F.combineK(fa, fb); }
function mapArrayF(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function mapArrayM(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function foldArray(F: any, fa: any) { return F.foldLeft(fa, 0, (b: number, a: number) => b + a); }
function mapPromiseF(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function mapPromiseM(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function mapEitherF(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function mapEitherM(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function foldEither(F: any, fa: any) { return F.foldLeft(fa, 0, (b: number, a: number) => b + a); }
function fmArray(F: any, fa: any) { return F.flatMap(fa, (x: number) => [x, x]); }
function fmPromise(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function fmIterable(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function fmAsyncIterable(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function fmStdArray(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function fmStdPromise(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }
function fmStdIterable(F: any, fa: any) { return F.map(fa, (x: number) => x + 1); }

export const r1 = mapOptionF(srcOptionFunctor, 1 as any);
export const r2 = mapOptionM(srcOptionMonad, 1 as any);
export const r3 = foldOption(srcOptionFoldable, 1 as any);
export const r4 = combineOption(srcOptionSemigroupK, 1 as any, 2 as any);
export const r5 = mapArrayF(srcArrayFunctor, [1]);
export const r6 = mapArrayM(srcArrayMonad, [1]);
export const r7 = foldArray(srcArrayFoldable, [1]);
export const r8 = mapPromiseF(srcPromiseFunctor, Promise.resolve(1));
export const r9 = mapPromiseM(srcPromiseMonad, Promise.resolve(1));
export const r10 = mapEitherF(srcEitherFunctor<string>(), { _tag: "Right", right: 1 } as any);
export const r11 = mapEitherM(srcEitherMonad<string>(), { _tag: "Right", right: 1 } as any);
export const r12 = foldEither(srcEitherFoldable<string>(), { _tag: "Right", right: 1 } as any);
export const r13 = fmArray(srcFlatMapArray, [1]);
export const r14 = fmPromise(srcFlatMapPromise, Promise.resolve(1));
export const r15 = fmIterable(srcFlatMapIterable, [1]);
export const r16 = fmAsyncIterable(srcFlatMapAsyncIterable, [1] as any);
export const r17 = fmStdArray(srcStdFlatMapArray, [1]);
export const r18 = fmStdPromise(srcStdFlatMapPromise, Promise.resolve(1));
export const r19 = fmStdIterable(srcStdFlatMapIterable, [1]);
`.trim();

describe("PEP-053 Wave 2: former builtins extract from their real sources", () => {
  // One program for the whole matrix — building it pulls in the real fp/std
  // sources, which is expensive; do it once.
  const result = transformCode(CONSUMER, {
    fileName: "consumer.ts",
    readFile: (f: string) => ts.sys.readFile(f),
    fileExists: (f: string) => ts.sys.fileExists(f),
  });

  const INLINED: Array<[string, string]> = [
    ["optionFunctor", "mapOptionF"],
    ["optionMonad (map via property-access member)", "mapOptionM"],
    ["optionFoldable", "foldOption"],
    ["optionSemigroupK", "combineOption"],
    ["arrayFunctor", "mapArrayF"],
    ["arrayMonad (map via property-access member)", "mapArrayM"],
    ["arrayFoldable", "foldArray"],
    ["promiseFunctor", "mapPromiseF"],
    ["promiseMonad (map via property-access member)", "mapPromiseM"],
    ["flatMapArray", "fmArray"],
    ["flatMapPromise", "fmPromise"],
    ["stdFlatMapArray (identifier alias)", "fmStdArray"],
    ["stdFlatMapPromise (identifier alias)", "fmStdPromise"],
  ];

  const FALLBACK: Array<[string, string, string]> = [
    // [builtin, fn, reason]
    ["eitherFunctor", "mapEitherF", "factory body references isRight/Right/Left"],
    ["eitherMonad", "mapEitherM", "factory body references module-local factory + isRight/Left"],
    ["eitherFoldable", "foldEither", "factory body references isRight"],
    ["flatMapIterable", "fmIterable", "methods call module-local iterableMap/iterableFlatMap"],
    ["flatMapAsyncIterable", "fmAsyncIterable", "methods call module-local async helpers"],
    ["stdFlatMapIterable", "fmStdIterable", "alias of flatMapIterable (module-local helpers)"],
  ];

  it("transforms the matrix consumer without errors", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  for (const [builtin, fn] of INLINED) {
    it(`inlines ${builtin} from source at a cross-package call site`, () => {
      expect(result.code).toMatch(new RegExp(`__\\w*${fn}\\w*`));
    });
  }

  for (const [builtin, fn, reason] of FALLBACK) {
    it(`falls back to dictionary passing for ${builtin} (${reason})`, () => {
      expect(result.code).not.toMatch(new RegExp(`__\\w*${fn}\\w*`));
      // The original call must survive untouched.
      expect(result.code).toContain(`${fn}(src`);
    });
  }
});
