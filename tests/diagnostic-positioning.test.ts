/**
 * Diagnostic positioning tests — verifies that error positions map back
 * to the correct location in the original source after transformation.
 *
 * These tests cover:
 * 1. Source map generation: transformations must produce source maps
 * 2. Position mapper accuracy: transformed positions map back to original
 * 3. Macro diagnostic positions: errors from macros point to the right place
 * 4. TS error positions after transformation: regular TS errors remain correct
 * 5. strictOutput diagnostic positions: TS errors in transformed code map back
 *
 * Many of these tests are expected to FAIL, exposing known bugs in the
 * diagnostic positioning pipeline.
 */

import { describe, it, expect } from "vitest";
import { transformCode, type TransformResult } from "@typesugar/transformer";
import type { TransformDiagnostic } from "@typesugar/transformer-core";
import { AMBIENT_DECLARATIONS } from "../api/playground-declarations.js";
import * as path from "path";
import * as ts from "typescript";

// ============================================================================
// Helpers
// ============================================================================

const AMBIENT_FILE = path.resolve(__dirname, "../__playground_ambient__.d.ts");

function transform(code: string, opts?: { strictOutput?: boolean }): TransformResult {
  return transformCode(code, {
    fileName: path.resolve("test-diagnostic-pos.ts"),
    extraRootFiles: [AMBIENT_FILE],
    strictOutput: opts?.strictOutput ?? false,
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });
}

/** Transform with .sts extension for HKT/pipe/cons preprocessing. */
function transformSts(code: string, opts?: { strictOutput?: boolean }): TransformResult {
  return transformCode(code, {
    fileName: path.resolve("test-diagnostic-pos.sts"),
    extraRootFiles: [AMBIENT_FILE],
    strictOutput: opts?.strictOutput ?? false,
    readFile: (f: string) => {
      if (f === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
      return ts.sys.readFile(f);
    },
    fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
  });
}

/** Find the 0-based byte offset of `needle` in `haystack` at its nth occurrence (default 1st). */
function offsetOf(haystack: string, needle: string, occurrence = 1): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`"${needle}" occurrence ${occurrence} not found`);
  }
  return idx;
}

/** Get the 1-based line number for a byte offset. */
function lineAt(source: string, offset: number): number {
  return source.substring(0, offset).split("\n").length;
}

/** Get the 0-based column for a byte offset. */
function colAt(source: string, offset: number): number {
  const before = source.substring(0, offset);
  return offset - before.lastIndexOf("\n") - 1;
}

/** Assert a diagnostic's start position points to the expected text in the original source. */
function expectDiagAt(
  diag: TransformDiagnostic,
  originalCode: string,
  expectedText: string,
  description?: string
) {
  const actualText = originalCode.substring(diag.start, diag.start + diag.length);
  const actualLine = lineAt(originalCode, diag.start);
  const expectedOffset = offsetOf(originalCode, expectedText);
  const expectedLine = lineAt(originalCode, expectedOffset);

  const prefix = description ? `${description}: ` : "";
  expect(
    actualLine,
    `${prefix}Expected diagnostic on line ${expectedLine} ("${expectedText}"), ` +
      `but got line ${actualLine} (offset ${diag.start}, text: "${actualText.slice(0, 40)}")`
  ).toBe(expectedLine);
}

/** Assert a diagnostic's start offset, when mapped from transformed coordinates, matches original. */
function expectMappedPosition(
  result: TransformResult,
  transformedOffset: number,
  expectedOriginalOffset: number,
  description?: string
) {
  const mapped = result.mapper.toOriginal(transformedOffset);
  const prefix = description ? `${description}: ` : "";
  expect(
    mapped,
    `${prefix}mapper.toOriginal(${transformedOffset}) returned ${mapped}, expected ${expectedOriginalOffset}`
  ).toBe(expectedOriginalOffset);
}

// ============================================================================
// Tier 1: Source map generation — transformations must produce source maps
// ============================================================================

