/**
 * PEP-053 Wave 2 — source-based instance extraction capability.
 *
 * Auto-specialization's gate is instance recognition. These tests cover each
 * extraction form the former static builtins relied on:
 *   gap 1 — cross-module import (incl. renamed imports)
 *   gap 2 — zero-arg factory instances (`eitherFunctor<E>()`)
 *   gap 3 — identifier-alias consts (`const stdX = x`)
 *   gap 4 — indirect members (`map: base.map`, shorthand `{ map }`)
 *   gap 5 — unified acceptance (typeclass type annotation, no @impl needed)
 *   gap 6 — companion paths (`Point.Numeric`)
 * plus the cross-module safety rule: method bodies referencing module-local
 * bindings fall back to dictionary passing instead of inlining dangling
 * identifiers.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { transformCode } from "@typesugar/transformer/pipeline";

/** Virtual filesystem over in-memory files for module resolution. */
function createVirtualFs(files: Record<string, string>) {
  const resolved: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    resolved[path.resolve(name)] = content;
  }
  return {
    readFile: (f: string) => resolved[f] ?? ts.sys.readFile(f),
    fileExists: (f: string) => f in resolved || ts.sys.fileExists(f),
  };
}

function transform(consumer: string, files: Record<string, string>) {
  const vfs = createVirtualFs(files);
  return transformCode(consumer, {
    fileName: "consumer.ts",
    extraRootFiles: Object.keys(files).map((f) => path.resolve(f)),
    ...vfs,
  });
}

const FUNCTOR_TC = `
export interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
`.trim();

const DOUBLE_FN = `
function double<F>(F: Functor<F>, fa: any): any {
  return F.map(fa, (x: number) => x * 2);
}
`.trim();

