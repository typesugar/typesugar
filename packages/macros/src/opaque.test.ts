/**
 * Tests for the @opaque attribute macro (PEP-012 Wave 2)
 *
 * Tests cover:
 * - JSDoc @opaque tag parsing
 * - Interface method signature collection
 * - Companion function discovery
 * - Constructor detection (identity + constant)
 * - TypeRewriteEntry registration
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { clearTypeRewrites, getTypeRewrite, type TypeRewriteEntry } from "@typesugar/core";
import { opaqueAttribute } from "./opaque.js";
import { createMacroContext } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSourceFile(content: string, fileName = "test.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

/**
 * Create a real ts.Program from source text so we get a working TypeChecker.
 *
 * Uses a custom compiler host that re-parses source files with full JSDoc
 * support. TypeScript 5.3+ skips custom JSDoc tags (like @opaque) for .ts
 * files by default; overriding getSourceFile ensures they're in the AST.
 *
 * Returns the program, source file, and a cleanup function.
 */
function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opaque-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (sf && fileName === filePath) {
      return ts.createSourceFile(fileName, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run the @opaque macro on a source file by finding the interface with the
 * @opaque JSDoc tag and calling expand.
 */
function runOpaqueMacro(source: string): TypeRewriteEntry | undefined {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);

  try {
    // Find the interface with @opaque tag
    let targetInterface: ts.InterfaceDeclaration | undefined;
    for (const stmt of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(stmt)) {
        const tags = ts.getJSDocTags(stmt);
        if (tags.some((t) => t.tagName.text === "opaque")) {
          targetInterface = stmt;
          break;
        }
      }
    }

    if (!targetInterface) {
      throw new Error("No interface with @opaque tag found in source");
    }

    // Create a transformation context via ts.transform
    let result: TypeRewriteEntry | undefined;

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);

      // Create a dummy decorator node (the @opaque macro uses JSDoc, not the decorator)
      const dummyDecorator = ts.factory.createDecorator(ts.factory.createIdentifier("opaque"));

      opaqueAttribute.expand(ctx, dummyDecorator, targetInterface!, []);
      result = getTypeRewrite(targetInterface!.name.text);

      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);

    return result;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// JSDoc parsing tests
// ---------------------------------------------------------------------------

describe("@opaque JSDoc parsing", () => {
  it("extracts underlying type from @opaque tag", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;
    const sf = createSourceFile(source);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const tags = ts.getJSDocTags(iface);
    const opaqueTag = tags.find((t) => t.tagName.text === "opaque");

    expect(opaqueTag).toBeDefined();
    const comment =
      typeof opaqueTag!.comment === "string"
        ? opaqueTag!.comment
        : ts.getTextOfJSDocComment(opaqueTag!.comment);
    expect(comment?.trim()).toBe("A | null");
  });

  it("extracts complex underlying types", () => {
    const source = `
/** @opaque { ok: true; value: T } | { ok: false; error: E } */
export interface Result<T, E> {
  map<B>(f: (a: T) => B): Result<B, E>;
}
`;
    const sf = createSourceFile(source);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const tags = ts.getJSDocTags(iface);
    const opaqueTag = tags.find((t) => t.tagName.text === "opaque");
    const comment =
      typeof opaqueTag!.comment === "string"
        ? opaqueTag!.comment
        : ts.getTextOfJSDocComment(opaqueTag!.comment);
    expect(comment?.trim()).toContain("ok: true");
  });
});

// ---------------------------------------------------------------------------
// Method collection tests
// ---------------------------------------------------------------------------