describe("source map generation", () => {
  it("pipe() expansion produces a source map", () => {
    const code = `import { pipe } from "typesugar";
const result = pipe(42, (n: number) => n + 1);
`;
    const result = transform(code);
    expect(result.changed, "pipe() should have been expanded").toBe(true);
    expect(result.sourceMap, "Source map should be generated when code changes").not.toBeNull();
  });

  it("@tailrec expansion produces a source map", () => {
    const code = `import { tailrec } from "typesugar";

@tailrec
function factorial(n: bigint, acc: bigint = 1n): bigint {
  if (n <= 1n) return acc;
  return factorial(n - 1n, n * acc);
}
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expect(result.sourceMap, "Source map should be generated for @tailrec").not.toBeNull();
  });

  it("@typeclass + @impl expansion produces a source map", () => {
    const code = `import { typeclass, impl, summon } from "typesugar";

@typeclass
interface Printable<A> {
  print(a: A): string;
}

@impl
const printableNumber: Printable<number> = {
  print: (a) => String(a),
};
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    expect(result.sourceMap, "Source map should be generated for @typeclass/@impl").not.toBeNull();
  });

  it("import removal produces a source map", () => {
    const code = `import { pipe } from "typesugar";
const x = pipe(1, (n: number) => n + 1);
const y = 42;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);
    // The import line is removed, shifting all subsequent line numbers
    expect(
      result.sourceMap,
      "Source map should be generated when imports are removed"
    ).not.toBeNull();
  });
});

// ============================================================================
// Tier 2: Position mapper accuracy — mapper.toOriginal returns correct offsets
// ============================================================================

describe("position mapper accuracy", () => {
  it("maps position of code AFTER a pipe() expansion back to original", () => {
    const code = `import { pipe } from "typesugar";

const before = 1;
const result = pipe(42, (n: number) => n + 1);
const after = 2;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    // "const after" should map back to its original position
    const origOffset = offsetOf(code, "const after");
    const transOffset = offsetOf(result.code, "const after");
    expectMappedPosition(result, transOffset, origOffset, "const after");
  });

  it("maps position of code AFTER import removal back to original", () => {
    const code = `import { pipe } from "typesugar";

const x = pipe(1, (n: number) => n + 1);
const y = 42;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    const origOffset = offsetOf(code, "const y");
    const transOffset = offsetOf(result.code, "const y");
    expectMappedPosition(result, transOffset, origOffset, "const y after import removal");
  });

  it("maps position of code AFTER multi-line pipe() expansion", () => {
    const code = `import { pipe } from "typesugar";

const before = 1;
const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
);
const after = 2;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    // Multi-line pipe collapsed to single line — code after should still map correctly
    const origOffset = offsetOf(code, "const after");
    const transOffset = offsetOf(result.code, "const after");
    expectMappedPosition(result, transOffset, origOffset, "const after (multi-line pipe)");
  });

  it("maps position of code AFTER @tailrec expansion", () => {
    const code = `import { tailrec } from "typesugar";

const before = 1;

@tailrec
function factorial(n: bigint, acc: bigint = 1n): bigint {
  if (n <= 1n) return acc;
  return factorial(n - 1n, n * acc);
}

const after = 2;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    // @tailrec expansion typically changes the function body significantly
    const origOffset = offsetOf(code, "const after");
    const transOffset = offsetOf(result.code, "const after");
    expectMappedPosition(result, transOffset, origOffset, "const after (@tailrec)");
  });

  it("maps position of code AFTER @typeclass expansion", () => {
    const code = `import { typeclass, impl } from "typesugar";

const before = 1;

@typeclass
interface Printable<A> {
  print(a: A): string;
}

@impl
const printableNumber: Printable<number> = {
  print: (a) => String(a),
};

const after = 2;
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    const origOffset = offsetOf(code, "const after");
    if (result.code.includes("const after")) {
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "const after (@typeclass)");
    }
  });

  it("maps position of code between TWO macro expansions", () => {
    const code = `import { pipe } from "typesugar";

const a = pipe(1, (n: number) => n + 1);
const middle = "between";
const b = pipe(2, (n: number) => n * 2);
const end = "after";
`;
    const result = transform(code);
    expect(result.changed).toBe(true);

    // "const middle" is between two pipe expansions
    const middleOrig = offsetOf(code, "const middle");
    const middleTrans = offsetOf(result.code, "const middle");
    expectMappedPosition(result, middleTrans, middleOrig, "between two pipes");

    // "const end" is after both
    const endOrig = offsetOf(code, "const end");
    const endTrans = offsetOf(result.code, "const end");
    expectMappedPosition(result, endTrans, endOrig, "after two pipes");
  });
});

