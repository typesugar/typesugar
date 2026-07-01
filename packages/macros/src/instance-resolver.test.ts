/**
 * Tests for Instance Resolver (PEP-038 Wave 2B).
 *
 * Verifies Scala 3-style instance resolution: local scope, explicit imports,
 * module-level search, registry fallback, and type-based matching.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { InstanceScanner } from "./instance-scanner.js";
import { resolveInstance, clearResolverCache, type ResolutionResult } from "./instance-resolver.js";
import type { MacroContext } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: (() => void)[] = [];

beforeEach(() => {
  clearResolverCache();
});

afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups.length = 0;
  clearResolverCache();
});

interface ResolverTestContext {
  ctx: MacroContext;
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  scanner: InstanceScanner;
  getType: (typeName: string) => ts.Type;
  cleanup: () => void;
}

/**
 * Create a multi-file ts.Program and a mock MacroContext for the entry file.
 * @param files - Map of relative file names to source code
 * @param entryFile - Which file to use as the "current" source file
 */
function createResolverContext(
  files: Record<string, string>,
  entryFile: string
): ResolverTestContext {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-test-"));
  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  cleanups.push(cleanup);

  const filePaths: string[] = [];
  for (const [name, source] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, source);
    filePaths.push(filePath);
  }

  const entryPath = path.join(tmpDir, entryFile);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fn, languageVersion, onError, shouldCreate);
    if (sf && filePaths.includes(fn)) {
      return ts.createSourceFile(fn, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram(filePaths, options, host);
  const typeChecker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entryPath)!;
  const scanner = new InstanceScanner();

  // Helper to get a ts.Type from a keyword name.
  // Uses TypeChecker internal methods to get intrinsic types — synthetic
  // keyword nodes created via ts.factory aren't bound to a source file and
  // resolve to `any`.
  const getType = (typeName: string): ts.Type => {
    const tc = typeChecker as any;
    const typeMap: Record<string, () => ts.Type> = {
      number: () => tc.getNumberType(),
      string: () => tc.getStringType(),
      boolean: () => tc.getBooleanType(),
      bigint: () => tc.getBigIntType(),
      undefined: () => tc.getUndefinedType(),
      null: () => tc.getNullType(),
    };
    const getter = typeMap[typeName];
    if (getter) return getter();
    throw new Error(`getType: unsupported type "${typeName}"`);
  };

  const ctx = {
    program,
    typeChecker,
    sourceFile,
    factory: ts.factory,
  } as unknown as MacroContext;

  return { ctx, program, typeChecker, scanner, getType, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Instance Resolver", () => {
  it("finds @impl instance in local scope", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "main.ts": `
/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0,
};
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("ordNumber");
      expect(result!.source).toBe("local-scope");
    }
  });

  it("finds instance via explicit import", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "lib.ts": `
/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0,
};
      `,
        "main.ts": `
import { ordNumber } from "./lib.js";
export const x = ordNumber;
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("ordNumber");
      expect(result!.source).toBe("explicit-import");
    }
  });

  it("finds instance via module-level scan", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "lib.ts": `
export const Ord: unique symbol = Symbol("Ord");
/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0,
};
      `,
        "main.ts": `
import { Ord } from "./lib.js";
export const x = Ord;
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("ordNumber");
      expect(result!.source).toBe("module-scan");
    }
  });

  // NOTE: the legacy "falls back to registry" test was removed — PEP-052 deleted
  // the process-global registry fallback; resolution is now purely scope-based.

  it("local scope beats explicit import", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "lib.ts": `
/** @impl("Eq<number>") */
export const eqNumber = { eq: (a: number, b: number): boolean => a === b };
      `,
        "main.ts": `
import { eqNumber } from "./lib.js";

/** @impl("Eq<number>") */
export const localEqNumber = { eq: (a: number, b: number): boolean => a === b };
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Eq", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("localEqNumber");
      expect(result!.source).toBe("local-scope");
    }
  });

  it("explicit import beats module-level scan", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "lib-a.ts": `
/** @impl("Eq<number>") */
export const eqNumberA = { eq: (a: number, b: number): boolean => a === b };
      `,
        "lib-b.ts": `
export const Eq: unique symbol = Symbol("Eq");
/** @impl("Eq<number>") */
export const eqNumberB = { eq: (a: number, b: number): boolean => a === b };
      `,
        "main.ts": `
import { eqNumberA } from "./lib-a.js";
import { Eq } from "./lib-b.js";
export const x = eqNumberA;
export const y = Eq;
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Eq", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("eqNumberA");
      expect(result!.source).toBe("explicit-import");
    }
  });

  it("detects ambiguity at same priority level", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "lib-a.ts": `
export const Ord: unique symbol = Symbol("Ord");
/** @impl("Ord<number>") */
export const ordNumberA = { compare: (a: number, b: number): number => a - b };
      `,
        "lib-b.ts": `
/** @impl("Ord<number>") */
export const ordNumberB = { compare: (a: number, b: number): number => a - b };
      `,
        "main.ts": `
import { Ord } from "./lib-a.js";
import { Ord as Ord2 } from "./lib-b.js";
export const x = Ord;
export const y = Ord2;
      `,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("ambiguous");
    if (result!.kind === "ambiguous") {
      expect(result!.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns undefined when no match", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "main.ts": `export const x = 1;`,
      },
      "main.ts"
    );

    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);
    expect(result).toBeUndefined();
  });

  it("handles unresolvable import gracefully", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "main.ts": `
import { something } from "nonexistent-package";
export const x = 1;
      `,
      },
      "main.ts"
    );

    // Should not crash, just return undefined
    const result = resolveInstance(ctx, "Ord", getType("number"), scanner);
    expect(result).toBeUndefined();
  });

  it("type alias matches the underlying type", () => {
    const { ctx, scanner, typeChecker } = createResolverContext(
      {
        "main.ts": `
type MyNum = number;

/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0,
};

