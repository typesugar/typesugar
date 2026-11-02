/**
 * Docs review 2026-10 (docs-guides-a #8): the Json derive's `fromJson({})`
 * returned `{}` — every field check was guarded by `obj.f !== undefined`, so
 * a missing REQUIRED field was silently accepted. These tests derive Json via
 * the real strategy, print + transpile the instance, and call `fromJson`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { tryDeriveViaGeneric, clearDerivationCaches } from "./auto-derive.js";

beforeEach(() => clearDerivationCaches());

interface JsonInstance {
  toJson(a: unknown): unknown;
  fromJson(json: unknown): unknown;
}

/** Derive `Json` for the first class/interface/alias in `source` and evaluate it. */
function deriveJson(source: string, strict: boolean): JsonInstance {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "json-derive-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  try {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict,
      noEmit: true,
    };
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options));
    const sf = program.getSourceFile(filePath)!;
    let text = "";
    ts.transform(sf, [
      (tctx) => {
        const ctx = createMacroContext(program, sf, tctx);
        const decl = sf.statements.find(
          (s): s is ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
            ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)
        )!;
        const result = tryDeriveViaGeneric(ctx, "Json", decl.name!.text, decl);
        expect(result.expression).not.toBeNull();
        text = ts.createPrinter().printNode(ts.EmitHint.Expression, result.expression!, sf);
        return (n) => n;
      },
    ]);
    const js = ts.transpileModule(`module.exports = ${text};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} as JsonInstance };
    new Function("module", "exports", js)(mod, mod.exports);
    return mod.exports;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe.each([true, false])("Json derive fromJson (strict: %s)", (strict) => {
  const userClass = `
    export class User {
      constructor(public id: number, public name: string, public nick?: string) {}
    }
  `;

  it("rejects an object missing a required field", () => {
    const Json = deriveJson(userClass, strict);
    expect(() => Json.fromJson({})).toThrow("Missing required field id");
    expect(() => Json.fromJson({ id: 1 })).toThrow("Missing required field name");
  });

  it("accepts an object that omits only optional fields", () => {
    const Json = deriveJson(userClass, strict);
    expect(Json.fromJson({ id: 1, name: "a" })).toEqual({ id: 1, name: "a" });
  });

  it("still type-checks present fields, required and optional", () => {
    const Json = deriveJson(userClass, strict);
    expect(() => Json.fromJson({ id: "1", name: "a" })).toThrow("Field id must be number");
    expect(() => Json.fromJson({ id: 1, name: "a", nick: 3 })).toThrow("Field nick must be string");
  });

  it("applies to interfaces too", () => {
    const Json = deriveJson(`export interface P { x: number; label?: string }`, strict);
    expect(() => Json.fromJson({ label: "l" })).toThrow("Missing required field x");
    expect(Json.fromJson({ x: 1 })).toEqual({ x: 1 });
  });
});
