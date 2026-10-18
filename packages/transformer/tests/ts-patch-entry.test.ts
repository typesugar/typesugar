/**
 * Deep review, transformer findings #1, #2, #18.
 *
 * #2: ts-patch (`{ "transform": "@typesugar/transformer", "type": "program" }`,
 * what `typesugar init` writes) calls the default export as
 * `factory(program, pluginConfig, extras)` with ITS OWN extras object as the
 * third argument. The factory used to treat that as a TransformerState and
 * crash (`state.hasLoadedMacroPackages is not a function`) on every patched
 * tsc run.
 *
 * #1: TypeScript discards diagnostics a `before` transformer reports via
 * `context.addDiagnostic` during `program.emit()`, so macro errors never
 * failed a build. They now travel through a side channel: ts-patch's
 * `extras.addDiagnostic`, `config.onDiagnostic`, or `TransformerState`.
 *
 * #18: createPipeline silently ignored tsconfig errors.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { fileURLToPath } from "url";
import tsPatchEntry, { macroTransformerFactory, TransformerState } from "../src/index.js";
import { createPipeline } from "../src/pipeline.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
};

let dir: string;
let mainPath: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tspatch-"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  mainPath = path.join(dir, "main.ts");
  fs.writeFileSync(
    mainPath,
    `import { comptime } from "typesugar";\nexport const x = comptime(() => { throw new Error("boom-tspatch"); });\n`
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function messages(diags: readonly ts.Diagnostic[]): string {
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("\n");
}

describe("ts-patch entry point (default export)", () => {
  it("accepts ts-patch's (program, pluginConfig, extras) signature without crashing", () => {
    const program = ts.createProgram([mainPath], options);
    const added: ts.Diagnostic[] = [];
    const extras = {
      ts,
      library: "typescript",
      diagnostics: added,
      addDiagnostic: (d: ts.Diagnostic) => added.push(d),
      removeDiagnostic: (i: number) => void added.splice(i, 1),
    };
    // ts-patch strips `transform`/`type` and passes the remaining options.
    const factory = tsPatchEntry(program, {}, extras);
    const emitResult = program.emit(undefined, () => {}, undefined, false, { before: [factory] });

    expect(emitResult.emitSkipped).toBe(false);
    // The macro error reaches ts-patch, which merges it into tsc's output.
    expect(messages(added)).toContain("boom-tspatch");
    expect(added.some((d) => d.category === ts.DiagnosticCategory.Error)).toBe(true);
  });

  it("onDiagnostic side channel receives macro errors that program.emit() drops", () => {
    const program = ts.createProgram([mainPath], options);
    const seen: ts.Diagnostic[] = [];
    const factory = macroTransformerFactory(program, { onDiagnostic: (d) => seen.push(d) });
    const emitResult = program.emit(undefined, () => {}, undefined, false, { before: [factory] });

    // TypeScript itself drops them -- the reason the side channel exists.
    expect(messages(emitResult.diagnostics)).not.toContain("boom-tspatch");
    expect(messages(seen)).toContain("boom-tspatch");
  });

  it("TransformerState collects macro diagnostics across emits (watch mode)", () => {
    const program = ts.createProgram([mainPath], options);
    const state = new TransformerState({ cacheDir: false });
    const factory = macroTransformerFactory(program, {}, state);
    program.emit(undefined, () => {}, undefined, false, { before: [factory] });

    const taken = state.takeDiagnostics();
    expect(messages(taken)).toContain("boom-tspatch");
    expect(state.takeDiagnostics()).toEqual([]);
  });
});

describe("createPipeline tsconfig errors (#18)", () => {
  it("throws on tsconfig errors instead of silently dropping them", () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-cfgerr-"));
    try {
      fs.writeFileSync(path.join(cfgDir, "a.ts"), "export const a = 1;\n");
      const cfg = path.join(cfgDir, "tsconfig.json");
      fs.writeFileSync(
        cfg,
        JSON.stringify({ compilerOptions: { target: "not-a-target" }, include: ["*.ts"] })
      );
      expect(() => createPipeline(cfg)).toThrow(/target/);
    } finally {
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});