export const field: MyNum = 42;
      `,
      },
      "main.ts"
    );

    // Get the type of `field` which is `MyNum` (alias for `number`)
    const sourceFile = ctx.sourceFile;
    let fieldType: ts.Type | undefined;
    for (const stmt of sourceFile.statements) {
      if (ts.isVariableStatement(stmt)) {
        const decl = stmt.declarationList.declarations[0];
        if (ts.isIdentifier(decl.name) && decl.name.text === "field") {
          fieldType = typeChecker.getTypeAtLocation(decl);
          break;
        }
      }
    }
    expect(fieldType).toBeDefined();

    const result = resolveInstance(ctx, "Ord", fieldType!, scanner);

    expect(result).toBeDefined();
    expect(result!.kind).toBe("resolved");
    if (result!.kind === "resolved") {
      expect(result!.exportName).toBe("ordNumber");
    }
  });

  it("filters by typeclass name correctly", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "main.ts": `
/** @impl("Show<number>") */
export const showNumber = { show: (a: number): string => String(a) };

/** @impl("Ord<number>") */
export const ordNumber = {
  compare: (a: number, b: number): number => a < b ? -1 : a > b ? 1 : 0,
};
      `,
      },
      "main.ts"
    );

    const showResult = resolveInstance(ctx, "Show", getType("number"), scanner);
    expect(showResult).toBeDefined();
    expect(showResult!.kind).toBe("resolved");
    if (showResult!.kind === "resolved") {
      expect(showResult!.exportName).toBe("showNumber");
    }

    const ordResult = resolveInstance(ctx, "Ord", getType("number"), scanner);
    expect(ordResult).toBeDefined();
    expect(ordResult!.kind).toBe("resolved");
    if (ordResult!.kind === "resolved") {
      expect(ordResult!.exportName).toBe("ordNumber");
    }
  });

  it("clearResolverCache forces fresh resolution", () => {
    const { ctx, scanner, getType } = createResolverContext(
      {
        "main.ts": `
/** @impl("Eq<number>") */
export const eqNumber = { eq: (a: number, b: number): boolean => a === b };
      `,
      },
      "main.ts"
    );

    const r1 = resolveInstance(ctx, "Eq", getType("number"), scanner);
    expect(r1).toBeDefined();

    clearResolverCache();
    scanner.clearCache();

    const r2 = resolveInstance(ctx, "Eq", getType("number"), scanner);
    expect(r2).toBeDefined();
    expect(r2!.kind).toBe("resolved");
  });
});
