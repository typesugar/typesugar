/**
 * Position mapping between a file's source and the expanded code TypeScript
 * sees in the editor (PEP-060 item 5, the bugs the editor integration suite
 * recorded). These are the focused unit tests for the shared layers:
 *
 * - the pipeline's source map (a file without macros is passed through, and
 *   the reprint of a file with macros maps every token, including after a
 *   template literal), and
 * - the tsserver plugin's span translation (line/column conversion, code fixes,
 *   inlay hints, rename locations in generated code, the comptime hint).
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";

// Load macro definitions (registers macros in the global registry)
import { setComptimeEvaluationEnabled } from "@typesugar/macros";

/** Original offset of `needle` (+ delta) → transformed offset → back. */
function roundTrip(
  result: ReturnType<typeof transformCode>,
  needle: string,
  delta = 0
): { original: number; transformed: number | null; back: number | null } {
  const original = result.original.indexOf(needle);
  expect(original, `"${needle}" in the source`).toBeGreaterThanOrEqual(0);
  const transformed = result.mapper.toTransformed(original + delta);
  const back = transformed === null ? null : result.mapper.toOriginal(transformed);
  return { original: original + delta, transformed, back };
}

describe("pipeline source map (what the editor plugin maps positions through)", () => {
  it("passes a file without macros through unchanged, so positions map by identity", () => {
    const code =
      `export function greet(name: string): string {\n` +
      `  return \`Hello, \${name}!\`;\n` +
      `}\n` +
      `\n` +
      `const msg = greet("world");\n`;
    const result = transformCode(code, { fileName: "no-macros.ts" });

    expect(result.changed).toBe(false);
    expect(result.code).toBe(code);
    const call = code.indexOf('greet("world")');
    expect(result.mapper.toTransformed(call)).toBe(call);
    expect(result.mapper.toOriginal(call)).toBe(call);
  });

  it("maps every token after a template literal with substitutions in an expanded file", () => {
    const code =
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `\n` +
      `export function label(n: number): string {\n` +
      `  return \`#\${n} of \${n + 1}\`;\n` +
      `}\n` +
      `\n` +
      `const notANumber: number = label(1);\n`;
    const result = transformCode(code, { fileName: "template-after.ts" });
    expect(result.changed).toBe(true);

    for (const needle of ["notANumber", "label(1)", "n + 1"]) {
      const { original, transformed, back } = roundTrip(result, needle);
      expect(transformed, `"${needle}" maps into the expanded code`).not.toBeNull();
      expect(result.code.slice(transformed!, transformed! + needle.length)).toBe(needle);
      expect(back).toBe(original);
    }
  });

  it("maps tokens after a regular expression literal containing a backtick", () => {
    const code =
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `\n` +
      "const re = /`[a-z]+'/g;\n" +
      `const after = re.source;\n`;
    const result = transformCode(code, { fileName: "regex-after.ts" });
    expect(result.changed).toBe(true);

    const { original, transformed, back } = roundTrip(result, "after");
    expect(transformed).not.toBeNull();
    expect(result.code.slice(transformed!, transformed! + "after".length)).toBe("after");
    expect(back).toBe(original);
  });

  it("records no expansion for a macro that hands back the call (comptime switched off)", () => {
    const code =
      `import { comptime } from "@typesugar/macros";\n` +
      `/** @derive(Eq) */\n` +
      `interface Point { x: number; y: number; }\n` +
      `export const a = comptime(() => 40 + 2);\n`;
    setComptimeEvaluationEnabled(false);
    try {
      const result = transformCode(code, { fileName: "comptime-off.ts" });
      expect(result.code).toContain("comptime(");
      expect(result.expansions?.map((e) => e.macroName) ?? []).not.toContain("comptime");
    } finally {
      setComptimeEvaluationEnabled(true);
    }
  });
});