describe("@opaque method collection", () => {
  it("collects method signatures from interface", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
}
`;
    const sf = createSourceFile(source);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const methods: string[] = [];
    for (const member of iface.members) {
      if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
        methods.push(member.name.text);
      }
    }
    expect(methods).toEqual(["map", "flatMap", "getOrElse"]);
  });

  it("ignores property signatures", () => {
    const source = `
/** @opaque number */
export interface Meters {
  readonly value: number;
  add(other: Meters): Meters;
}
`;
    const sf = createSourceFile(source);
    const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
    const methods: string[] = [];
    for (const member of iface.members) {
      if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
        methods.push(member.name.text);
      }
    }
    expect(methods).toEqual(["add"]);
  });
});

// ---------------------------------------------------------------------------
// Full macro integration tests (need real Program + TypeChecker)
// ---------------------------------------------------------------------------

describe("@opaque macro — registry population", () => {
  beforeEach(() => {
    clearTypeRewrites();
  });

  it("registers a TypeRewriteEntry for Option<A>", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function getOrElse<A>(o: Option<A>, defaultValue: () => A): A {
  return (o as any) === null ? defaultValue() : (o as any);
}

export function Some<A>(a: A): Option<A> {
  return a as unknown as Option<A>;
}

export const None: Option<never> = null as unknown as Option<never>;
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    expect(entry!.typeName).toBe("Option");
    expect(entry!.underlyingTypeText).toBe("A | null");
    expect(entry!.transparent).toBe(true);
  });

  it("matches interface methods to companion functions", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function getOrElse<A>(o: Option<A>, defaultValue: () => A): A {
  return (o as any) === null ? defaultValue() : (o as any);
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    expect(entry!.methods).toBeDefined();
    expect(entry!.methods!.get("map")).toBe("map");
    expect(entry!.methods!.get("flatMap")).toBe("flatMap");
    expect(entry!.methods!.get("getOrElse")).toBe("getOrElse");
    expect(entry!.methods!.size).toBe(3);
  });

  it("only matches methods that have companion functions", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  missingMethod(): void;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry!.methods!.size).toBe(2);
    expect(entry!.methods!.has("map")).toBe(true);
    expect(entry!.methods!.has("flatMap")).toBe(true);
    expect(entry!.methods!.has("missingMethod")).toBe(false);
  });

  it("detects identity constructors (PascalCase functions returning the type)", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function Some<A>(a: A): Option<A> {
  return a as unknown as Option<A>;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry!.constructors).toBeDefined();
    expect(entry!.constructors!.get("Some")).toEqual({ kind: "identity" });
  });

  it("detects constant constructors (exported const values of the type)", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export const None: Option<never> = null as unknown as Option<never>;
`;

    const entry = runOpaqueMacro(source);

    expect(entry!.constructors).toBeDefined();
    expect(entry!.constructors!.get("None")).toBeDefined();
    expect(entry!.constructors!.get("None")!.kind).toBe("constant");
    expect(entry!.constructors!.get("None")!.value).toBe("null");
  });

  it("sets sourceModule from the file path", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return null as any;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry!.sourceModule).toBeDefined();
    expect(entry!.sourceModule!.length).toBeGreaterThan(0);
  });

  it("handles interface with no companion functions gracefully", () => {
    const source = `
/** @opaque number */
export interface Meters {
  add(other: Meters): Meters;
  toNumber(): number;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    expect(entry!.typeName).toBe("Meters");
    expect(entry!.underlyingTypeText).toBe("number");
    expect(entry!.methods).toBeUndefined();
  });

  it("handles full Option example with all features", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  fold<B>(onNone: () => B, onSome: (a: A) => B): B;
  getOrElse(defaultValue: () => A): A;
  filter(predicate: (a: A) => boolean): Option<A>;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function flatMap<A, B>(o: Option<A>, f: (a: A) => Option<B>): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function fold<A, B>(o: Option<A>, onNone: () => B, onSome: (a: A) => B): B {
  return (o as any) === null ? onNone() : onSome(o as any);
}

export function getOrElse<A>(o: Option<A>, defaultValue: () => A): A {
  return (o as any) === null ? defaultValue() : (o as any);
}

export function filter<A>(o: Option<A>, predicate: (a: A) => boolean): Option<A> {
  return (o as any) === null ? null as any : predicate(o as any) ? o : null as any;
}

export function Some<A>(a: A): Option<A> {
  return a as unknown as Option<A>;
}

export const None: Option<never> = null as unknown as Option<never>;

export function isSome<A>(o: Option<A>): boolean {
  return (o as any) !== null;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    expect(entry!.typeName).toBe("Option");
    expect(entry!.underlyingTypeText).toBe("A | null");
    expect(entry!.transparent).toBe(true);

    // Methods
    expect(entry!.methods!.size).toBe(5);
    expect(entry!.methods!.get("map")).toBe("map");
    expect(entry!.methods!.get("flatMap")).toBe("flatMap");
    expect(entry!.methods!.get("fold")).toBe("fold");
    expect(entry!.methods!.get("getOrElse")).toBe("getOrElse");
    expect(entry!.methods!.get("filter")).toBe("filter");

    // Constructors
    expect(entry!.constructors).toBeDefined();
    expect(entry!.constructors!.get("Some")).toEqual({ kind: "identity" });
    expect(entry!.constructors!.get("None")).toBeDefined();
    expect(entry!.constructors!.get("None")!.kind).toBe("constant");
  });

  it("detects identity accessors from property signatures (value)", () => {
    const source = `
/** @opaque A | null */
export interface Option<A> {
  readonly value: A;
  map<B>(f: (a: A) => B): Option<B>;
}

export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return (o as any) === null ? null as any : f(o as any);
}

export function Some<A>(a: A): Option<A> {
  return a as unknown as Option<A>;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    expect(entry!.accessors).toBeDefined();
    expect(entry!.accessors!.get("value")).toEqual({ kind: "identity" });
  });

  it("does not register non-value properties as accessors", () => {
    const source = `
/** @opaque number */
export interface Meters {
  readonly raw: number;
  add(other: Meters): Meters;
}

export function add(a: Meters, b: Meters): Meters {
  return ((a as any) + (b as any)) as any;
}
`;

    const entry = runOpaqueMacro(source);

    expect(entry).toBeDefined();
    // Only "value" is auto-detected as an identity accessor
    expect(entry!.accessors).toBeUndefined();
  });
});
