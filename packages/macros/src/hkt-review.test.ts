/**
 * Deep review macros-other #14: Tier-3 `@hkt` aliases must have EVERY `_`
 * marker replaced, whatever node kind it sits under (readonly arrays,
 * method signatures, index signatures, property signatures...), and the
 * emitted interface must actually type-check and apply correctly.
 *
 * Each case expands the alias, prints the interface next to a minimal
 * TypeFunction/Apply prelude, and type-checks a correct and an incorrect use.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { hktAttribute } from "./hkt.js";

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

function expandAlias(source: string, name: string): { printed: string; errors: string[] } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hkt-review-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);
  try {
    const program = ts.createProgram([filePath], options, ts.createCompilerHost(options, true));
    const sf = program.getSourceFile(filePath)!;
    const alias = sf.statements.find(
      (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name
    )!;
    let printed = "";
    let errors: string[] = [];
    ts.transform(sf, [
      (tctx) => {
        const ctx = createMacroContext(program, sf, tctx);
        const deco = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
        const out = hktAttribute.expand(ctx, deco, alias, []);
        const nodes = Array.isArray(out) ? out : [out];
        const printer = ts.createPrinter({ removeComments: true });
        printed = nodes.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
        errors = ctx
          .getDiagnostics()
          .filter((d) => d.severity === "error")
          .map((d) => d.message);
        return (s) => s;
      },
    ]);
    return { printed, errors };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const prelude = `
interface TypeFunction { readonly __kind__: unknown; readonly _: unknown }
type Apply<F extends TypeFunction, A> = (F & { readonly __kind__: A })["_"];
`;

function typeErrors(text: string): string[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hkt-review-tc-"));
  const filePath = path.join(tmpDir, "out.ts");
  fs.writeFileSync(filePath, text);
  try {
    const program = ts.createProgram([filePath], options);
    return ts
      .getPreEmitDiagnostics(program, program.getSourceFile(filePath))
      .map(
        (d) =>
          `${d.file ? d.file.getLineAndCharacterOfPosition(d.start!).line + 1 : "?"}: ` +
          ts.flattenDiagnosticMessageText(d.messageText, "\n")
      );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Expand `type <name> = <rhs>` (with `_` as the hole), then check that
 * `good` type-checks as `Apply<name, number>` and `bad` does not.
 */
function checkHkt(name: string, rhs: string, good: string, bad: string): void {
  const { printed, errors } = expandAlias(
    `type _ = never & "__kind__";\n/** @hkt */ type ${name} = ${rhs};`,
    name
  );
  expect(errors).toEqual([]);
  // No `_` reference may survive in the emitted body.
  expect(printed, printed).not.toMatch(/(?<![\w$"'])_(?![\w$"':])/);
  const file = `${prelude}\n${printed}\nexport const good: Apply<${name}, number> = ${good};\n`;
  expect(typeErrors(file), file).toEqual([]);
  const badFile = `${prelude}\n${printed}\nexport const bad: Apply<${name}, number> = ${bad};\n`;
  const badErrors = typeErrors(badFile);
  expect(badErrors.length, badFile).toBeGreaterThan(0);
  // The only error must be the deliberate one on the last line, not in the
  // generated interface.
  const lastLine = badFile.trimEnd().split("\n").length;
  expect(
    badErrors.every((e) => e.startsWith(`${lastLine}:`)),
    badErrors.join("\n")
  ).toBe(true);
}

describe("@hkt #14: markers under every node kind are replaced", () => {
  it("readonly _[]", () => {
    checkHkt("ROArrF", "readonly _[]", "[1, 2] as readonly number[]", `["s"] as readonly string[]`);
  });

  it("method signature in a type literal: { get(): _ }", () => {
    checkHkt("GetF", "{ get(): _ }", "{ get: () => 1 }", `{ get: () => "s" }`);
  });

  it("index signature: { [k: string]: _ }", () => {
    checkHkt("KeyedF", "{ [k: string]: _ }", "{ a: 1 }", `{ a: "s" }`);
  });

  it("property signature: { value: _ }", () => {
    checkHkt("ObjF", "{ value: _ }", "{ value: 1 }", `{ value: "s" }`);
  });

  it("nested: Promise<{ items: readonly _[] }>", () => {
    checkHkt(
      "NestF",
      "Promise<{ items: readonly _[] }>",
      "Promise.resolve({ items: [1] as readonly number[] })",
      `Promise.resolve({ items: ["s"] as readonly string[] })`
    );
  });

  it('function type and plain generic still use this["__kind__"] directly', () => {
    checkHkt("FnF", "(a: _) => void", "(a: number) => {}", `(a: string) => {}`);
    const { printed } = expandAlias(
      `type _ = never & "__kind__";\n/** @hkt */ type ArrayF = Array<_>;`,
      "ArrayF"
    );
    expect(printed).toContain('Array<this["__kind__"]>');
  });
});
