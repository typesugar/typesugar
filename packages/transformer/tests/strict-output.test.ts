/**
 * Strict Output Mode Tests (PEP-019 Wave 5)
 *
 * Validates that the transformer produces valid TypeScript output
 * for all playground examples when strictOutput is enabled.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

import "@typesugar/macros";

import { registerTypeRewrite } from "@typesugar/core";

function methodMap(names: string[]): ReadonlyMap<string, string> {
  return new Map(names.map((n) => [n, n]));
}

registerTypeRewrite({
  typeName: "Option",
  underlyingTypeText: "A | null",
  sourceModule: "@typesugar/fp/data/option",
  methods: methodMap([
    "map",
    "flatMap",
    "fold",
    "match",
    "getOrElse",
    "getOrElseStrict",
    "getOrThrow",
    "orElse",
    "filter",
    "filterNot",
    "exists",
    "forall",
    "contains",
    "tap",
    "toArray",
    "toNullable",
    "toUndefined",
    "zip",
  ]),
  constructors: new Map([
    ["Some", { kind: "identity" }],
    ["None", { kind: "constant", value: "null" }],
    ["of", { kind: "identity" }],
    ["some", { kind: "identity" }],
    ["none", { kind: "constant", value: "null" }],
    ["fromNullable", { kind: "identity" }],
  ]),
  transparent: true,
});

const DOCS_EXAMPLES_DIR = path.resolve(__dirname, "../../../docs/examples");

const AMBIENT_FILE = path.resolve("__playground_ambient__.d.ts");

// Inline a minimal version of the ambient declarations used by the playground
const AMBIENT_DECLARATIONS = fs.readFileSync(
  path.resolve(__dirname, "../../../api/playground-declarations.ts"),
  "utf-8"
);

// Extract the template literal content from the TS file
function extractAmbientContent(): string {
  const match = AMBIENT_DECLARATIONS.match(/export const AMBIENT_DECLARATIONS = `([\s\S]*?)`;/);
  if (match) return match[1];
  // Fallback: try to import it
  throw new Error("Could not extract AMBIENT_DECLARATIONS from playground-declarations.ts");
}

const ambientContent = extractAmbientContent();

function getAllExamples(): { name: string; filePath: string; code: string }[] {
  const examples: { name: string; filePath: string; code: string }[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".sts")) {
        const rel = path.relative(DOCS_EXAMPLES_DIR, full);
        examples.push({
          name: rel,
          filePath: full,
          code: fs.readFileSync(full, "utf-8"),
        });
      }
    }
  }

  walk(DOCS_EXAMPLES_DIR);
  return examples.sort((a, b) => a.name.localeCompare(b.name));
}

describe("Strict Output Mode", () => {
  const examples = getAllExamples();

  it(`discovers all example files (expect ~33)`, () => {
    expect(examples.length).toBeGreaterThanOrEqual(30);
    expect(examples.length).toBeLessThanOrEqual(40);
  });

  describe("all examples produce valid TypeScript output", () => {
    for (const example of examples) {
      it(`${example.name} — zero strictOutput warnings`, () => {
        const fileName = path.resolve(example.filePath);

        const result = transformCode(example.code, {
          fileName,
          extraRootFiles: [AMBIENT_FILE],
          strictOutput: true,
          readFile: (f: string) => {
            if (f === AMBIENT_FILE) return ambientContent;
            return ts.sys.readFile(f);
          },
          fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
        });

        const strictDiags = result.diagnostics.filter((d) =>
          d.message.startsWith("[strictOutput]")
        );

        if (strictDiags.length > 0) {
          const messages = strictDiags.map((d) => `  Line ~${d.start}: ${d.message}`);
          expect.fail(`${strictDiags.length} strictOutput warning(s):\n${messages.join("\n")}`);
        }
      });
    }
  });

  it("strictOutput overhead is reasonable (< 3x base transform time)", () => {
    const example = examples[0];
    if (!example) return;

    const fileName = path.resolve(example.filePath);
    const opts = {
      fileName,
      extraRootFiles: [AMBIENT_FILE],
      readFile: (f: string) => {
        if (f === AMBIENT_FILE) return ambientContent;
        return ts.sys.readFile(f);
      },
      fileExists: (f: string) => f === AMBIENT_FILE || ts.sys.fileExists(f),
    };

    // Warm up
    transformCode(example.code, { ...opts, strictOutput: false });
    transformCode(example.code, { ...opts, strictOutput: true });

    const RUNS = 3;

    // Measure without strictOutput
    const startWithout = performance.now();
    for (let i = 0; i < RUNS; i++) {
      transformCode(example.code, { ...opts, strictOutput: false });
    }
    const avgWithout = (performance.now() - startWithout) / RUNS;

    // Measure with strictOutput
    const startWith = performance.now();
    for (let i = 0; i < RUNS; i++) {
      transformCode(example.code, { ...opts, strictOutput: true });
    }
    const avgWith = (performance.now() - startWith) / RUNS;

    const overhead = avgWith - avgWithout;
    const ratio = avgWith / avgWithout;
    console.log(
      `strictOutput overhead: ${overhead.toFixed(1)}ms ` +
        `(without: ${avgWithout.toFixed(1)}ms, with: ${avgWith.toFixed(1)}ms, ratio: ${ratio.toFixed(2)}x)`
    );
    // Relative check: strict mode shouldn't more than triple the transform time.
    // Absolute overhead is machine-dependent (~200-300ms on dev machines).
    expect(ratio).toBeLessThan(3);
  });
});
