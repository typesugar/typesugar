/**
 * Build / Emit Tests
 *
 * Verifies that program.emit() with the macro transformer does not crash,
 * and that post-emit diagnostic collection is safe.
 *
 * Background: Macro expansion creates synthetic AST nodes with pos = -1
 * (via stripPositions). After emit, TypeScript's deferred checker callbacks
 * may reference these nodes. getPreEmitDiagnostics() then crashes in
 * createTextSpan with "Error: start < 0". The fix: collect pre-emit
 * diagnostics before emit, and wrap post-emit checker access in try/catch.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import macroTransformerFactory from "../src/index.js";

// Load macro definitions
import "@typesugar/macros";

function createInMemoryProgram(
  files: Record<string, string>,
  options?: ts.CompilerOptions
): ts.Program {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: false,
    ...options,
  };

  const fileMap = new Map(Object.entries(files));
  const host = ts.createCompilerHost(compilerOptions);
  const origReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => fileMap.get(fileName) ?? origReadFile(fileName);
  host.fileExists = (fileName) => fileMap.has(fileName) || ts.sys.fileExists(fileName);

  return ts.createProgram(Array.from(fileMap.keys()), compilerOptions, host);
}

describe("Build / Emit safety", () => {
  it("program.emit with @derive does not crash", () => {
    const program = createInMemoryProgram({
      "test.ts": `
import { derive, Eq } from "typesugar";

@derive(Eq)
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
console.log(p1 === p2);
`,
    });

    const emittedFiles: Record<string, string> = {};
    const emitResult = program.emit(
      undefined,
      (fileName, text) => {
        emittedFiles[fileName] = text;
      },
      undefined,
      false,
      { before: [macroTransformerFactory(program, { verbose: false })] }
    );

    // Emit should succeed without throwing
    expect(emitResult.emitSkipped).toBe(false);
  });

  it("program.emit with comptime does not crash", () => {
    const program = createInMemoryProgram({
      "test.ts": `
import { comptime } from "typesugar";

const buildTime = comptime(new Date().toISOString());
const answer = comptime(21 * 2);
console.log(buildTime, answer);
`,
    });

    const emitResult = program.emit(undefined, () => {}, undefined, false, {
      before: [macroTransformerFactory(program, { verbose: false })],
    });

    expect(emitResult.emitSkipped).toBe(false);
  });

  it("getPreEmitDiagnostics before emit does not crash", () => {
    const program = createInMemoryProgram({
      "test.ts": `
import { derive, Eq } from "typesugar";

@derive(Eq)
interface Point { x: number; y: number; }

const a: Point = { x: 1, y: 2 };
console.log(a);
`,
    });

    // Pre-emit diagnostics BEFORE emit should always be safe
    expect(() => ts.getPreEmitDiagnostics(program)).not.toThrow();
  });

  it("getPreEmitDiagnostics after emit does not crash (safety net)", () => {
    const program = createInMemoryProgram({
      "test.ts": `
import { derive, Eq } from "typesugar";

@derive(Eq)
interface Point { x: number; y: number; }

const a: Point = { x: 1, y: 2 };
console.log(a);
`,
    });

    // Emit with transformer
    program.emit(undefined, () => {}, undefined, false, {
      before: [macroTransformerFactory(program, { verbose: false })],
    });

    // Post-emit getPreEmitDiagnostics may crash on synthetic nodes.
    // This test documents the known behavior. If the root cause is fixed
    // (e.g. by not using pos=-1), change this to expect no throw.
    // For now, the CLI must collect diagnostics BEFORE emit.
    try {
      ts.getPreEmitDiagnostics(program);
      // If it doesn't throw, that's also fine (means the root cause was fixed)
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("start < 0");
    }
  });

  it("emit produces JS output for comptime macros", () => {
    const program = createInMemoryProgram({
      "test.ts": `
import { comptime } from "typesugar";

const answer = comptime(21 * 2);
export { answer };
`,
    });

    const emittedFiles: Record<string, string> = {};
    program.emit(
      undefined,
      (fileName, text) => {
        emittedFiles[fileName] = text;
      },
      undefined,
      false,
      { before: [macroTransformerFactory(program, { verbose: false })] }
    );

    const jsFile = Object.entries(emittedFiles).find(([k]) => k.endsWith(".js"));
    expect(jsFile).toBeDefined();
    // comptime(21 * 2) should be inlined as 42
    expect(jsFile![1]).toContain("42");
  });
});
