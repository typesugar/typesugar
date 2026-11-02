/**
 * Deep review macros-other #12(c): a macro call nested inside a syntax-macro
 * capture must still be expanded. The expansion used to print the capture
 * and re-parse it, which made it synthetic — and the transformer skips macro
 * expansion on synthetic nodes — so `sq(dbl(3))` left `dbl(3)` in the output.
 *
 * Runs the real macro transformer and executes the result.
 */

import { describe, it, expect, afterAll } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vm from "vm";
import macroTransformerFactory from "@typesugar/transformer";
import { defineSyntaxMacro } from "@typesugar/macros";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syntax-nested-"));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

defineSyntaxMacro("tsNestSq", { pattern: "tsNestSq($x:expr)", expand: "$x * $x" });
defineSyntaxMacro("tsNestDbl", { pattern: "tsNestDbl($x:expr)", expand: "$x + $x" });

function transform(source: string): string {
  const file = path.join(tmpDir, `t${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(file, source);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const program = ts.createProgram([file], options);
  const res = ts.transform(program.getSourceFile(file)!, [
    macroTransformerFactory(program, { verbose: false, cacheDir: false } as any),
  ]);
  const out = ts.createPrinter().printFile(res.transformed[0]);
  res.dispose();
  return out;
}

function run(tsText: string): Record<string, unknown> {
  const js = ts.transpileModule(tsText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(js, { module: mod, exports: mod.exports }, { timeout: 2000 });
  return mod.exports;
}

describe("syntax macros: nested macro calls inside captures", () => {
  it("expands the inner macro and computes the right value", () => {
    // No local declarations: a locally declared name shadows the macro.
    const out = transform(`
export const v = tsNestSq(tsNestDbl(3));
export const w = tsNestSq(1 + 2);
`);
    const exportLines = out.split("\n").filter((l) => l.startsWith("export const"));
    expect(exportLines.join("\n"), out).not.toMatch(/tsNest/);
    const exports = run(out);
    expect(exports.v).toBe(36);
    expect(exports.w).toBe(9);
  });
});
