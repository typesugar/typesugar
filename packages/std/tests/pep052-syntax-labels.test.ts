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
import { readFileSync } from "node:fs";

import "@typesugar/macros";
import "@typesugar/std/macros";
import "@typesugar/contracts/macros";

import { transformCode } from "@typesugar/transformer";
import { transformCode as transformCodeInMemory } from "@typesugar/transformer-core";
import { globalRegistry } from "@typesugar/core";

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

  it("never hijacks ordinary loop labels, even in an ACTIVATED file", () => {
    const code = `
import "@typesugar/std/syntax/do";
declare const xs: number[][];
for (const ys of xs) {
  all: for (const y of ys) {
    if (y > 0) continue all;
  }
}
`;
    const result = transformCode(code, { fileName: "loop-label-activated.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.diagnostics.filter((d) => d.code === 9224)).toEqual([]);
    expect(result.code).toContain("all: for");
  });

  it("leaves an unactivated expression-position comprehension unmangled (preprocessor gated)", () => {
    // Without the marker import the text preprocessor must not rewrite the
    // arrow-body comprehension — the gated merge would refuse to repair it,
    // leaking `__letyield_` synthetic fragments into the output.
    const code = `
const f = (n: number) =>
let: {
  a << [n, n + 1];
}
yield: { a * 2 }
`;
    const result = transformCode(code, { fileName: "expr-pos-off.ts" });
    expect(result.code).not.toContain("__letyield_");
  });

  it("activates via the syntaxModule text fallback in a host that cannot resolve modules", () => {
    // The playground uses transformer-core's transformCode with an in-memory
    // host that only serves the input file; checker-based marker resolution
    // is impossible there. The import specifier matching the macro's
    // registered syntaxModule must activate it anyway. (Statement position:
    // transformer-core has no expression-position reconstruction path.)
    const code = `
import "@typesugar/std/syntax/do";
let: {
  x << [1, 2, 3];
}
yield: { x * 2 }
`;
    const result = transformCodeInMemory(code, { fileName: "playground-sim.ts" });
    expect(result.code).not.toContain("let: {");
    expect(result.code).toContain(".map(");
    expect(result.diagnostics.filter((d) => d.code === 9224)).toEqual([]);
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

describe("PEP-052 marker ↔ macro consistency", () => {
  // The activation triangle — registered macro name, `@syntax-labels` tag in
  // the marker module, and the macro's `syntaxModule` back-pointer — is held
  // together by string equality alone. A renamed macro or a typo'd tag makes
  // activation silently impossible while TS9224 keeps recommending a useless
  // import. This test binds the three together.
  const here = new URL(".", import.meta.url).pathname;
  const MARKERS: Array<[specifier: string, sourceFile: string]> = [
    ["@typesugar/std/syntax/do", `${here}../src/syntax/do.ts`],
    ["@typesugar/contracts/syntax", `${here}../../contracts/src/syntax.ts`],
  ];

  for (const [specifier, markerPath] of MARKERS) {
    it(`${specifier}: every @syntax-labels tag names a registered macro with a matching syntaxModule`, () => {
      const tags = [...readFileSync(markerPath, "utf8").matchAll(/@syntax-labels\s+(\S+)/g)].map(
        (m) => m[1]
      );
      expect(tags.length).toBeGreaterThan(0);

      const registered = new Map(globalRegistry.getAll().map((m) => [m.name, m]));
      for (const tag of tags) {
        const macro = registered.get(tag);
        expect(macro, `@syntax-labels ${tag} names no registered macro`).toBeDefined();
        expect(
          (macro as { syntaxModule?: string }).syntaxModule,
          `macro ${tag} must point back at its marker module`
        ).toBe(specifier);
      }

      // Reverse direction: every macro claiming this syntaxModule is tagged.
      for (const macro of registered.values()) {
        if ((macro as { syntaxModule?: string }).syntaxModule === specifier) {
          expect(tags, `marker ${specifier} is missing a tag for macro ${macro.name}`).toContain(
            macro.name
          );
        }
      }
    });
  }
});
