/**
 * End-to-end tests for CLI pipeline SFINAE integration (PEP-011 Wave 6)
 *
 * Verifies that `filterDiagnostics()` is applied consistently between
 * the CLI build path and the IDE (language service) path, and that
 * `--show-sfinae` / `TYPESUGAR_SHOW_SFINAE=1` enables audit output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import {
  registerSfinaeRule,
  clearSfinaeRules,
  filterDiagnostics,
  getSfinaeRules,
  setSfinaeAuditMode,
  getSfinaeAuditLog,
  clearSfinaeAuditLog,
  registerStandaloneExtensionEntry,
  standaloneExtensionRegistry,
  registerTypeRewrite,
  clearTypeRewrites,
} from "@typesugar/core";
import {
  createExtensionMethodCallRule,
  createNewtypeAssignmentRule,
  createTypeRewriteAssignmentRule,
} from "@typesugar/macros";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(
  files: Record<string, string>,
  mainFile = "/test.ts"
): { program: ts.Program; checker: ts.TypeChecker; diagnostics: readonly ts.Diagnostic[] } {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  const fileMap = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    fileMap.set(name, content);
  }

  const host = ts.createCompilerHost(compilerOptions);
  const origGetSourceFile = host.getSourceFile;
  const origFileExists = host.fileExists;
  const origReadFile = host.readFile;

  host.getSourceFile = (fileName, languageVersion, onError) => {
    const content = fileMap.get(fileName);
    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, languageVersion, true);
    }
    return origGetSourceFile.call(host, fileName, languageVersion, onError);
  };

  host.fileExists = (fileName) => {
    return fileMap.has(fileName) || origFileExists.call(host, fileName);
  };

  host.readFile = (fileName) => {
    return fileMap.get(fileName) ?? origReadFile.call(host, fileName);
  };

  const program = ts.createProgram(Array.from(fileMap.keys()), compilerOptions, host);
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return { program, checker, diagnostics };
}

function getDiagnosticsForFile(
  diagnostics: readonly ts.Diagnostic[],
  fileName: string
): ts.Diagnostic[] {
  return diagnostics.filter((d) => d.file?.fileName === fileName);
}

/**
 * Simulate the CLI pipeline's diagnostic filtering:
 * 1. Collect raw diagnostics from ts.getPreEmitDiagnostics()
 * 2. Filter through SFINAE rules (same as cli.ts build())
 * 3. Return filtered diagnostics
 */
