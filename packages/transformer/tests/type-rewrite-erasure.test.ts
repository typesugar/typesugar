/**
 * PEP-012 Wave 3: Type rewrite method erasure tests.
 *
 * Verifies the transformer rewrites method calls on @opaque types
 * to standalone function calls using the type rewrite registry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import { transformCode, TransformationPipeline } from "../src/pipeline.js";
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
    accessors: new Map([["value", { kind: "identity" }]]),
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
    // Some(5) is also erased by constructor erasure (Wave 4), so expect map(5, ...)
    expect(result.code).toContain("map(5,");
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
    // Some(5) erased to 5 (Wave 4), methods erased to function calls (Wave 3)
    expect(result.code).toContain("filter(map(5,");
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
    // Some(5) erased to 5, map injected as standalone call
    expect(result.code).toContain("map(5,");
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
    expect(result.code).toContain("map(5,");
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
    // Some() erased by constructor erasure
    expect(result.code).toContain("map(5,");
    expect(result.code).toContain("filter(10,");
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

// ---------------------------------------------------------------------------
// PEP-012 Wave 4: Constructor erasure
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 4: constructor erasure", () => {
  it("erases identity constructor: Some(5) → 5", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function Some<A>(a: A): Option<A>;
const result = Some(5);
    `.trim();

    const result = transformCode(code, { fileName: "ctor-identity.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = 5");
    expect(result.code).not.toContain("Some(");
  });

  it("erases identity constructor with expression argument: Some(x + 1) → x + 1", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function Some<A>(a: A): Option<A>;
declare const x: number;
const result = Some(x + 1);
    `.trim();

    const result = transformCode(code, { fileName: "ctor-identity-expr.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("x + 1");
    expect(result.code).not.toContain("Some(");
  });

  it("erases constant constructor reference: None → null", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare const None: Option<never>;
const result = None;
    `.trim();

    const result = transformCode(code, { fileName: "ctor-constant.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = null");
    expect(result.code).not.toMatch(/\bNone\b.*=/);
  });

  it("does not erase constructors for unregistered types", () => {
    registerOptionType();

    const code = `
declare function MyWrapper(x: number): number;
const result = MyWrapper(42);
    `.trim();

    const result = transformCode(code, { fileName: "ctor-unregistered.ts" });
    expect(result.code).toContain("MyWrapper(42)");
  });
});

// ---------------------------------------------------------------------------
// PEP-012 Wave 4: Accessor erasure
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 4: accessor erasure", () => {
  it("erases identity accessor: x.value → x", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  readonly value: A;
  map<B>(f: (a: A) => B): Option<B>;
}
declare const opt: Option<number>;
const result = opt.value;
    `.trim();

    const result = transformCode(code, { fileName: "accessor-identity.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = opt");
    expect(result.code).not.toContain(".value");
  });

  it("does not erase unregistered property accesses", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  readonly value: A;
  map<B>(f: (a: A) => B): Option<B>;
}
declare const opt: Option<number>;
const result = opt.toString();
    `.trim();

    const result = transformCode(code, { fileName: "accessor-unregistered.ts" });
    // toString is not an accessor in the registry, so it should remain
    expect(result.code).toContain(".toString()");
  });

  it("does not erase accessor when used as method call callee", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare const opt: Option<number>;
const result = opt.map(n => n + 1);
    `.trim();

    const result = transformCode(code, { fileName: "accessor-not-method.ts" });
    // .map() is a method call, should be rewritten via method erasure not accessor erasure
    expect(result.code).toContain("map(opt");
  });
});

// ---------------------------------------------------------------------------
// PEP-012 Wave 4: End-to-end pipeline test
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 4: end-to-end pipeline", () => {
  it("full pipeline: Some(5).map(f).getOrElse(() => 0) → getOrElse(map(5, f), () => 0)", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  getOrElse(defaultValue: () => A): A;
}
declare function Some<A>(a: A): Option<A>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function getOrElse<A>(o: Option<A>, defaultValue: () => A): A;
const f = (n: number) => n * 2;
const result = Some(5).map(f).getOrElse(() => 0);
    `.trim();

    const result = transformCode(code, { fileName: "e2e-pipeline.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // Some(5) should be erased to 5
    // .map(f) on that should become map(5, f)
    // .getOrElse(() => 0) should become getOrElse(map(5, f), () => 0)
    expect(result.code).toContain("getOrElse(map(5,");
    expect(result.code).not.toContain("Some(");
    expect(result.code).not.toMatch(/\.map\(/);
    expect(result.code).not.toMatch(/\.getOrElse\(/);
  });

  it("None propagates through pipeline: None should become null", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  getOrElse(defaultValue: () => A): A;
}
declare const None: Option<never>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function getOrElse<A>(o: Option<A>, defaultValue: () => A): A;
const result = None;
    `.trim();

    const result = transformCode(code, { fileName: "e2e-none.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = null");
  });

  it("combined constructor + method erasure in complex expression", () => {
    registerOptionType();

    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  filter(pred: (a: A) => boolean): Option<A>;
  getOrElse(defaultValue: () => A): A;
}
declare function Some<A>(a: A): Option<A>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B>;
declare function filter<A>(o: Option<A>, pred: (a: A) => boolean): Option<A>;
declare function getOrElse<A>(o: Option<A>, defaultValue: () => A): A;
const result = Some(10).map(n => n * 2).filter(n => n > 5).getOrElse(() => 0);
    `.trim();

    const result = transformCode(code, { fileName: "e2e-complex.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // Some(10) → 10, then chained method erasure
    expect(result.code).toContain("getOrElse(filter(map(10,");
    expect(result.code).not.toContain("Some(");
    expect(result.code).not.toMatch(/\.map\(/);
    expect(result.code).not.toMatch(/\.filter\(/);
    expect(result.code).not.toMatch(/\.getOrElse\(/);
  });
});

// ---------------------------------------------------------------------------
// PEP-030 Wave 1: Type identity normalization for cross-module imports
// ---------------------------------------------------------------------------

describe("PEP-030 Wave 1: type identity normalization", () => {
  it("rewrites method call when type is imported from another module", () => {
    registerOptionType();

    // Simulate a multi-file project where Option is defined in another module.
    // When TypeScript resolves a type from another file, typeToString may emit
    // import("./option-def").Option<number> instead of just Option<number>.
    const optionDefFile = "/test/option-def.ts";
    const mainFile = "/test/main.ts";

    const files = new Map<string, string>();
    files.set(
      optionDefFile,
      [
        "export interface Option<A> {",
        "  map<B>(f: (a: A) => B): Option<B>;",
        "  flatMap<B>(f: (a: A) => Option<B>): Option<B>;",
        "}",
        "export declare function Some<A>(a: A): Option<A>;",
        "export declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;",
      ].join("\n")
    );
    files.set(
      mainFile,
      [
        'import { Option, Some, map } from "./option-def";',
        "const result = Some(5).map(n => n * 2);",
      ].join("\n")
    );

    const pipeline = new TransformationPipeline(
      {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: false,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
      },
      Array.from(files.keys()),
      {
        readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
        fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
      }
    );

    const result = pipeline.transform(mainFile);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // The method call should be rewritten even though the type comes from
    // another module (where typeToString might emit import("./option-def").Option)
    expect(result.code).toContain("map(");
    expect(result.code).not.toMatch(/\.map\(/);
  });

  it("rewrites accessor when type is imported from another module", () => {
    registerOptionType();

    const optionDefFile = "/test/option-def2.ts";
    const mainFile = "/test/main2.ts";

    const files = new Map<string, string>();
    files.set(
      optionDefFile,
      [
        "export interface Option<A> {",
        "  readonly value: A;",
        "  map<B>(f: (a: A) => B): Option<B>;",
        "}",
        "export declare const opt: Option<number>;",
      ].join("\n")
    );
    files.set(
      mainFile,
      ['import { Option, opt } from "./option-def2";', "const result = opt.value;"].join("\n")
    );

    const pipeline = new TransformationPipeline(
      {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: false,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
      },
      Array.from(files.keys()),
      {
        readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
        fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
      }
    );

    const result = pipeline.transform(mainFile);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);

    // The accessor should be erased to the receiver even when the type
    // is imported from another module
    expect(result.code).toContain("const result = opt");
    expect(result.code).not.toContain(".value");
  });

  it("handles symbol name fallback for registered types", () => {
    registerOptionType();

    // Test that even without import() prefix, the symbol name fallback works
    // by using a type alias that might confuse typeToString
    const code = `
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare const opt: Option<number>;
const result = opt.map(n => n + 1);
    `.trim();

    const result = transformCode(code, { fileName: "type-identity-symbol.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("map(opt");
    expect(result.code).not.toMatch(/\.map\(/);
  });
});
