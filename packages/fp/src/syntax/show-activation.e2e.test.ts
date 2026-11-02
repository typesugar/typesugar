/**
 * Docs review r3 (start #4): `import "@typesugar/fp/syntax/show"` on its own
 * must activate `.show()` method syntax. It used to need an extra
 * `import type { Show } from "@typesugar/fp"`: method sugar reads the
 * typeclass's methods from its `@typeclass` declaration in the program, and
 * the marker module did not pull that declaration in, so `p.show()` stayed a
 * plain call (TypeError at runtime).
 *
 * Runs the REAL transformer against the built dists — needs
 * `pnpm --filter @typesugar/fp build`.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../../../__fp_show_e2e_input.ts");

function expandAndRun(src: string): { code: string; out: Record<string, any> } {
  const r = transformCode(src, { fileName: FILE });
  const js = ts.transpileModule(r.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const require = (id: string) => {
    if (id === "@typesugar/fp/syntax/show" || id === "typesugar") return {};
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(require, mod, mod.exports);
  return { code: r.code, out: mod.exports };
}

describe("@typesugar/fp/syntax/show activates .show() on its own (docs review r3 start #4)", () => {
  it("derived Show + marker import only", () => {
    const { code, out } = expandAndRun(`
import { derive } from "typesugar";
import "@typesugar/fp/syntax/show";

@derive(Show)
interface Point { x: number; y: number; }

const p: Point = { x: 1, y: 2 };
export const s = p.show();
`);
    expect(code).toContain("Point.Show.show(p)");
    expect(out.s).toBe("Point(x = 1, y = 2)");
  });
});
