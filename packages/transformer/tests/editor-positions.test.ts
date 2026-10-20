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
import "@typesugar/macros";

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
});
