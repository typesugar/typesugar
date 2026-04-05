/**
 * PEP-036 Wave 5: Adversarial Red-Team Tests for Source Maps
 *
 * Each test represents a plausible user scenario that exercises dark corners
 * of the source map pipeline. These are designed to break things.
 */

import { describe, it, expect } from "vitest";
import { transformCode, type TransformResult } from "@typesugar/transformer";
import { AMBIENT_DECLARATIONS } from "../api/playground-declarations.js";
import * as path from "path";
import * as ts from "typescript";

// ============================================================================
// Helpers
// ============================================================================

const AMBIENT_FILE = path.resolve(__dirname, "../__playground_ambient__.d.ts");

function transform(code: string, ext = ".ts"): TransformResult {
  return transformCode(code, {
    fileName: path.resolve(`test-redteam${ext}`),
    extraRootFiles: [AMBIENT_FILE],
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });
}

function offsetOf(source: string, needle: string, occurrence = 1): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = source.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`"${needle}" occurrence ${occurrence} not found`);
  }
  return idx;
}

function lineAt(source: string, offset: number): number {
  return source.substring(0, offset).split("\n").length;
}

function expectMapped(result: TransformResult, needle: string, description: string) {
  if (!result.code.includes(needle)) return; // transformed away — can't test
  const origOffset = offsetOf(result.original ?? "", needle);
  const transOffset = offsetOf(result.code, needle);
  const mapped = result.mapper.toOriginal(transOffset);
  expect(
    mapped,
    `${description}: mapper.toOriginal(${transOffset}) returned ${mapped}, expected ${origOffset}`
  ).toBe(origOffset);
}

// ============================================================================
// Adversarial scenarios
// ============================================================================

describe("adversarial source map tests", () => {
  it("expansion at offset 0: macro call is the very first token after import", () => {
    const code = `import { staticAssert } from "typesugar";
staticAssert(false, "at zero");
const after = 1;
`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.message.includes("at zero"));
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "at zero")'));
    expect(errorLine).toBe(expectedLine);
  });

  it("expansion at EOF: macro call is the last token, no trailing newline", () => {
    const code = `import { staticAssert } from "typesugar";
const x = 1;
staticAssert(false, "at eof")`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.message.includes("at eof"));
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "at eof")'));
    expect(errorLine).toBe(expectedLine);
  });

  it("adjacent expansions: two macro calls on same line", () => {
    const code = `import { pipe } from "typesugar";
const a = pipe(1, (n: number) => n + 1); const b = pipe(2, (n: number) => n + 2);
const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const after", "code after adjacent pipe expansions");
  });

  it("nested expansion site: pipe wrapping comptime", () => {
    const code = `import { pipe, comptime } from "typesugar";
const result = pipe(comptime(() => 42), (n: number) => n + 1);
const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const after", "code after nested expansion");
  });

  it("expansion that introduces newlines: single-line call → multi-line output", () => {
    // @derive(Eq) on an interface generates multi-line namespace companion
    const code = `/** @derive(Eq) */
interface Point { x: number; y: number; }
const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    // The expanded code has more lines than the original
    expect(result.code.split("\n").length).toBeGreaterThan(code.split("\n").length);
    expectMapped(result, "const after", "code after newline-introducing expansion");
  });

  it("expansion that removes newlines: multi-line pipe ��� single-line call", () => {
    const code = `import { pipe } from "typesugar";
const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
  (n: number) => n * 2,
);
const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    // The pipe expansion should collapse multi-line to fewer lines
    expectMapped(result, "const after", "code after newline-removing expansion");
  });

  it("100+ lines after expansion: error at line 205 maps correctly", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const code = `import { pipe } from "typesugar";
const result = pipe(42, (n: number) => n + 1);
${filler}
const farAway = "target";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const farAway", "code 200+ lines after expansion");
  });

  it("many small expansions: 20 pipe() calls in one file", () => {
    const pipes = Array.from(
      { length: 20 },
      (_, i) => `const p${i} = pipe(${i}, (n: number) => n + 1);`
    ).join("\n");
    const code = `import { pipe } from "typesugar";
${pipes}
const bottom = "target";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const bottom", "code after 20 pipe expansions");
  });

  it("diagnostic exactly at expansion boundary: error on token immediately after expansion", () => {
    const code = `import { pipe, staticAssert } from "typesugar";
const r = pipe(42, (n: number) => n + 1);staticAssert(false, "boundary");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.message.includes("boundary"));
    expect(errors.length).toBeGreaterThan(0);

    // The error should be on the same line as the pipe (line 2), after the pipe expansion
    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "boundary")'));
    expect(errorLine, "diagnostic at expansion boundary").toBe(expectedLine);
  });

  it("source map with empty mappings: graceful handling", () => {
    // A file with no transformations should work via identity mapper
    const code = `const x = 1;
const y = 2;
const z = 3;
`;
    const result = transform(code);
    expect(result.changed).toBe(false);

    // Identity mapper should handle all positions
    for (let i = 0; i < code.length; i++) {
      const mapped = result.mapper.toOriginal(i);
      expect(mapped, `identity mapping at offset ${i}`).toBe(i);
    }
  });

  it("extremely long single line (10KB): macro expansion on a long line", () => {
    const longStr = "x".repeat(10000);
    const code = `import { pipe } from "typesugar";
const big = "${longStr}";
const result = pipe(42, (n: number) => n + 1);
const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const after", "code after 10KB line + pipe expansion");
  });

  it("multiple @derive expansions in sequence", () => {
    const code = `/** @derive(Eq) */
interface Point { x: number; y: number; }

/** @derive(Eq) */
interface Color { r: number; g: number; b: number; }

const after = "end";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expectMapped(result, "const after", "code after two @derive expansions");
  });

  it("pipe operator (|>) on .sts with many stages", () => {
    const stages = Array.from({ length: 15 }, () => `((n: number) => n + 1)`).join(" |> ");
    const code = `const result = 0 |> ${stages};
const after = "end";
`;
    const result = transform(code, ".sts");
    expect(result.changed).toBe(true);
    expectMapped(result, "const after", "code after 15-stage |> chain");
  });
});

// ============================================================================
// Diagnostic position invariants
// ============================================================================

describe("diagnostic position invariants", () => {
  it("all diagnostics have start within original source bounds", () => {
    const code = `import { pipe, staticAssert, typeclass, impl, summon } from "typesugar";

@typeclass
interface Show<A> { show(a: A): string; }

const result = pipe(42, (n: number) => n.toString());
staticAssert(false, "test");
const x = 1;
`;
    const result = transform(code);

    for (const d of result.diagnostics) {
      expect(
        d.start,
        `diagnostic "${d.message.slice(0, 40)}" start (${d.start}) should be >= 0`
      ).toBeGreaterThanOrEqual(0);
      expect(
        d.start,
        `diagnostic "${d.message.slice(0, 40)}" start (${d.start}) should be <= code.length (${code.length})`
      ).toBeLessThanOrEqual(code.length);
    }
  });

  it("all diagnostic spans are non-negative and reasonable", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const result = pipe(42, (n: number) => n + 1);
staticAssert(false, "test span");
`;
    const result = transform(code);

    for (const d of result.diagnostics) {
      expect(
        d.length,
        `diagnostic "${d.message.slice(0, 40)}" length should be > 0`
      ).toBeGreaterThan(0);
      expect(
        d.length,
        `diagnostic "${d.message.slice(0, 40)}" length (${d.length}) should be < half the file`
      ).toBeLessThan(code.length / 2);
    }
  });
});