function simulateCliBuild(
  files: Record<string, string>,
  mainFile = "/test.ts"
): {
  rawDiagnostics: readonly ts.Diagnostic[];
  filteredDiagnostics: ts.Diagnostic[];
  program: ts.Program;
} {
  const { program, checker, diagnostics: rawDiagnostics } = createProgram(files, mainFile);

  const filteredDiagnostics =
    getSfinaeRules().length > 0
      ? filterDiagnostics(rawDiagnostics, checker, (fn) => program.getSourceFile(fn))
      : [...rawDiagnostics];

  return { rawDiagnostics, filteredDiagnostics, program };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI Pipeline SFINAE Integration (PEP-011 Wave 6)", () => {
  beforeEach(() => {
    clearSfinaeRules();
    clearSfinaeAuditLog();
    setSfinaeAuditMode(undefined);
    standaloneExtensionRegistry.length = 0;
    clearTypeRewrites();
  });

  afterEach(() => {
    clearSfinaeRules();
    clearSfinaeAuditLog();
    setSfinaeAuditMode(undefined);
    standaloneExtensionRegistry.length = 0;
    clearTypeRewrites();
  });

  describe("rule registration", () => {
    it("registers all built-in SFINAE rules for CLI", () => {
      registerSfinaeRule(createExtensionMethodCallRule());
      registerSfinaeRule(createNewtypeAssignmentRule());
      registerSfinaeRule(createTypeRewriteAssignmentRule());

      const rules = getSfinaeRules();
      expect(rules).toHaveLength(3);
      expect(rules.map((r) => r.name)).toEqual([
        "ExtensionMethodCall",
        "NewtypeAssignment",
        "TypeRewriteAssignment",
      ]);
    });

    it("does not duplicate rules on repeated registration", () => {
      const register = () => {
        if (!getSfinaeRules().some((r) => r.name === "ExtensionMethodCall")) {
          registerSfinaeRule(createExtensionMethodCallRule());
        }
        if (!getSfinaeRules().some((r) => r.name === "NewtypeAssignment")) {
          registerSfinaeRule(createNewtypeAssignmentRule());
        }
        if (!getSfinaeRules().some((r) => r.name === "TypeRewriteAssignment")) {
          registerSfinaeRule(createTypeRewriteAssignmentRule());
        }
      };

      register();
      register();
      register();
      expect(getSfinaeRules()).toHaveLength(3);
    });
  });

  describe("extension method suppression in CLI", () => {
    it("suppresses TS2339 when extension method is registered", () => {
      registerSfinaeRule(createExtensionMethodCallRule());
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
      });

      const result = simulateCliBuild({
        "/test.ts": `
          const x = (42).clamp(0, 100);
        `,
      });

      const rawTs2339 = getDiagnosticsForFile(result.rawDiagnostics, "/test.ts").filter(
        (d) => d.code === 2339
      );
      const filteredTs2339 = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2339
      );

      expect(rawTs2339.length).toBeGreaterThan(0);
      expect(filteredTs2339).toHaveLength(0);
    });

    it("does NOT suppress TS2339 for unregistered methods", () => {
      registerSfinaeRule(createExtensionMethodCallRule());

      const result = simulateCliBuild({
        "/test.ts": `
          const x = (42).nonExistentMethod(0, 100);
        `,
      });

      const filteredTs2339 = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2339
      );
      expect(filteredTs2339.length).toBeGreaterThan(0);
    });
  });

  describe("newtype assignment suppression in CLI", () => {
    it("suppresses TS2322 for Newtype assignment", () => {
      registerSfinaeRule(createNewtypeAssignmentRule());

      const result = simulateCliBuild({
        "/test.ts": `
          declare const __brand: unique symbol;
          type Newtype<Base, Brand> = Base & { readonly [__brand]: Brand };
          type UserId = Newtype<number, "UserId">;

          const id: UserId = 42;
        `,
      });

      const rawTs2322 = getDiagnosticsForFile(result.rawDiagnostics, "/test.ts").filter(
        (d) => d.code === 2322
      );
      const filteredTs2322 = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2322
      );

      expect(rawTs2322.length).toBeGreaterThan(0);
      expect(filteredTs2322).toHaveLength(0);
    });
  });

  describe("type rewrite suppression in CLI", () => {
    it("suppresses TS2322 when type rewrite registry entry matches", () => {
      registerSfinaeRule(createTypeRewriteAssignmentRule());
      registerTypeRewrite({
        typeName: "Opaque",
        underlyingTypeText: "number",
        matchesUnderlying: (candidate: string) => candidate === "number",
      });

      const result = simulateCliBuild({
        "/test.ts": `
          interface Opaque { __opaque: true; }
          const o: Opaque = 42 as any as number;
        `,
      });

      const rawTs2322 = getDiagnosticsForFile(result.rawDiagnostics, "/test.ts").filter(
        (d) => d.code === 2322
      );
      const filteredTs2322 = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2322
      );

      // If there are TS2322 errors, they should be suppressed
      if (rawTs2322.length > 0) {
        expect(filteredTs2322).toHaveLength(0);
      }
    });
  });

  describe("combined rules — all SFINAE-suppressible errors clean", () => {
    it("produces clean output when all rules are registered", () => {
      registerSfinaeRule(createExtensionMethodCallRule());
      registerSfinaeRule(createNewtypeAssignmentRule());
      registerSfinaeRule(createTypeRewriteAssignmentRule());

      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
      });

      const result = simulateCliBuild({
        "/test.ts": `
          declare const __brand: unique symbol;
          type Newtype<Base, Brand> = Base & { readonly [__brand]: Brand };
          type UserId = Newtype<number, "UserId">;

          // Extension method — TS2339 suppressed by ExtensionMethodCall rule
          const x = (42).clamp(0, 100);

          // Newtype assignment — TS2322 suppressed by NewtypeAssignment rule
          const id: UserId = 42;
        `,
      });

      // All SFINAE-suppressible errors should be filtered out
      const errors = result.filteredDiagnostics.filter(
        (d) => d.category === ts.DiagnosticCategory.Error && d.file?.fileName === "/test.ts"
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe("audit mode (--show-sfinae)", () => {
    it("logs suppressed diagnostics when audit mode is enabled", () => {
      setSfinaeAuditMode(true);
      registerSfinaeRule(createExtensionMethodCallRule());
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
      });

      simulateCliBuild({
        "/test.ts": `
          const x = (42).clamp(0, 100);
        `,
      });

      const auditLog = getSfinaeAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog[0].ruleName).toBe("ExtensionMethodCall");
      expect(auditLog[0].errorCode).toBe(2339);
    });

    it("does not log when audit mode is disabled", () => {
      setSfinaeAuditMode(false);
      registerSfinaeRule(createExtensionMethodCallRule());
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
      });

      simulateCliBuild({
        "/test.ts": `
          const x = (42).clamp(0, 100);
        `,
      });

      const auditLog = getSfinaeAuditLog();
      expect(auditLog).toHaveLength(0);
    });

    it("respects env var TYPESUGAR_SHOW_SFINAE=1", () => {
      // setSfinaeAuditMode(undefined) reverts to env-var detection
      setSfinaeAuditMode(undefined);
      const originalEnv = process.env.TYPESUGAR_SHOW_SFINAE;
      process.env.TYPESUGAR_SHOW_SFINAE = "1";

      try {
        registerSfinaeRule(createExtensionMethodCallRule());
        registerStandaloneExtensionEntry({
          methodName: "clamp",
          forType: "number",
        });

        simulateCliBuild({
          "/test.ts": `
            const x = (42).clamp(0, 100);
          `,
        });

        const auditLog = getSfinaeAuditLog();
        expect(auditLog.length).toBeGreaterThan(0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TYPESUGAR_SHOW_SFINAE;
        } else {
          process.env.TYPESUGAR_SHOW_SFINAE = originalEnv;
        }
      }
    });
  });

  describe("real errors are not suppressed", () => {
    it("preserves genuine type errors", () => {
      registerSfinaeRule(createExtensionMethodCallRule());
      registerSfinaeRule(createNewtypeAssignmentRule());
      registerSfinaeRule(createTypeRewriteAssignmentRule());

      const result = simulateCliBuild({
        "/test.ts": `
          const x: string = 42;
          const y: number = "hello";
        `,
      });

      const errors = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2322
      );
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });

    it("does not suppress TS2339 for non-extension properties", () => {
      registerSfinaeRule(createExtensionMethodCallRule());

      const result = simulateCliBuild({
        "/test.ts": `
          const obj = { a: 1 };
          const val = obj.nonExistent;
        `,
      });

      const errors = getDiagnosticsForFile(result.filteredDiagnostics, "/test.ts").filter(
        (d) => d.code === 2339
      );
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("no rules registered — passthrough", () => {
    it("returns all diagnostics unfiltered when no rules are registered", () => {
      const result = simulateCliBuild({
        "/test.ts": `
          const x: string = 42;
        `,
      });

      expect(result.filteredDiagnostics.length).toBe(result.rawDiagnostics.length);
    });
  });
});
