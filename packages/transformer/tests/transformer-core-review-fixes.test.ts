/**
 * transformer-core pre-merge review (2026-11-02), checked through the real
 * ts-patch emit path (`program.emit` with the typesugar transformer).
 *
 * Removing a macro-only import copies its leading comments onto a placeholder
 * statement. For the file's first statement those include the file header,
 * which the emitter could also print as the source file's detached comments:
 * the header must come out exactly once.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import macroTransformerFactory from "../src/index.js";

// Load macro definitions
import "@typesugar/macros";

function emit(fileName: string, source: string): string {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => (f === fileName ? source : readFile(f));
  host.fileExists = (f) => f === fileName || ts.sys.fileExists(f);
  const program = ts.createProgram([fileName], options, host);
  const out: Record<string, string> = {};
  const result = program.emit(
    undefined,
    (f, text) => {
      out[f] = text;
    },
    undefined,
    false,
    { before: [macroTransformerFactory(program, { verbose: false })] }
  );
  expect(result.emitSkipped).toBe(false);
  return out[fileName.replace(/\.ts$/, ".js")];
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("removing a macro-only first import emits the file header once", () => {
  for (const [label, header] of [
    ["a detached license block", ["/*!", " * License MIT", " */", "", "// second line"]],
    ["an attached header", ["// header line", "/** doc comment */"]],
  ] as const) {
    it(label, () => {
      const js = emit(
        "header-once.ts",
        [
          ...header,
          `import { comptime } from "typesugar";`,
          "",
          `export const answer = comptime(21 * 2);`,
          "",
        ].join("\n")
      );
      expect(js).toContain("answer = 42");
      expect(js).not.toContain("typesugar");
      for (const line of header.filter((l) => l.trim() !== "")) {
        expect(count(js, line)).toBe(1);
      }
    });
  }
});