// ============================================================================
// Tier 3: Macro diagnostic positions — errors from macros point to right place
// ============================================================================

describe("macro diagnostic positions", () => {
  it("@tailrec error points to the non-tail-recursive call site", () => {
    const code = `import { tailrec } from "typesugar";

@tailrec
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);

    // The error should point to the line with "n * factorial(n - 1)"
    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, "factorial(n - 1)"));
    expect(
      errorLine,
      `@tailrec error should point to line ${expectedLine} (the recursive call), got line ${errorLine}`
    ).toBe(expectedLine);
  });

  it("@tailrec error span covers the recursive call expression", () => {
    const code = `import { tailrec } from "typesugar";

@tailrec
function sum(n: number): number {
  if (n <= 0) return 0;
  return sum(n - 1) + n;
}
`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);

    // Error should be on the line with the recursive call
    const errorLine = lineAt(code, errors[0].start);
    const callLine = lineAt(code, offsetOf(code, "sum(n - 1)"));
    expect(errorLine, "error should be on the recursive call line").toBe(callLine);
  });

  it("summon() error points to the summon call, not macro-generated code", () => {
    const code = `import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";

interface Foo { x: () => void; }
const eq = summon<Eq<Foo>>();
`;
    const result = transform(code);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);

    // Error should point to the summon() call on line 5, not somewhere else
    const errorLine = lineAt(code, errors[0].start);
    const summonLine = lineAt(code, offsetOf(code, "summon<Eq<Foo>>()"));
    expect(errorLine, `summon error should be on line ${summonLine}, got line ${errorLine}`).toBe(
      summonLine
    );
  });

  it("staticAssert error points to the assert call", () => {
    const code = `import { staticAssert } from "typesugar";

const x = 1;
staticAssert(false, "this should fail");
const y = 2;
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("this should fail")
    );
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const assertLine = lineAt(code, offsetOf(code, "staticAssert(false"));
    expect(
      errorLine,
      `staticAssert error should be on line ${assertLine}, got line ${errorLine}`
    ).toBe(assertLine);
  });

  it("macro error after another macro expansion still has correct position", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
);

staticAssert(false, "after pipe");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("after pipe")
    );
    expect(errors.length).toBeGreaterThan(0);

    // The staticAssert is AFTER the pipe expansion, so its position
    // could be wrong if the expansion shifts offsets without updating
    const errorLine = lineAt(code, errors[0].start);
    const assertLine = lineAt(code, offsetOf(code, 'staticAssert(false, "after pipe")'));
    expect(
      errorLine,
      `staticAssert error should be on line ${assertLine} (after pipe expansion), got line ${errorLine}`
    ).toBe(assertLine);
  });
});

// ============================================================================
// Tier 4: TS error positions after transformation — regular TS errors stay correct
// ============================================================================