describe("PEP-053 Wave 2: cross-module import (gap 1)", () => {
  it("specializes a call passing an instance imported from another module", () => {
    const result = transform(
      `
import { Functor, arrayFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(arrayFunctor, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
/** @impl Functor<Array> */
export const arrayFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(arrayFunctor");
    expect(result.code).toContain(".map(");
  });

  it("follows renamed imports (import { arrayFunctor as af })", () => {
    const result = transform(
      `
import { Functor, arrayFunctor as af } from "./lib";
${DOUBLE_FN}
export const r = double(af, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
/** @impl Functor<Array> */
export const arrayFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(af");
  });
});

describe("PEP-053 Wave 2: factory-form instances (gap 2)", () => {
  it("specializes a call passing a zero-arg factory result (same file)", () => {
    const result = transform(
      `
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function eitherFunctor<E>(): Functor<any> {
  return {
    map: (fa: any, f: (a: any) => any) => (fa.ok ? { ok: true, value: f(fa.value) } : fa),
  };
}
${DOUBLE_FN}
export const r = double(eitherFunctor<string>(), { ok: true, value: 21 });
`.trim(),
      {}
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(eitherFunctor");
  });

  it("specializes a zero-arg factory imported from another module (self-contained body)", () => {
    const result = transform(
      `
import { Functor, resultFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(resultFunctor<string>(), { ok: true, value: 21 });
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
export function resultFunctor<E>(): Functor<any> {
  return {
    map: (fa: any, f: (a: any) => any) => (fa.ok ? { ok: true, value: f(fa.value) } : fa),
  };
}
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(resultFunctor");
  });

  it("does NOT extract factories with value parameters (would capture the argument)", () => {
    const result = transform(
      `
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function makeFunctor(tag: string): Functor<any> {
  return {
    map: (fa: any[], f: (a: any) => any) => fa.map(f),
  };
}
${DOUBLE_FN}
export const r = double(makeFunctor("x"), [1, 2, 3]);
`.trim(),
      {}
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/__\w*double\w*/);
    expect(result.code).toContain('double(makeFunctor("x")');
  });
});

describe("PEP-053 Wave 2: identifier-alias consts (gap 3)", () => {
  it("chases `export const stdArrayFunctor = arrayFunctorBase` across modules", () => {
    const result = transform(
      `
import { Functor, stdArrayFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(stdArrayFunctor, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
const arrayFunctorBase: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
export const stdArrayFunctor = arrayFunctorBase;
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(stdArrayFunctor");
  });
});

describe("PEP-053 Wave 2: indirect members (gap 4)", () => {
  it("resolves property-access members (`map: arrayFunctor.map`)", () => {
    const result = transform(
      `
import { Monad, arrayMonad } from "./lib";
function double<F>(M: Monad<F>, fa: any): any {
  return M.map(fa, (x: number) => x * 2);
}
export const r = double(arrayMonad, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
export interface Monad<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
  flatMap<A, B>(fa: any, f: (a: A) => any): any;
}
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
const arrayFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
export const arrayMonad: Monad<Array<any>> = {
  map: arrayFunctor.map,
  flatMap: (fa: any[], f: (a: any) => any[]) => fa.flatMap(f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(arrayMonad");
    expect(result.code).toContain(".map(");
  });

  it("resolves shorthand members (`{ map }` referencing a const arrow)", () => {
    const result = transform(
      `
import { Functor, shorthandFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(shorthandFunctor, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
const map = (fa: any[], f: (a: any) => any) => fa.map(f);
export const shorthandFunctor: Functor<Array<any>> = { map };
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(shorthandFunctor");
  });
});

describe("PEP-053 Wave 2: unified acceptance criteria (gap 5)", () => {
  it("accepts an imported instance with only a typeclass type annotation (no @impl)", () => {
    const result = transform(
      `
import { Functor, annotatedOnly } from "./lib";
${DOUBLE_FN}
export const r = double(annotatedOnly, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
export const annotatedOnly: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
  });

  it("does NOT extract an unannotated, untagged object literal", () => {
    const result = transform(
      `
import { Functor, bareObject } from "./lib";
${DOUBLE_FN}
export const r = double(bareObject, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
export const bareObject = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/__\w*double\w*/);
    expect(result.code).toContain("double(bareObject");
  });
});

describe("PEP-053 Wave 2: companion paths (gap 6)", () => {
  it("specializes `double(p, Point.Numeric)` when the companion is only generated at transform time", () => {
    // Point is interface-only in the checker's view: the companion namespace
    // exists solely in emitted output, so extraction must resolve the path by
    // scope (the same machinery method sugar uses).
    const result = transform(
      `
import { Numeric, numericPoint } from "./lib";
import type { Point } from "./lib";
function double(N: Numeric<Point>, p: Point): Point {
  return N.add(p, p);
}
declare const Point: any;
export const r = double(Point.Numeric, { x: 1, y: 2 });
`.trim(),
      {
        "lib.ts": `
export interface Numeric<T> {
  add(a: T, b: T): T;
}
export interface Point { x: number; y: number; }
/** @impl Numeric<Point> */
export const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("double(Point.Numeric");
  });

  it("specializes companion access through a real companion const", () => {
    const result = transform(
      `
import { Numeric, Point } from "./lib";
interface P { x: number; y: number; }
function double(N: Numeric<P>, p: P): P {
  return N.add(p, p);
}
export const r = double(Point.Numeric, { x: 1, y: 2 });
`.trim(),
      {
        "lib.ts": `
export interface Numeric<T> {
  add(a: T, b: T): T;
}
/** @impl Numeric<Point> */
const numericPoint: Numeric<any> = {
  add: (a: any, b: any) => ({ x: a.x + b.x, y: a.y + b.y }),
};
export const Point = { Numeric: numericPoint };
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/__\w*double\w*/);
  });
});

describe("PEP-053 Wave 2: cross-module safety (fallback over import emission)", () => {
  it("falls back to dictionary passing when a method references a module-local helper", () => {
    const result = transform(
      `
import { Functor, helperFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(helperFunctor, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
${FUNCTOR_TC}
function localHelper(fa: any[], f: (a: any) => any): any[] {
  return fa.map(f);
}
export const helperFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => localHelper(fa, f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // No inlining — but the call must remain intact (dictionary passing is
    // always correct).
    expect(result.code).not.toMatch(/__\w*double\w*/);
    expect(result.code).toContain("double(helperFunctor");
    expect(result.code).not.toContain("localHelper");
  });

  it("falls back when a method references the instance module's imports", () => {
    const result = transform(
      `
import { Functor, importUsingFunctor } from "./lib";
${DOUBLE_FN}
export const r = double(importUsingFunctor, [1, 2, 3]);
`.trim(),
      {
        "helper.ts": `
export function mapVia(fa: any[], f: (a: any) => any): any[] {
  return fa.map(f);
}
`.trim(),
        "lib.ts": `
import { mapVia } from "./helper";
${FUNCTOR_TC}
export const importUsingFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => mapVia(fa, f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/__\w*double\w*/);
    expect(result.code).toContain("double(importUsingFunctor");
  });

  it("specializes through safe methods even when a sibling method is unsafe", () => {
    const result = transform(
      `
import { Monad, mixedMonad } from "./lib";
function double<F>(M: Monad<F>, fa: any): any {
  return M.map(fa, (x: number) => x * 2);
}
export const r = double(mixedMonad, [1, 2, 3]);
`.trim(),
      {
        "lib.ts": `
export interface Monad<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
  flatMap<A, B>(fa: any, f: (a: A) => any): any;
}
function localFlatten(fa: any[], f: (a: any) => any[]): any[] {
  return fa.flatMap(f);
}
export const mixedMonad: Monad<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
  flatMap: (fa: any[], f: (a: any) => any[]) => localFlatten(fa, f),
};
`.trim(),
      }
    );

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The called method (map) is self-contained, so the call specializes;
    // the unsafe flatMap is simply dropped from the extracted set.
    expect(result.code).toMatch(/__\w*double\w*/);
    expect(result.code).not.toContain("localFlatten");
  });
});
