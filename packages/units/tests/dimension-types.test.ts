/**
 * MU-2 / MU-20: compile-time dimension checking.
 *
 * Type-checks tests/fixtures/dimension-checks.ts with the real TypeScript
 * compiler. That fixture marks every dimension mismatch with `@ts-expect-error`,
 * so if `Unit<D>` stops using `D` structurally (MU-2), or exponent arithmetic
 * saturates into a valid exponent (MU-20), the directives become unused and
 * TypeScript reports TS2578 — which this test surfaces.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures/dimension-checks.ts");

describe("Unit<D> compile-time dimension checking", () => {
  it("rejects every mismatched-dimension line and accepts every valid one", () => {
    const program = ts.createProgram([fixture], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"],
      skipLibCheck: true,
    });
    const diags = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === fixture || d.file === undefined)
      .map((d) => {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        if (!d.file || d.start === undefined) return `TS${d.code}: ${msg}`;
        const { line } = d.file.getLineAndCharacterOfPosition(d.start);
        return `line ${line + 1}: TS${d.code}: ${msg}`;
      });
    expect(diags).toEqual([]);
  });
});