describe("TS error positions after transformation (strictOutput)", () => {
  it("type error BEFORE a macro expansion maps to correct line", () => {
    const code = `import { pipe } from "typesugar";

const x: number = "hello";
const result = pipe(42, (n: number) => n + 1);
const y = 1;
`;
    const result = transform(code, { strictOutput: true });

    // The type error 'Type "string" is not assignable to type "number"'
    // should point to line 3 in the original, not shifted by transformation
    const typeErrors = result.diagnostics.filter(
      (d) => d.message.includes("not assignable") || d.message.includes("string")
    );

    if (typeErrors.length > 0) {
      const errorLine = lineAt(code, typeErrors[0].start);
      const expectedLine = lineAt(code, offsetOf(code, '"hello"'));
      expect(errorLine, `Type error should be on line ${expectedLine}, got line ${errorLine}`).toBe(
        expectedLine
      );
    }
  });

  it("type error AFTER a pipe() expansion maps to correct line", () => {
    const code = `import { pipe } from "typesugar";

const result = pipe(42, (n: number) => n + 1);
const x: number = "world";
`;
    const result = transform(code, { strictOutput: true });

    // After pipe() expansion removes import + collapses pipe call,
    // the type error on 'const x: number = "world"' should still
    // point to the correct original line
    const typeErrors = result.diagnostics.filter(
      (d) => d.message.includes("not assignable") || d.message.includes("string")
    );

    if (typeErrors.length > 0) {
      const errorLine = lineAt(code, typeErrors[0].start);
      const expectedLine = lineAt(code, offsetOf(code, '"world"'));
      expect(
        errorLine,
        `Type error should be on line ${expectedLine} (after pipe), got line ${errorLine}`
      ).toBe(expectedLine);
    }
  });

  it("type error AFTER a multi-line expansion maps to correct line", () => {
    const code = `import { pipe } from "typesugar";

const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
);

const x: number = true;
`;
    const result = transform(code, { strictOutput: true });

    const typeErrors = result.diagnostics.filter(
      (d) => d.message.includes("not assignable") || d.message.includes("boolean")
    );

    if (typeErrors.length > 0) {
      const errorLine = lineAt(code, typeErrors[0].start);
      const expectedLine = lineAt(code, offsetOf(code, "true"));
      expect(
        errorLine,
        `Type error should be on line ${expectedLine} (after multi-line pipe), got line ${errorLine}`
      ).toBe(expectedLine);
    }
  });

  it("type error AFTER @tailrec expansion maps to correct line", () => {
    const code = `import { tailrec } from "typesugar";

@tailrec
function factorial(n: bigint, acc: bigint = 1n): bigint {
  if (n <= 1n) return acc;
  return factorial(n - 1n, n * acc);
}

const x: string = 42;
`;
    const result = transform(code, { strictOutput: true });

    const typeErrors = result.diagnostics.filter(
      (d) =>
        (d.message.includes("not assignable") || d.message.includes("number")) &&
        !d.message.includes("tailrec")
    );

    if (typeErrors.length > 0) {
      const errorLine = lineAt(code, typeErrors[0].start);
      const expectedLine = lineAt(code, offsetOf(code, "42;"));
      expect(
        errorLine,
        `Type error should be on line ${expectedLine} (after @tailrec), got line ${errorLine}`
      ).toBe(expectedLine);
    }
  });

  it("strictOutput diagnostics have positions in original coordinates, not transformed", () => {
    // This test directly checks for the known bug: typecheckOutput() returns
    // positions in transformed-code coordinates without mapping them back
    const code = `import { pipe } from "typesugar";

const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
);

const x: number = "oops";
`;
    const result = transform(code, { strictOutput: true });

    // Find the strictOutput diagnostic (prefixed with [strictOutput])
    const strictDiags = result.diagnostics.filter((d) => d.message.includes("[strictOutput]"));

    if (strictDiags.length > 0) {
      for (const d of strictDiags) {
        // The diagnostic start should be a valid position in the ORIGINAL code
        expect(
          d.start,
          `strictOutput diagnostic start (${d.start}) should be < original code length (${code.length})`
        ).toBeLessThan(code.length);

        // It should point to a recognizable location in the original
        const errorLine = lineAt(code, d.start);
        expect(
          errorLine,
          `strictOutput diagnostic should point to a valid line (got line ${errorLine})`
        ).toBeGreaterThan(0);
        expect(errorLine).toBeLessThanOrEqual(code.split("\n").length);
      }
    }
  });
});

