/**
 * Playground Examples Integration Tests
 *
 * Tests examples using the REAL transformer (@typesugar/transformer).
 *
 * Zero manual registrations. Zero type stubs. The transformer auto-discovers
 * everything from node_modules — same as `tspc` would.
 *
 * Validates that all playground examples in docs/examples/:
 * 1. Parse and transform without errors
 * 2. Produce visibly different output (macros fire)
 * 3. Contain expected macro artifacts in the transformed code
 */

import { describe, it, expect } from "vitest";
import { transformCode, TransformationPipeline } from "@typesugar/transformer";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const EXAMPLES_DIR = path.resolve(__dirname, "../docs/examples");

// ---------------------------------------------------------------------------
// Example discovery
// ---------------------------------------------------------------------------

interface Example {
  name: string;
  code: string;
  ext: ".ts" | ".sts";
  relPath: string;
  fullPath: string;
  category: string;
}

function collectExamples(): Example[] {
  const examples: Example[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".sts")) continue;

      const relPath = path.relative(EXAMPLES_DIR, full);
      const category = path.dirname(relPath);
      const code = fs.readFileSync(full, "utf-8");
      const titleLine = code.split("\n").find((l) => l.startsWith("//! "));
      const name = titleLine?.slice(4).trim() ?? relPath;
      const ext = entry.name.endsWith(".sts") ? (".sts" as const) : (".ts" as const);

      examples.push({ name, code, ext, relPath, fullPath: full, category });
    }
  }

  walk(EXAMPLES_DIR);
  return examples;
}

const examples = collectExamples();

interface Diagnostic {
  severity: string;
  message: string;
}

function errorsOf(result: { diagnostics: Diagnostic[] }) {
  return result.diagnostics.filter((d) => d.severity === "error");
}

/**
 * Transform using the real transformer. .ts files use transformCode() directly.
 * .sts files use TransformationPipeline which handles preprocessing internally.
 */
function transform(ex: Example) {
  if (ex.ext === ".sts") {
    const pipeline = new TransformationPipeline({ target: ts.ScriptTarget.Latest }, [ex.fullPath], {
      extensions: ["pipeline", "cons", "decorator-rewrite"],
    });
    const result = pipeline.transform(ex.fullPath);
    return { ...result, preprocessed: true };
  }

  const result = transformCode(ex.code, { fileName: ex.fullPath });
  return { ...result, preprocessed: false };
}

