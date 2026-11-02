/**
 * Deep review macros-other #11, #15 and the cross-owner ledger item for #3.
 *
 * The generated type guards and constructors are EXECUTED (transpiled and run
 * in a vm context), and the generated declarations are type-checked under
 * `strict`, rather than only grepping printed text.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vm from "vm";
import { clearTypeRewrites, getTypeRewrite, type TypeRewriteEntry } from "@typesugar/core";
import { createMacroContext } from "@typesugar/core";
import { adtAttribute } from "./adt.js";

const strictOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

interface Expanded {
  /** The whole file with the @adt alias replaced by the expansion. */
  fileText: string;
  fileName: string;
  errors: string[];
  entry: TypeRewriteEntry | undefined;
  /** Exports of the transpiled, executed file. */
  exports: Record<string, any>;
}

function expandAdt(source: string): Expanded {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adt-review-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  try {
    // Parent pointers are needed for JSDoc tag lookup.
    const host = ts.createCompilerHost(strictOptions, true);
    const program = ts.createProgram([filePath], strictOptions, host);
    const sf = program.getSourceFile(filePath)!;
    const target = sf.statements.find(
      (s): s is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(s) && ts.getJSDocTags(s).some((t) => t.tagName.text === "adt")
    )!;
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    let fileText = "";
    let errors: string[] = [];
    ts.transform(sf, [
      (tctx) => {
        const ctx = createMacroContext(program, sf, tctx);
        const deco = ts.factory.createDecorator(ts.factory.createIdentifier("adt"));
        const out = adtAttribute.expand(ctx, deco, target, []);
        const nodes = Array.isArray(out) ? out : [out];
        errors = ctx
          .getDiagnostics()
          .filter((d) => d.severity === "error")
          .map((d) => d.message);
        fileText = sf.statements
          .map((s) =>
            s === target
              ? nodes.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n")
              : printer.printNode(ts.EmitHint.Unspecified, s, sf)
          )
          .join("\n");
        return (s) => s;
      },
    ]);
    const js = ts.transpileModule(fileText, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const moduleObj = { exports: {} as Record<string, any> };
    vm.runInNewContext(js, { module: moduleObj, exports: moduleObj.exports });
    return {
      fileText,
      fileName: filePath,
      errors,
      entry: getTypeRewrite(target.name.text),
      exports: moduleObj.exports,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Type-check a whole file under strict mode; returns the error messages. */
function typeErrors(fileText: string): string[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adt-review-tc-"));
  const filePath = path.join(tmpDir, "out.ts");
  fs.writeFileSync(filePath, fileText);
  try {
    const program = ts.createProgram([filePath], strictOptions);
    return ts
      .getPreEmitDiagnostics(program, program.getSourceFile(filePath))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

beforeEach(() => clearTypeRewrites());

describe("@adt #11: type guards are safe and exact", () => {
  const list = `
export interface Cons<A> { readonly head: A; readonly tail: List<A> }
export interface Nil {}
/** @adt { Nil: null } */
export type List<A> = Cons<A> | Nil;
`;

  it("isCons(Nil) returns false instead of throwing on null", () => {
    const { exports, errors } = expandAdt(list);
    expect(errors).toEqual([]);
    expect(exports.isCons(null)).toBe(false);
    expect(exports.isNil(null)).toBe(true);
    const one = exports.Cons(1, null);
    expect(exports.isCons(one)).toBe(true);
    expect(exports.isNil(one)).toBe(false);
  });

  it("a shared optional field does not misclassify a variant", () => {
    const { exports, errors } = expandAdt(`
export interface Circle { radius: number; label?: string }
export interface Square { side: number; label?: string }
export interface Labeled { label: string }
/** @adt */
export type Shape = Circle | Square | Labeled;
`);
    expect(errors).toEqual([]);
    const labelledCircle = { radius: 1, label: "c" };
    expect(exports.isCircle(labelledCircle)).toBe(true);
    expect(exports.isLabeled(labelledCircle)).toBe(false);
    expect(exports.isSquare(labelledCircle)).toBe(false);
    const labelled = exports.Labeled("x");
    expect(exports.isLabeled(labelled)).toBe(true);
    expect(exports.isCircle(labelled)).toBe(false);
    expect(exports.isSquare({ side: 2, label: "s" })).toBe(true);
    expect(exports.isLabeled({ side: 2, label: "s" })).toBe(false);
  });

  it("Either with `?: undefined` fields: an explicit undefined key doesn't flip the guard", () => {
    const { exports, errors } = expandAdt(`
export interface Left<E, A> { readonly left: E; readonly right?: undefined }
export interface Right<E, A> { readonly left?: undefined; readonly right: A }
/** @adt */
export type Either<E, A> = Left<E, A> | Right<E, A>;
`);
    expect(errors).toEqual([]);
    const r = { left: undefined, right: 1 };
    expect(exports.isRight(r)).toBe(true);
    expect(exports.isLeft(r)).toBe(false);
    const l = { left: "e", right: undefined };
    expect(exports.isLeft(l)).toBe(true);
    expect(exports.isRight(l)).toBe(false);
  });

  it("tagged variants alongside a null variant don't throw on null", () => {
    const { exports, errors } = expandAdt(`
export interface A {}
export interface B {}
export interface N {}
/** @adt { N: null } */
export type T = A | B | N;
`);
    expect(errors).toEqual([]);
    expect(exports.isA(null)).toBe(false);
    expect(exports.isB(null)).toBe(false);
    expect(exports.isA(exports.A())).toBe(true);
    expect(exports.isB(exports.A())).toBe(false);
  });
});

describe("@adt #15: literal members and generic constructors", () => {
  it('rejects a non-null literal member instead of turning "missing" into null', () => {
    const { errors, fileText } = expandAdt(`
export interface Some<A> { readonly value: A }
export interface None {}
/** @adt */
export type Option<A> = Some<A> | None | "missing";
`);
    expect(errors.join("\n")).toMatch(/"missing"/);
    expect(fileText).not.toMatch(/\| null/);
  });

  it("still accepts a literal null member", () => {
    const { errors, exports } = expandAdt(`
export interface Some<A> { readonly value: A }
/** @adt */
export type Opt<A> = Some<A> | null;
`);
    expect(errors).toEqual([]);
    expect(exports.isSome(null)).toBe(false);
    expect(exports.isSome(exports.Some(3))).toBe(true);
  });

  it("generated constructors and guards type-check under strict (type args included)", () => {
    const { fileText, errors } = expandAdt(`
export interface Some<T> { readonly value: T }
export interface None {}
/** @adt */
export type Option<A> = Some<A> | None;
export const n: Option<number> = None();
export const s: Option<string> = Some("x");
`);
    expect(errors).toEqual([]);
    expect(typeErrors(fileText)).toEqual([]);
  });

  it("generic tagged ADTs type-check too", () => {
    const { fileText, errors } = expandAdt(`
export interface Loading {}
export interface Failure<E> { readonly error: E }
export interface Success<A> { readonly data: A }
export interface Stale<A> { readonly data: A }
/** @adt */
export type Remote<E, A> = Loading | Failure<E> | Success<A> | Stale<A>;
export const r: Remote<string, number> = Success(1);
`);
    expect(errors).toEqual([]);
    expect(typeErrors(fileText)).toEqual([]);
  });
});

describe("@adt registration (ledger: erasure resolves symbols)", () => {
  it("registers only null-represented variants as erasable constructors, with declarationFile", () => {
    const { entry, fileName } = expandAdt(`
export interface Cons<A> { readonly head: A; readonly tail: List<A> }
export interface Nil {}
/** @adt { Nil: null } */
export type List<A> = Cons<A> | Nil;
`);
    expect(entry).toBeDefined();
    expect(entry!.declarationFile).toBe(fileName);
    expect([...entry!.constructors!.keys()]).toEqual(["Nil"]);
    expect(entry!.constructors!.get("Nil")).toEqual({ kind: "constant", value: "null" });
  });

  it("an ADT with no null variants registers no constructor rewrites", () => {
    const { entry } = expandAdt(`
export interface Circle { radius: number }
export interface Square { side: number }
export interface Empty {}
/** @adt */
export type Shape = Circle | Square | Empty;
`);
    expect(entry).toBeDefined();
    expect(entry!.constructors).toBeUndefined();
  });
});