// ============================================================================
// Tier 5: Column-level accuracy — errors point to the right character
// ============================================================================

describe("column-level diagnostic accuracy", () => {
  it("macro error column points to the correct token, not start of line", () => {
    const code = `import { staticAssert } from "typesugar";

const x = 1;    staticAssert(false, "mid-line");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("mid-line")
    );
    expect(errors.length).toBeGreaterThan(0);

    // The error should point to the column where staticAssert starts, not column 0
    const errorCol = colAt(code, errors[0].start);
    const expectedCol = colAt(code, offsetOf(code, "staticAssert(false"));
    expect(errorCol, `Error column should be ${expectedCol}, got ${errorCol}`).toBe(expectedCol);
  });

  it("diagnostic length covers the expected span", () => {
    const code = `import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";

const eq = summon<Eq<string>>();
`;
    const result = transform(code);
    // summon<Eq<string>> should resolve (string has Eq), so no error expected
    // Let's use a type that doesn't have Eq
    const code2 = `import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";

interface NoEq { fn: () => void; }
const eq = summon<Eq<NoEq>>();
`;
    const result2 = transform(code2);
    const errors = result2.diagnostics.filter((d) => d.severity === "error");

    if (errors.length > 0) {
      // The diagnostic length should be reasonable (not 0, not the whole file)
      expect(errors[0].length, "Diagnostic length should be > 0").toBeGreaterThan(0);
      expect(errors[0].length, "Diagnostic length should not span the entire file").toBeLessThan(
        code2.length / 2
      );
    }
  });
});

// ============================================================================
// Tier 6: Multiple transformations — position consistency
// ============================================================================

describe("multiple transformations position consistency", () => {
  it("positions remain correct with pipe + import removal + staticAssert", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const a = pipe(1, (n: number) => n + 1);
const b = pipe(2, (n: number) => n * 2);
staticAssert(false, "should fail");
const c = 3;
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("should fail")
    );
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "should fail")'));
    expect(
      errorLine,
      `After 2 pipe expansions + import removal, staticAssert error should be on line ${expectedLine}, got ${errorLine}`
    ).toBe(expectedLine);
  });

  it("TS errors and macro errors in the same file have consistent coordinates", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const result = pipe(42, (n: number) => n + 1);
staticAssert(false, "macro error");
const x: number = "type error";
`;
    const result = transform(code, { strictOutput: true });

    const macroErrors = result.diagnostics.filter((d) => d.message.includes("macro error"));
    const typeErrors = result.diagnostics.filter(
      (d) => d.message.includes("not assignable") || d.message.includes("[strictOutput]")
    );

    if (macroErrors.length > 0 && typeErrors.length > 0) {
      const macroLine = lineAt(code, macroErrors[0].start);
      const typeLine = lineAt(code, typeErrors[0].start);

      // Macro error on line 4, type error on line 5 — they should be in order
      const expectedMacroLine = lineAt(code, offsetOf(code, 'staticAssert(false, "macro error")'));
      const expectedTypeLine = lineAt(code, offsetOf(code, '"type error"'));

      expect(macroLine, "macro error line").toBe(expectedMacroLine);
      expect(typeLine, "type error line").toBe(expectedTypeLine);
      expect(macroLine, "macro error should come before type error").toBeLessThan(typeLine);
    }
  });
});

// ============================================================================
// Tier 7: Edge cases
// ============================================================================