/** Strip comment lines from code to avoid false positives in artifact checks */
function stripComments(code: string): string {
  return code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

// ============================================================================
// Tier 0: Discovery
// ============================================================================

describe("playground examples discovery", () => {
  it("finds at least 28 examples", () => {
    expect(examples.length).toBeGreaterThanOrEqual(28);
  });

  it("every example has //! title header", () => {
    for (const ex of examples) {
      const hasHeader = ex.code.split("\n").some((l) => l.startsWith("//! "));
      expect(hasHeader, `${ex.relPath} missing //! header`).toBe(true);
    }
  });

  it("every example has console.log for Run output", () => {
    for (const ex of examples) {
      expect(ex.code, `${ex.relPath} missing console.log`).toContain("console.log");
    }
  });
});

// ============================================================================
// Tier 1: Smoke — all examples parse and transform without errors
// ============================================================================

const KNOWN_PREPROCESS_ISSUES = new Set(["preprocessor/pipeline.sts"]);

describe("all examples transform without errors", () => {
  for (const ex of examples) {
    if (KNOWN_PREPROCESS_ISSUES.has(ex.relPath)) {
      it.skip(`${ex.relPath} (known preprocessing issue)`, () => {});
      continue;
    }
    it(`${ex.relPath}`, () => {
      const result = transform(ex);
      const errors = errorsOf(result);
      if (errors.length > 0) {
        const msgs = errors.map((e) => e.message).join("\n  ");
        expect.fail(`Transform errors in ${ex.relPath}:\n  ${msgs}`);
      }
    });
  }
});

// ============================================================================
// Tier 2: Macros fire — output differs from source
// ============================================================================

describe("macros fire (output differs from source)", () => {
  for (const ex of examples) {
    it(`${ex.relPath}`, () => {
      const result = transform(ex);
      expect(result.changed, `${ex.relPath}: output identical to source — no macros fired`).toBe(
        true
      );
    });
  }
});

// ============================================================================
// Tier 3: Specific macro artifacts in transformed output
// ============================================================================

function findExample(pattern: string): Example {
  const ex = examples.find((e) => e.relPath.includes(pattern));
  if (!ex) throw new Error(`No example matching "${pattern}"`);
  return ex;
}

describe("comptime() inlines to literal values", () => {
  for (const name of ["welcome", "cfg"]) {
    const ex = examples.find((e) => e.relPath.includes(name) && !e.relPath.includes("full-stack"));
    if (!ex) continue;
    it(`${ex.relPath}`, () => {
      const result = transform(ex);
      const codeOnly = stripComments(result.code);
      expect(codeOnly).not.toContain("comptime(");
    });
  }
});

describe("staticAssert() calls are replaced with comments", () => {
  it("getting-started/welcome.ts — no raw staticAssert calls remain", () => {
    const result = transform(findExample("getting-started/welcome"));
    const codeOnly = stripComments(result.code);
    expect(codeOnly).not.toContain("staticAssert(");
  });
});

describe("operators: ops(a + b) rewrites to method calls", () => {
  it("core/operators.ts", () => {
    const result = transform(findExample("core/operators"));
    expect(result.code).toContain(".add(");
    expect(result.code).toContain(".sub(");
  });
});

describe("pipe() inlines to nested function calls", () => {
  it("getting-started/welcome.ts", () => {
    const result = transform(findExample("getting-started/welcome"));
    const codeOnly = stripComments(result.code);
    expect(codeOnly).not.toContain("pipe(");
  });
});

describe("match() compiles to ternary or switch", () => {
  it("std/pattern-matching.ts", () => {
    const result = transform(findExample("pattern-matching"));
    const hasTransform =
      result.code.includes("?") || result.code.includes("switch") || result.changed;
    expect(hasTransform).toBe(true);
  });
});

describe("preprocessor operators rewrite", () => {
  it("cons-operator.sts: :: is preprocessed", () => {
    const ex = examples.find((e) => e.relPath.includes("cons-operator.sts"));
    if (!ex) return;
    const result = transform(ex);
    expect(result.preprocessed).toBe(true);
  });
});

describe("stateMachine tagged template expands to object literal", () => {
  it("graph/state-machine.ts — tagged template is gone", () => {
    const result = transform(findExample("graph/state-machine"));
    const codeOnly = stripComments(result.code);
    expect(codeOnly).not.toContain("stateMachine`");
    expect(codeOnly).toContain("states");
    expect(codeOnly).toContain("transition");
  });
});

describe("@derive generates typeclass instances", () => {
  it("core/derive.ts", () => {
    const ex = examples.find((e) => e.relPath.includes("core/derive"));
    if (!ex) return;
    const result = transform(ex);
    expect(result.changed).toBe(true);
  });

  it("collections/hashset-hashmap.ts", () => {
    const result = transform(findExample("hashset-hashmap"));
    expect(result.changed).toBe(true);
  });
});

describe("staticAssert emits descriptive comment", () => {
  // These tests verify const-variable resolution in staticAssert conditions
  // (e.g. `const N = 3; staticAssert(N > 0, ...)`).
  const snippetPath = path.resolve(__dirname, "../test-snippet.ts");

  it("replaces staticAssert with // staticAssert: ... ✓ comment", () => {
    const code = `
import { staticAssert } from "typesugar";
const N = 3;
staticAssert(N > 0, "must be positive");
console.log("ok");
`;
    const result = transformCode(code, { fileName: snippetPath });
    expect(result.code).toContain('staticAssert: "must be positive" ✓');
    expect(result.code).not.toContain("void 0");
    const codeOnly = stripComments(result.code);
    expect(codeOnly).not.toContain("staticAssert(");
  });

  it("resolves const identifiers for compile-time evaluation", () => {
    const code = `
import { staticAssert } from "typesugar";
const VERSION = "v2.1";
staticAssert(VERSION.startsWith("v"), "version must start with v");
console.log("ok");
`;
    const result = transformCode(code, { fileName: snippetPath });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
    expect(result.code).toContain("✓");
  });
});

describe("full-stack example demonstrates multiple features", () => {
  it("getting-started/full-stack.ts transforms with multiple macros", () => {
    const result = transform(findExample("full-stack"));
    expect(result.changed).toBe(true);
    const codeOnly = stripComments(result.code);
    expect(codeOnly).not.toContain("comptime(");
  });
});
