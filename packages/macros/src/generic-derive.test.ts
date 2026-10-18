/**
 * Review finding macros-other #16: @derive(Generic) / @Generic.
 *
 * - `@derive(Generic)` reported "Unknown derive" (Generic was only an
 *   attribute macro; `@derive` dispatches to `globalRegistry.getDerive`).
 * - `@Generic` output called `registerGeneric`/`registerGenericMeta` without
 *   importing them, so the emitted module threw ReferenceError on load.
 * - `deriveShowViaGeneric`/`deriveEqViaGeneric` read `rep.fields[i]` and threw
 *   on the identity representation that `@Generic` produces.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, globalRegistry } from "@typesugar/core";
import {
  genericDerive,
  registerGeneric,
  deriveShowViaGeneric,
  deriveEqViaGeneric,
} from "./generic.js";

function withProgram<T>(source: string, fn: (p: ts.Program, sf: ts.SourceFile) => T): T {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generic-derive-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  try {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
    };
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options));
    return fn(program, program.getSourceFile(filePath)!);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Print statements, transpile to JS and run them; returns the thrown error, if any. */
function runEmitted(statements: readonly ts.Node[], sf: ts.SourceFile): unknown {
  const printer = ts.createPrinter();
  const text = statements.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  try {
    new Function("exports", "require", js)({}, () => ({}));
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("@derive(Generic)", () => {
  it("is registered as a derive macro", () => {
    expect(globalRegistry.getDerive("Generic")).toBeDefined();
  });

  it("derive expansion emits code that loads without ReferenceError", () => {
    withProgram(`class Point { constructor(public x: number, public y: number) {} }`, (p, sf) => {
      const target = sf.statements.find(ts.isClassDeclaration)!;
      let stmts: ts.Statement[] = [];
      ts.transform(sf, [
        (tctx) => {
          const ctx = createMacroContext(p, sf, tctx);
          stmts = globalRegistry.getDerive("Generic")!.expand(ctx, target, {
            name: "Point",
          } as never);
          return (s) => s;
        },
      ]);
      expect(stmts.length).toBeGreaterThan(0);
      expect(runEmitted([target, ...stmts], sf)).toBeUndefined();
    });
  });
});

describe("@Generic attribute output", () => {
  it("loads without ReferenceError", () => {
    withProgram(`class Point { constructor(public x: number, public y: number) {} }`, (p, sf) => {
      const target = sf.statements.find(ts.isClassDeclaration)!;
      let out: ts.Node[] = [];
      ts.transform(sf, [
        (tctx) => {
          const ctx = createMacroContext(p, sf, tctx);
          const r = genericDerive.expand(
            ctx,
            ts.factory.createDecorator(ts.factory.createIdentifier("Generic")),
            target,
            []
          );
          out = Array.isArray(r) ? r : [r];
          return (s) => s;
        },
      ]);
      expect(runEmitted(out, sf)).toBeUndefined();
    });
  });
});

describe("deriveShowViaGeneric / deriveEqViaGeneric with the identity representation", () => {
  interface Pt {
    x: number;
    n: string;
  }
  const identity = { to: (v: Pt) => v, from: (r: Pt) => r };
  const showAny = { show: (a: unknown) => JSON.stringify(a) };
  const eqAny = { eq: (a: unknown, b: unknown) => a === b };

  it("show reads fields by name", () => {
    registerGeneric("IdentityPtShow", identity);
    const s = deriveShowViaGeneric<Pt>("IdentityPtShow", [showAny, showAny], ["x", "n"]);
    expect(s.show({ x: 1, n: "a" })).toBe(`IdentityPtShow(x = 1, n = "a")`);
  });

  it("eq compares fields by name", () => {
    registerGeneric("IdentityPtEq", identity);
    const e = deriveEqViaGeneric<Pt>("IdentityPtEq", [eqAny, eqAny], ["x", "n"]);
    expect(e.eq({ x: 1, n: "a" }, { x: 1, n: "a" })).toBe(true);
    expect(e.eq({ x: 1, n: "a" }, { x: 2, n: "a" })).toBe(false);
  });
});
