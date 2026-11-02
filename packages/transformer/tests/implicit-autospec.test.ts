/**
 * A call completed by `= implicit()` is auto-specialized exactly as the
 * explicit call `showValue(42, showNumber)` would be (Dean's decision
 * 2026-10-19, superseding the PEP-056 parity choice in commit 7210ac66, which
 * kept implicit calls as plain dictionary passing).
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";

const PRELUDE = `
import { summon, implicit } from "typesugar";

/** @typeclass */
interface Show<A> {
  show(value: A): string;
}

/** @impl Show<number> */
const showNumber: Show<number> = {
  show: (n) => String(n),
};
`;

/** Transpile to CJS and run; returns what `result` evaluated to. */
function runResult(code: string): unknown {
  const js = ts.transpileModule(`${code}\nexports.__result = result;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    if (m === "typesugar") return { implicit: () => undefined, summon: () => undefined };
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return exports.__result;
}

describe("implicit resolution is followed by auto-specialization", () => {
  it("showValue(42) becomes a hoisted specialization with show inlined, and runs", () => {
    const code = `${PRELUDE}
function showValue(value: number, S: Show<number> = implicit()): string {
  return S.show(value);
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-inline.ts" });

    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toMatch(/const result = __typesugar___showValue_\w+__\(42\);/);
    expect(r.code).not.toContain("showValue(42, showNumber)");
    expect(runResult(r.code)).toBe("42");
  });

  it("keeps the wrapper logic of a non-trivial body in the specialization, and runs", () => {
    const code = `${PRELUDE}
function showValue(value: number, S: Show<number> = implicit()): string {
  return \`show \${S.show(value)}\`;
}

const result = showValue(42);
`;

    const r = transformCode(code, { fileName: "test-impl-template.ts" });

    // Resolved via scope (PEP-052): the in-scope @impl const `showNumber`,
    // then specialized; the template wrapper survives in the hoisted body.
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.code).toMatch(/const result = __typesugar___showValue_\w+__\(42\);/);
    expect(r.code).not.toContain("showValue(42, showNumber)");
    expect(runResult(r.code)).toBe("show 42");
  });
});