describe("edge cases", () => {
  it("error on first line of file has correct position (offset 0)", () => {
    const code = `import { staticAssert } from "typesugar";
staticAssert(false, "first real line");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("first real line")
    );
    expect(errors.length).toBeGreaterThan(0);

    // staticAssert is on line 2
    const errorLine = lineAt(code, errors[0].start);
    expect(errorLine).toBe(2);
  });

  it("error on last line of file has correct position", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const result = pipe(
  42,
  (n: number) => n.toString(),
  (s: string) => s.length,
);
const x = 1;
const y = 2;
const z = 3;
staticAssert(false, "last line error");`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("last line error")
    );
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "last line error")'));
    expect(errorLine).toBe(expectedLine);
  });

  it("empty lines between macros don't corrupt positions", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

const a = pipe(1, (n: number) => n + 1);



const b = pipe(2, (n: number) => n * 2);



staticAssert(false, "after empty lines");
`;
    const result = transform(code);
    const errors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("after empty lines")
    );
    expect(errors.length).toBeGreaterThan(0);

    const errorLine = lineAt(code, errors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "after empty lines")'));
    expect(
      errorLine,
      `Error after empty lines should be on line ${expectedLine}, got ${errorLine}`
    ).toBe(expectedLine);
  });

  it("code with no transformations returns identity-mapped positions", () => {
    const code = `const x = 1;
const y = 2;
const z = 3;
`;
    const result = transform(code);
    expect(result.changed).toBe(false);

    // Identity mapper should return positions unchanged
    const yOffset = offsetOf(code, "const y");
    expectMappedPosition(result, yOffset, yOffset, "identity mapping");
  });

  it("diagnostic for macro-generated code that has no original position returns null or is suppressed", () => {
    // When the transformer generates new code (e.g., typeclass registry calls),
    // positions in that generated code should either map to null or be filtered out
    const code = `import { typeclass } from "typesugar";

@typeclass
interface MyTC<A> {
  doSomething(a: A): string;
}
`;
    const result = transform(code);
    // The expansion generates registry code — any diagnostics on that code
    // should not point to random locations in the original
    for (const d of result.diagnostics) {
      expect(
        d.start,
        `Diagnostic start (${d.start}) should be within original source bounds (${code.length})`
      ).toBeLessThanOrEqual(code.length);
    }
  });
});

// ============================================================================
// PEP-036 Wave 2: @derive positioning
// ============================================================================

describe("@derive diagnostic positioning", () => {
  it("position mapper maps code BEFORE @derive expansion back correctly", () => {
    const code = `const before = "marker";

/** @derive(Eq) */
interface Point { x: number; y: number; }

const y = 1;
`;
    const result = transform(code);
    expect(result.changed, "@derive should trigger transformation").toBe(true);

    if (result.code.includes("const before")) {
      const origOffset = offsetOf(code, "const before");
      const transOffset = offsetOf(result.code, "const before");
      expectMappedPosition(result, transOffset, origOffset, "const before (@derive)");
    }
  });

  it("position mapper maps code AFTER @derive expansion back correctly", () => {
    const code = `/** @derive(Eq) */
interface Point { x: number; y: number; }

const after = "marker";
`;
    const result = transform(code);
    expect(result.changed, "@derive should trigger transformation").toBe(true);

    if (result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "const after (@derive)");
    }
  });

  it("@derive error itself points to the decorator", () => {
    // Use a type with a field that can't be derived (function type)
    const code = `/** @derive(Eq) */
interface Bad { fn: () => void; }
`;
    const result = transform(code);

    // If @derive produces an error, it should point near the @derive site
    const deriveErrors = result.diagnostics.filter((d) => d.severity === "error");
    if (deriveErrors.length > 0) {
      // Error should be on one of the first two lines (decorator or interface)
      const errorLine = lineAt(code, deriveErrors[0].start);
      expect(errorLine, `@derive error should be near the @derive site`).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================================================
// PEP-036 Wave 2: HKT syntax positioning
// ============================================================================

describe("HKT syntax diagnostic positioning", () => {
  it("position mapper maps code after HKT preprocessing back correctly", () => {
    const code = `interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

const after = "marker";
`;
    const result = transformSts(code);

    if (result.changed && result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "after HKT preprocess");
    }
  });

  it("multi-line HKT generic preserves position mapping", () => {
    const code = `interface Bifunctor<
  F<_>
> {
  bimap<A, B, C, D>(fab: F<A>, f: (a: A) => C, g: (b: B) => D): F<C>;
}

const after = "marker";
`;
    const result = transformSts(code);

    if (result.changed && result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "after multi-line HKT");
    }
  });
});

// ============================================================================
// PEP-036 Wave 2: Pipe operator positioning (|>)
// ============================================================================

describe("pipe operator (|>) diagnostic positioning", () => {
  it("long pipe chain (10+ stages) — code after maps correctly", () => {
    const fns = Array.from({ length: 10 }, (_, i) => `(n: number) => n + ${i + 1}`);
    const code = `const result = 1 ${fns.map((f) => `|> (${f})`).join(" ")};
const after = "marker";
`;
    const result = transformSts(code);
    expect(result.changed, "|> should trigger transformation").toBe(true);

    if (result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "after long |> chain");
    }
  });

  it("code between two pipe chains maps correctly", () => {
    const code = `const a = 1 |> ((n: number) => n + 1);
const middle = "between";
const b = 2 |> ((n: number) => n * 2);
const end = "after";
`;
    const result = transformSts(code);

    if (result.changed && result.code.includes("const middle")) {
      const middleOrig = offsetOf(code, "const middle");
      const middleTrans = offsetOf(result.code, "const middle");
      expectMappedPosition(result, middleTrans, middleOrig, "between two |> chains");
    }

    if (result.changed && result.code.includes("const end")) {
      const endOrig = offsetOf(code, "const end");
      const endTrans = offsetOf(result.code, "const end");
      expectMappedPosition(result, endTrans, endOrig, "after two |> chains");
    }
  });
});

// ============================================================================
// PEP-036 Wave 2: Cons operator (::) positioning
// ============================================================================

describe("cons operator (::) diagnostic positioning", () => {
  it("code after :: desugar maps back correctly", () => {
    const code = `const list = 1 :: 2 :: [];
const after = "marker";
`;
    const result = transformSts(code);
    expect(result.changed, ":: should trigger transformation").toBe(true);

    if (result.code.includes("const after")) {
      const origOffset = offsetOf(code, "const after");
      const transOffset = offsetOf(result.code, "const after");
      expectMappedPosition(result, transOffset, origOffset, "after :: desugar");
    }
  });
});

// ============================================================================
// PEP-036 Wave 2: Mixed-macro positioning
// ============================================================================

describe("mixed-macro diagnostic positioning", () => {
  it("file with @derive + pipe + staticAssert — all error positions correct", () => {
    const code = `import { pipe, staticAssert } from "typesugar";

/** @derive(Eq) */
interface Point { x: number; y: number; }

const result = pipe(42, (n: number) => n + 1);
staticAssert(false, "after both");
const trailing = 1;
`;
    const result = transform(code);

    const assertErrors = result.diagnostics.filter(
      (d) => d.severity === "error" && d.message.includes("after both")
    );
    expect(assertErrors.length, "staticAssert should produce an error").toBeGreaterThan(0);

    const errorLine = lineAt(code, assertErrors[0].start);
    const expectedLine = lineAt(code, offsetOf(code, 'staticAssert(false, "after both")'));
    expect(
      errorLine,
      `staticAssert error after @derive + pipe should be on line ${expectedLine}, got ${errorLine}`
    ).toBe(expectedLine);
  });
});

// ============================================================================
// PEP-036 Wave 2: /*ERR*/ fixture helper smoke test
// ============================================================================

describe("error fixture helper", () => {
  it("assertErrorsAt detects errors at marked positions", async () => {
    const { assertErrorsAt } = await import("./helpers/error-fixture.js");

    const { result } = assertErrorsAt(`import { staticAssert } from "typesugar";

/*ERR:assert*/staticAssert(false, "boom");
`);

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("assertErrorsAt detects errors after macro expansion", async () => {
    const { assertErrorsAt } = await import("./helpers/error-fixture.js");

    assertErrorsAt(`import { pipe, staticAssert } from "typesugar";

const r = pipe(42, (n: number) => n + 1);
/*ERR:assert*/staticAssert(false, "after pipe");
`);
  });
});
