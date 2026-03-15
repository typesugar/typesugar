/**
 * PEP-012 Wave 5: Transparent scope tests.
 *
 * Within the file that declares an @opaque type, the transformer treats the
 * type as transparent — it does NOT rewrite method calls, constructor calls,
 * constant constructor refs, or accessor accesses. This matches Scala 3
 * semantics: inside the companion module, the opaque type equals its
 * underlying type.
 *
 * Files that import the type DO get rewriting as normal.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import { transformCode } from "../src/pipeline.js";
import { registerTypeRewrite, clearTypeRewrites } from "@typesugar/core";

beforeEach(() => {
  clearTypeRewrites();
});

afterEach(() => {
  clearTypeRewrites();
});

/**
 * Register Option type with sourceModule pointing to a specific absolute path.
 * This simulates the @opaque macro registering the type with the defining
 * file's actual path.
 */
function registerOptionWithSourceFile(sourceFilePath: string): void {
  registerTypeRewrite({
    typeName: "Option",
    sourceModule: sourceFilePath,
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

/**
 * Register Option type with a module-specifier-style sourceModule.
 */
function registerOptionWithModuleSpec(): void {
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

const optionDeclarations = `
interface Option<A> {
  readonly value: A;
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
  filter(pred: (a: A) => boolean): Option<A>;
}
declare function Some<A>(a: A): Option<A>;
declare const None: Option<never>;
declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;
declare function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B>;
declare function getOrElse<A>(o: Option<A>, d: () => A): A;
declare function filter<A>(o: Option<A>, pred: (a: A) => boolean): Option<A>;
`.trim();

// ---------------------------------------------------------------------------
// Transparent scope: defining file skips rewriting
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 5: transparent scope — defining file", () => {
  it("preserves method calls inside the defining file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
const result = Some(5).map(n => n * 2);
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Inside defining file: .map() should NOT be rewritten to standalone call
    expect(result.code).toContain(".map(");
  });

  it("preserves identity constructor calls inside the defining file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
const result = Some(5);
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Some(5) should NOT be erased to 5
    expect(result.code).toContain("Some(5)");
  });

  it("preserves constant constructor references inside the defining file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
const result = None;
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // None should NOT be erased to null
    expect(result.code).toMatch(/\bNone\b/);
    expect(result.code).not.toMatch(/const result = null/);
  });

  it("preserves accessor accesses inside the defining file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
declare const opt: Option<number>;
const result = opt.value;
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // .value should NOT be erased to just the receiver
    expect(result.code).toContain(".value");
  });

  it("preserves entire pipeline inside the defining file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
const result = Some(10).map(n => n * 2).filter(n => n > 5).getOrElse(() => 0);
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Everything preserved: Some, .map, .filter, .getOrElse
    expect(result.code).toContain("Some(10)");
    expect(result.code).toContain(".map(");
    expect(result.code).toContain(".filter(");
    expect(result.code).toContain(".getOrElse(");
  });

  it("allows implementations to use === null directly (no casts needed)", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const code = `${optionDeclarations}
function mapImpl<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return o === null ? null : f(o as any);
}
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // The === null comparison should be preserved
    expect(result.code).toContain("=== null");
    // The null return should be preserved
    expect(result.code).toContain("? null");
  });
});

// ---------------------------------------------------------------------------
// Non-defining file: rewriting applies as normal
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 5: transparent scope — consumer file", () => {
  it("rewrites method calls in a different file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const consumerFile = path.resolve("consumer.ts");

    const code = `${optionDeclarations}
const result = Some(5).map(n => n * 2);
`;
    const result = transformCode(code, { fileName: consumerFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // In consumer file: .map() SHOULD be rewritten, Some(5) SHOULD be erased
    expect(result.code).toContain("map(5,");
    expect(result.code).not.toMatch(/\.map\(/);
  });

  it("erases identity constructors in a different file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const consumerFile = path.resolve("consumer.ts");

    const code = `${optionDeclarations}
const result = Some(5);
`;
    const result = transformCode(code, { fileName: consumerFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = 5");
    expect(result.code).not.toContain("Some(");
  });

  it("erases constant constructor references in a different file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const consumerFile = path.resolve("consumer.ts");

    const code = `${optionDeclarations}
const result = None;
`;
    const result = transformCode(code, { fileName: consumerFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = null");
  });

  it("erases accessor accesses in a different file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const consumerFile = path.resolve("consumer.ts");

    const code = `${optionDeclarations}
declare const opt: Option<number>;
const result = opt.value;
`;
    const result = transformCode(code, { fileName: consumerFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("const result = opt");
    expect(result.code).not.toContain(".value");
  });

  it("full pipeline is rewritten in consumer file", () => {
    const definingFile = path.resolve("option.ts");
    registerOptionWithSourceFile(definingFile);

    const consumerFile = path.resolve("consumer.ts");

    const code = `${optionDeclarations}
const result = Some(10).map(n => n * 2).filter(n => n > 5).getOrElse(() => 0);
`;
    const result = transformCode(code, { fileName: consumerFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("getOrElse(filter(map(10,");
    expect(result.code).not.toContain("Some(");
    expect(result.code).not.toMatch(/\.map\(/);
    expect(result.code).not.toMatch(/\.filter\(/);
    expect(result.code).not.toMatch(/\.getOrElse\(/);
  });
});

// ---------------------------------------------------------------------------
// Module specifier form of sourceModule
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 5: transparent scope — module specifier matching", () => {
  it("matches when file path ends with the module path segments", () => {
    registerOptionWithModuleSpec();

    const definingFile = "/workspace/packages/typesugar/fp/data/option.ts";

    const code = `${optionDeclarations}
const result = Some(5).map(n => n * 2);
`;
    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Should be transparent — preserve method calls
    expect(result.code).toContain(".map(");
    expect(result.code).toContain("Some(");
  });

  it("does not match unrelated files", () => {
    registerOptionWithModuleSpec();

    const otherFile = "/workspace/packages/app/src/main.ts";

    const code = `${optionDeclarations}
const result = Some(5).map(n => n * 2);
`;
    const result = transformCode(code, { fileName: otherFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // Should rewrite — not the defining file
    expect(result.code).toContain("map(5,");
    expect(result.code).not.toMatch(/\.map\(/);
  });
});

// ---------------------------------------------------------------------------
// Non-transparent types always get rewritten
// ---------------------------------------------------------------------------

describe("PEP-012 Wave 5: non-transparent types always rewrite", () => {
  it("rewrites even in the source module when transparent is false", () => {
    const definingFile = path.resolve("io.ts");

    registerTypeRewrite({
      typeName: "IO",
      sourceModule: definingFile,
      underlyingTypeText: "() => T",
      methods: new Map([["run", "unsafeRunSync"]]),
      transparent: false,
    });

    const code = `
interface IO<A> { run(): A; }
declare function unsafeRunSync<A>(io: IO<A>): A;
declare const io: IO<number>;
const value = io.run();
    `.trim();

    const result = transformCode(code, { fileName: definingFile });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    // transparent: false → rewriting happens even in defining file
    expect(result.code).toContain("unsafeRunSync(io)");
    expect(result.code).not.toMatch(/\.run\(/);
  });
});
