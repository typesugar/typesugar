/**
 * PEP-052 Part 2 (Wave 2): `@syntax-labels` activation gate for labeled-block
 * and trigger-label macros.
 *
 * Labeled-block macros (`let:`/`seq:`/`par:`/`all:` do-notation) and
 * attribute trigger labels (`requires:`/`ensures:` contracts) only expand
 * when the file imports a module carrying a `@syntax-labels <macroName>`
 * marker (`@typesugar/std/syntax/do`, `@typesugar/contracts/syntax`).
 * Without the marker the label is left untouched and the transformer emits
 * the TS9224 hint.
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";
import "@typesugar/contracts/macros";

import { transformCode } from "@typesugar/transformer";

const DO_BODY = `
const result =
let: {
  x << [1, 2, 3];
  y << ["a", "b"];
}
yield: { \`\${x}\${y}\` }
`;

// Statement-position variant: parses as a genuine LabeledStatement (the
// expression-position form above ASI-splits into the broken-parse shape), so
// "left untouched" is observable as the label surviving in the output.
const DO_STATEMENT_BODY = `
let: {
  x << [1, 2, 3];
}
yield: { \`\${x}\` }
`;

describe("PEP-052 @syntax-labels activation (do-notation)", () => {
  it("expands let:/yield: when @typesugar/std/syntax/do is imported", () => {
    const code = `import "@typesugar/std/syntax/do";\n${DO_BODY}`;
    const result = transformCode(code, { fileName: "labels-on.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain(".flatMap(");
    expect(result.code).not.toContain("let: {");
  });

  it("leaves let:/yield: untouched and warns TS9224 without the marker import", () => {
    const result = transformCode(DO_STATEMENT_BODY, { fileName: "labels-off.ts" });
    expect(result.code).toContain("let: {");
    expect(result.code).not.toContain(".flatMap(");
    const hints = result.diagnostics.filter((d) => d.code === 9224);
    expect(hints.length).toBeGreaterThanOrEqual(1);
    expect(hints[0].message).toContain("letYield");
    expect(hints[0].message).toContain("@typesugar/std/syntax/do");
  });

  it("does not warn about ordinary loop labels that collide with macro labels", () => {
    const code = `
for (const xs of [[1], [2]]) {
  all: for (const x of xs) {
    if (x > 0) continue all;
  }
}
`;
    const result = transformCode(code, { fileName: "loop-label.ts" });
    expect(result.diagnostics.filter((d) => d.code === 9224)).toEqual([]);
    expect(result.code).toContain("all: for");
  });

  it("does not warn when the file opts out of macros", () => {
    const code = `"use no typesugar macros";\n${DO_STATEMENT_BODY}`;
    const result = transformCode(code, { fileName: "labels-optout.ts" });
    expect(result.diagnostics.filter((d) => d.code === 9224)).toEqual([]);
    expect(result.code).toContain("let: {");
  });
});

const CONTRACT_BODY = `
function withdraw(account: { balance: number }, amount: number): number {
  requires: { amount > 0; }
  account.balance -= amount;
  return account.balance;
}
`;

describe("PEP-052 @syntax-labels activation (contract trigger labels)", () => {
  it("applies implicit @contract when @typesugar/contracts/syntax is imported", () => {
    const code = `import "@typesugar/contracts/syntax";\n${CONTRACT_BODY}`;
    const result = transformCode(code, { fileName: "contract-on.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The requires: block is consumed and lowered to a runtime check.
    expect(result.code).not.toContain("requires: {");
  });

  it("leaves requires: untouched and warns TS9224 without the marker import", () => {
    const result = transformCode(CONTRACT_BODY, { fileName: "contract-off.ts" });
    expect(result.code).toContain("requires: {");
    const hints = result.diagnostics.filter((d) => d.code === 9224);
    expect(hints.length).toBe(1);
    expect(hints[0].message).toContain("contract");
    expect(hints[0].message).toContain("@typesugar/contracts/syntax");
  });
});
