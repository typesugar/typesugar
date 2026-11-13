/**
 * Regression test for PEP-052: a user-defined monad declared with an
 * `@impl FlatMap<T>` instance in the same file must be visible to the
 * `let:`/`yield:` and `par:`/`yield:` do-notation macros.
 *
 * Do-notation FlatMap/ParCombine detection is scope-based
 * (`resolveDoNotationInstance` in @typesugar/macros): instances are resolved
 * from declarations in the current file or from imported modules — there is
 * no global registry. This test covers the local-file `@impl` scope-resolution
 * path (the std built-ins keep working via the `@typesugar/std/syntax/do`
 * marker, so the suite would otherwise stay green if it broke).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { transformCode } from "@typesugar/transformer";

const USER_FLATMAP_SOURCE = `
import "@typesugar/std/syntax/do";

/** @typeclass */
interface FlatMap<F> { map(fa: F, f: any): F; }

class Box<A> {
  constructor(public value: A) {}
  flatMap<B>(f: (a: A) => Box<B>): Box<B> { return f(this.value); }
  map<B>(f: (a: A) => B): Box<B> { return new Box(f(this.value)); }
}
function box<A>(a: A): Box<A> { return new Box(a); }

/** @impl FlatMap<Box> */
const flatMapBox: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };

const result =
let: {
  x << box(1);
  y << box(2);
}
yield: { x + y }
`;

describe("user-defined @impl monad in do-notation (PEP-052 Phase B)", () => {
  it("resolves a user-defined @impl FlatMap instance in let:/yield:", () => {
    const result = transformCode(USER_FLATMAP_SOURCE, { fileName: "user-monad.ts" });

    const errors = (result.diagnostics ?? []).filter((d) => d.severity === "error");
    expect(errors, `Unexpected errors: ${JSON.stringify(errors)}`).toEqual([]);

    // The comprehension must be lowered to the receiver's flatMap/map chain — not
    // left untransformed with a "No FlatMap instance registered for 'Box'" error.
    expect(result.code).toContain("box(1).flatMap(");
    expect(result.code).not.toContain("let: {");
    expect(result.code).not.toContain("yield: {");
  });
});

// Two instances for one brand at the same precedence: none is chosen, as for
// `===` sugar (audit/ARCH-REVIEW-2026-11-TRIAGE.md, "Instance lookup").
describe("ambiguous do-notation instances", () => {
  const TWO_LOCAL = USER_FLATMAP_SOURCE.replace(
    "const result =",
    `/** @impl FlatMap<Box> */
const flatMapBox2: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };

const result =`
  );

  it("two local @impl FlatMap<Box> instances are reported, not picked by order", () => {
    const result = transformCode(TWO_LOCAL, { fileName: "user-monad-ambiguous.ts" });
    const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    // Exactly the ambiguity: no "no FlatMap instance" (TS9225) after it.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Ambiguous FlatMap instance for 'Box'");
    expect(errors[0]).toContain("flatMapBox2");
  });

  it("two imported modules providing FlatMap<Box> are reported", () => {
    const lib = (name: string) => `
/** @typeclass */
export interface FlatMap<F> { map(fa: F, f: any): F; }
export class Box<A> {
  constructor(public value: A) {}
  flatMap<B>(f: (a: A) => Box<B>): Box<B> { return f(this.value); }
  map<B>(f: (a: A) => B): Box<B> { return new Box(f(this.value)); }
}
/** @impl FlatMap<Box> */
export const ${name}: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };
`;
    const main = `
import "@typesugar/std/syntax/do";
import { Box } from "./box-a";
import "./box-b";
const result =
let: {
  x << new Box(1);
  y << new Box(2);
}
yield: { x + y }
`;
    const files: Record<string, string> = {
      [path.resolve("box-a.ts")]: lib("flatMapBoxA"),
      [path.resolve("box-b.ts")]: lib("flatMapBoxB"),
    };
    const result = transformCode(main, {
      fileName: "user-monad-ambiguous-imports.ts",
      extraRootFiles: Object.keys(files),
      readFile: (f: string) => files[f] ?? fs.readFileSync(f, "utf8"),
      fileExists: (f: string) => f in files || fs.existsSync(f),
    });
    const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Ambiguous FlatMap instance for 'Box'");
  });

  it("a private @impl in another imported module does not compete with an exported one", () => {
    const files: Record<string, string> = {
      [path.resolve("rx-a.ts")]: `
/** @typeclass */
export interface FlatMap<F> { map(fa: F, f: any): F; }
export class Box<A> {
  constructor(public value: A) {}
  flatMap<B>(f: (a: A) => Box<B>): Box<B> { return f(this.value); }
  map<B>(f: (a: A) => B): Box<B> { return new Box(f(this.value)); }
}
/** @impl FlatMap<Box> */
export const flatMapBox: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };
`,
      [path.resolve("rx-b.ts")]: `
import type { FlatMap, Box } from "./rx-a";
/** @impl FlatMap<Box> */
const privateBox: FlatMap<Box<unknown>> = { map: (fa: any, f: any) => fa.map(f) };
export const helper = privateBox;
`,
    };
    const main = `
import "@typesugar/std/syntax/do";
import { Box } from "./rx-a";
import { helper } from "./rx-b";
export const h = helper;
const result =
let: {
  x << new Box(1);
  y << new Box(2);
}
yield: { x + y }
`;
    const result = transformCode(main, {
      fileName: "user-monad-private-instance.ts",
      extraRootFiles: Object.keys(files),
      readFile: (f: string) => files[f] ?? fs.readFileSync(f, "utf8"),
      fileExists: (f: string) => f in files || fs.existsSync(f),
    });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(result.code).toContain("new Box(1).flatMap(");
  });
});
