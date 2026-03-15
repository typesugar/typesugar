/**
 * PEP-012 Wave 3: Type rewrite method erasure tests.
 *
 * Verifies the transformer rewrites method calls on @opaque types
 * to standalone function calls using the type rewrite registry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { registerTypeRewrite, clearTypeRewrites, type TypeRewriteEntry } from "@typesugar/core";

beforeEach(() => {
  clearTypeRewrites();
});

afterEach(() => {
  clearTypeRewrites();
});

function registerOptionType(): void {
  registerTypeRewrite({
    typeName: "Option",
    sourceModule: "@typesugar/fp/data/option",
    underlyingTypeText: "T | null",
    methods: new Map([
      ["map", "map"],
      ["flatMap", "flatMap"],
      ["getOrElse", "getOrElse"],
      ["filter", "filter"],
    ]),
    constructors: new Map([
      ["Some", { kind: "identity" }],
      ["None", { kind: "constant", value: "null" }],
    ]),
    accessors: new Map(),
    transparent: true,
  });
}

describe("PEP-012 Wave 3: type rewrite method erasure", () => {
  it("rewrites x.method(args) to method(x, args) for registered types", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
}
declare function Some<A>(a: A): Option<A>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
const result = Some(5).map(n => n * 2);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-basic.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("map(Some(5)");
    expect(result.code).not.toMatch(/\.map\(/);
  });

  it("rewrites chained method calls", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  filter(pred: (a: A) => boolean): Option<A>;
}
declare function Some<A>(a: A): Option<A>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function filter<A>(o: Option<A>, pred: (a: A) => boolean): Option<A>;
const result = Some(5).map(n => n * 2).filter(n => n > 5);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-chain.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Inner call: Some(5).map(n => n * 2) → map(Some(5), n => n * 2)
    // Outer call: <inner>.filter(n => n > 5) → filter(map(Some(5), n => n * 2), n => n > 5)
    expect(result.code).toContain("filter(map(Some(5)");
    expect(result.code).not.toMatch(/\.map\(/);
    expect(result.code).not.toMatch(/\.filter\(/);
  });

  it("does not rewrite methods not in the registry methods map", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  toString(): string;
}
declare function Some<A>(a: A): Option<A>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
const result = Some(5).toString();
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-no-match.ts" });
    // toString is NOT in the methods map, so it should not be rewritten
    expect(result.code).toContain(".toString()");
  });

  it("does not rewrite when the type is not in the registry", () => {
    // Don't register anything

    const code = `
interface MyType {
  doStuff(): void;
}
declare const x: MyType;
x.doStuff();
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-unregistered.ts" });
    expect(result.code).toContain(".doStuff()");
  });

  it("handles generic type name stripping (Option<number> → Option)", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare const opt: Option<number>;
const result = opt.map(n => n + 1);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-generic.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("map(opt");
    expect(result.code).not.toMatch(/\.map\(/);
  });

  it("preserves existing extension method behavior for non-registry types", () => {
    registerOptionType();

    const code = `
declare function clamp(x: number, lo: number, hi: number): number;
const result = (42).clamp(0, 100);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-existing-ext.ts" });
    // The clamp extension should still work via the existing path (not the type rewrite registry)
    // number is not in the type rewrite registry, so it falls through
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("injects import declaration when function is not already imported", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function Some<A>(a: A): Option<A>;
const result = Some(5).map(n => n * 2);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-import-inject.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Should inject an import for `map` from the sourceModule
    expect(result.code).toContain("map(Some(5)");
    // The import may or may not appear depending on whether `map` was already declared
    // In this test, map is not declared as a function, so the import should be injected
    expect(result.code).toContain("@typesugar/fp/data/option");
  });

  it("does not duplicate import when function is already imported", () => {
    registerOptionType();

    const code = `
import { map } from "@typesugar/fp/data/option";
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function Some<A>(a: A): Option<A>;
const result = Some(5).map(n => n * 2);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-no-dup-import.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("map(Some(5)");
    // Count occurrences of the import — should be exactly 1
    const importMatches = result.code.match(/@typesugar\/fp\/data\/option/g);
    expect(importMatches?.length).toBe(1);
  });

  it("groups multiple injected imports by module", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  filter(pred: (a: A) => boolean): Option<A>;
}
declare function Some<A>(a: A): Option<A>;
const a = Some(5).map(n => n * 2);
const b = Some(10).filter(n => n > 3);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-grouped-imports.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("map(Some(5)");
    expect(result.code).toContain("filter(Some(10)");
    // Both map and filter should be in one import from the same module
    const importMatches = result.code.match(/@typesugar\/fp\/data\/option/g);
    expect(importMatches?.length).toBe(1);
  });

  it("rewrites method with multiple arguments", () => {
    registerTypeRewrite({
      typeName: "List",
      sourceModule: "@typesugar/fp/data/list",
      underlyingTypeText: "Array<T>",
      methods: new Map([["foldLeft", "foldLeft"]]),
    });

    const code = `
interface List<A> {
  foldLeft<B>(init: B, f: (acc: B, a: A) => B): B;
}
declare function foldLeft<A, B>(list: List<A>, init: B, f: (acc: B, a: A) => B): B;
declare const xs: List<number>;
const sum = xs.foldLeft(0, (acc, n) => acc + n);
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-multi-args.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("foldLeft(xs, 0,");
    expect(result.code).not.toMatch(/\.foldLeft\(/);
  });

  it("rewrites when method maps to a different function name", () => {
    registerTypeRewrite({
      typeName: "IO",
      sourceModule: "@typesugar/fp/io",
      underlyingTypeText: "() => T",
      methods: new Map([["run", "unsafeRunSync"]]),
    });

    const code = `
interface IO<A> {
  run(): A;
}
declare function unsafeRunSync<A>(io: IO<A>): A;
declare const io: IO<number>;
const value = io.run();
    `.trim();

    const result = transformCode(code, { fileName: "type-rewrite-renamed.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("unsafeRunSync(io)");
    expect(result.code).not.toMatch(/\.run\(/);
  });
});
