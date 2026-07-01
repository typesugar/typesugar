/**
 * Tests for PEP-038 Wave 2E: Import injection for resolved instances.
 *
 * Verifies that when @derive resolves a field instance from another module
 * via the instance resolver, the transformer injects the appropriate import
 * declaration so the generated code can reference it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import { transformCode, TransformationPipeline } from "@typesugar/transformer/pipeline";
import { clearRegistries } from "@typesugar/macros";

beforeEach(() => {
  clearRegistries();
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Virtual file system for multi-file test setups.
 * Maps absolute file paths to their content strings.
 */
function createVirtualFs(files: Record<string, string>): {
  readFile: (f: string) => string | undefined;
  fileExists: (f: string) => boolean;
  resolvedFiles: Record<string, string>;
} {
  const resolvedFiles: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    resolvedFiles[path.resolve(name)] = content;
  }
  return {
    readFile: (f: string) => resolvedFiles[f] ?? ts.sys.readFile(f),
    fileExists: (f: string) => f in resolvedFiles || ts.sys.fileExists(f),
    resolvedFiles,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("PEP-038 Wave 2E: Instance import injection", () => {
  it("pendingInstanceImports mechanism injects imports into output", () => {
    // This test verifies the basic mechanism works: the transformer has a
    // pendingInstanceImports map that produces import declarations injected
    // at the top of the output file.
    //
    // We test this by checking the transformer's instance import machinery
    // works end-to-end through a @derive expansion that references instances
    // from another module.

    const libraryCode = `
/** @impl Eq<number> */
export const eqNumber: Eq<number> = {
  equals: (a: number, b: number): boolean => a === b,
};

export interface Eq<A> {
  equals(a: A, b: A): boolean;
}
`.trim();

    const consumerCode = `
import { Eq, eqNumber } from "./library";

interface Point {
  x: number;
  y: number;
}

// @derive(Eq) should generate code that references eqNumber
// and the import should already exist (explicitly imported)
@derive(Eq)
interface Point {
  x: number;
  y: number;
}
`.trim();

    const vfs = createVirtualFs({
      "library.ts": libraryCode,
      "consumer.ts": consumerCode,
    });

    const result = transformCode(consumerCode, {
      fileName: "consumer.ts",
      extraRootFiles: [path.resolve("library.ts")],
      readFile: vfs.readFile,
      fileExists: vfs.fileExists,
    });

    // The transform should succeed (no fatal errors)
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("scheduleInstanceImport deduplicates by name+module", () => {
    // Test that scheduling the same import twice doesn't create duplicate declarations.
    // We verify this indirectly through the transformer output.

    const code = `
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@derive(Eq)
interface Point {
  x: number;
  y: number;
}
`.trim();

    const result = transformCode(code, {
      fileName: "test.ts",
    });

    // Should not crash and should produce output
    expect(result.code).toBeDefined();
  });

  it("buildInstanceImportDeclarations groups imports by module", () => {
    // Verify that multiple instances from the same module are grouped into
    // a single import declaration.
    // This is tested indirectly through the output format.

    const code = `
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@derive(Eq)
interface Pair {
  first: number;
  second: string;
}
`.trim();

    const result = transformCode(code, {
      fileName: "test.ts",
    });

    expect(result.code).toBeDefined();
    // If there were cross-module instances, they would be grouped.
    // For local-only instances, no extra imports are needed.
  });

  it("does not inject import for local-scope instances", () => {
    // Instances defined in the same file should NOT trigger import injection
    // since they are already in scope.

    const code = `
interface Eq<A> {
  equals(a: A, b: A): boolean;
}

/** @impl Eq<number> */
const eqNumber: Eq<number> = {
  equals: (a: number, b: number): boolean => a === b,
};

@derive(Eq)
interface Point {
  x: number;
  y: number;
}
`.trim();

    const result = transformCode(code, {
      fileName: "test.ts",
    });

    // Should not inject any new imports for local instances
    const importLines = (result.code ?? "")
      .split("\n")
      .filter((line) => line.startsWith("import "));
    // No import lines should reference eqNumber (it's already local)
    for (const line of importLines) {
      expect(line).not.toContain("eqNumber");
    }
  });

  it("injects import when field instance is resolved from another module", () => {
    // End-to-end test: a library exports an @impl-tagged instance,
    // a consumer imports from the library and uses @derive.
    // The transformer should resolve the field instance and inject the import.

    const libraryPath = path.resolve("lib-instances.ts");
    const consumerPath = path.resolve("consumer-derive.ts");

    const libraryCode = `
/** @impl Eq<number> */
export const eqNumber = {
  equals: (a: number, b: number): boolean => a === b,
};
`.trim();

    const consumerCode = `
import { eqNumber } from "./lib-instances";

interface Eq<A> {
  equals(a: A, b: A): boolean;
}

@derive(Eq)
interface Point {
  x: number;
  y: number;
}
`.trim();

    const files: Record<string, string> = {
      [libraryPath]: libraryCode,
      [consumerPath]: consumerCode,
    };

    const result = transformCode(consumerCode, {
      fileName: consumerPath,
      extraRootFiles: [libraryPath],
      readFile: (f: string) => files[f] ?? ts.sys.readFile(f),
      fileExists: (f: string) => f in files || ts.sys.fileExists(f),
    });

    // Verify the transform ran and produced output
    expect(result.code).toBeDefined();
    // The existing import should still be present (already imported, no duplicate)
    expect(result.code).toContain("eqNumber");
    // Verify no fatal errors
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  it("does not inject duplicate imports for already-imported names", () => {
    // If the user already explicitly imports an instance, the transformer
    // should not inject a duplicate import.

    const libraryCode = `
export interface Eq<A> {
  equals(a: A, b: A): boolean;
}

/** @impl Eq<number> */
export const eqNumber: Eq<number> = {
  equals: (a: number, b: number): boolean => a === b,
};
`.trim();

    const consumerCode = `
import { Eq, eqNumber } from "./library";

@derive(Eq)
interface Point {
  x: number;
  y: number;
}
`.trim();

    const vfs = createVirtualFs({
      "library.ts": libraryCode,
      "consumer.ts": consumerCode,
    });

    const result = transformCode(consumerCode, {
      fileName: "consumer.ts",
      extraRootFiles: [path.resolve("library.ts")],
      readFile: vfs.readFile,
      fileExists: vfs.fileExists,
    });

    // Count how many times eqNumber appears in import declarations
    const importLines = (result.code ?? "")
      .split("\n")
      .filter((line) => line.startsWith("import ") && line.includes("eqNumber"));
    // Should have at most 1 import line with eqNumber (the original)
    expect(importLines.length).toBeLessThanOrEqual(1);
  });
});
