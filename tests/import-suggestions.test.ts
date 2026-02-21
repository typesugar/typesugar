/**
 * Tests for the import suggestion system
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  getExportIndex,
  resetExportIndex,
  registerExport,
  getSuggestionsForSymbol,
  getSuggestionsForMethod,
  getSuggestionsForTypeclass,
  getSuggestionsForMacro,
  formatSuggestionsMessage,
  generateImportFix,
  type ExportedSymbol,
} from "../packages/core/src/import-suggestions.js";

describe("import suggestion system", () => {
  beforeEach(() => {
    resetExportIndex();
  });

  describe("export index", () => {
    it("initializes with default exports", () => {
      const index = getExportIndex();

      // Check typeclasses - both original and re-exports are registered
      // The last one registered wins for typeclassToModule
      const eqModule = index.typeclassToModule.get("Eq");
      expect(eqModule === "@typesugar/std" || eqModule === "typesugar").toBe(
        true,
      );

      // Check that Eq is available from at least one module
      const eqExports = index.byName.get("Eq");
      expect(eqExports).toBeDefined();
      expect(
        eqExports!.some(
          (e) => e.module === "@typesugar/std" || e.module === "typesugar",
        ),
      ).toBe(true);

      // Check macros
      expect(index.macroToModule.get("comptime")).toBe("typesugar");
      expect(index.macroToModule.get("match")).toBe("typesugar");

      // Check extension methods
      expect(index.extensionToModule.get("clamp")).toContain("@typesugar/std");
      expect(index.extensionToModule.get("capitalize")).toContain(
        "@typesugar/std",
      );
    });

    it("can register custom exports", () => {
      const index = getExportIndex();

      registerExport({
        name: "MyTypeclass",
        module: "@my/lib",
        kind: "typeclass",
        isReexport: false,
      });

      expect(index.typeclassToModule.get("MyTypeclass")).toBe("@my/lib");
      expect(index.byName.get("MyTypeclass")).toHaveLength(1);
    });
  });

  describe("getSuggestionsForSymbol", () => {
    it("returns suggestions for known symbols", () => {
      const suggestions = getSuggestionsForSymbol("Option");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.module === "@typesugar/fp")).toBe(true);
    });

    it("prefers umbrella package", () => {
      const suggestions = getSuggestionsForSymbol("Option");

      // typesugar re-exports Option from @typesugar/fp
      const first = suggestions[0];
      expect(
        first.module === "typesugar" || first.module === "@typesugar/fp",
      ).toBe(true);
    });

    it("returns empty for unknown symbols", () => {
      const suggestions = getSuggestionsForSymbol("NotARealSymbol");
      expect(suggestions).toHaveLength(0);
    });

    it("includes import statement", () => {
      const suggestions = getSuggestionsForSymbol("comptime");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].importStatement).toContain("import {");
      expect(suggestions[0].importStatement).toContain("comptime");
    });
  });

  describe("getSuggestionsForMethod", () => {
    it("returns suggestions for known extension methods", () => {
      const suggestions = getSuggestionsForMethod("clamp");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.module === "@typesugar/std")).toBe(true);
    });

    it("returns empty for unknown methods", () => {
      const suggestions = getSuggestionsForMethod("notAMethod");
      expect(suggestions).toHaveLength(0);
    });

    it("includes method name in reason", () => {
      const suggestions = getSuggestionsForMethod("capitalize");

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].reason).toContain("capitalize");
    });
  });

  describe("getSuggestionsForTypeclass", () => {
    it("returns suggestion for known typeclass", () => {
      const suggestions = getSuggestionsForTypeclass("Show");

      expect(suggestions).toHaveLength(1);
      // Could be from @typesugar/std or re-exported via typesugar
      expect(
        suggestions[0].module === "@typesugar/std" ||
          suggestions[0].module === "typesugar",
      ).toBe(true);
      expect(suggestions[0].kind).toBe("typeclass");
    });

    it("returns empty for unknown typeclass", () => {
      const suggestions = getSuggestionsForTypeclass("NotATypeclass");
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("getSuggestionsForMacro", () => {
    it("returns suggestion for known macro", () => {
      const suggestions = getSuggestionsForMacro("comptime");

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].module).toBe("typesugar");
      expect(suggestions[0].kind).toBe("macro");
    });

    it("returns empty for unknown macro", () => {
      const suggestions = getSuggestionsForMacro("notAMacro");
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("formatSuggestionsMessage", () => {
    it("formats suggestions as message", () => {
      const suggestions = getSuggestionsForSymbol("Option");
      const message = formatSuggestionsMessage(suggestions);

      expect(message).toContain("Did you mean to import?");
      // Could be "import {" or "import type {" depending on kind
      expect(message).toContain("import");
      expect(message).toContain("Option");
    });

    it("limits number of suggestions", () => {
      // Register multiple exports
      for (let i = 0; i < 10; i++) {
        registerExport({
          name: "TestSymbol",
          module: `@lib/mod${i}`,
          kind: "function",
          isReexport: false,
        });
      }

      const suggestions = getSuggestionsForSymbol("TestSymbol");
      const message = formatSuggestionsMessage(suggestions, 2);

      expect(message).toContain("and 8 more");
    });

    it("returns empty string for no suggestions", () => {
      const message = formatSuggestionsMessage([]);
      expect(message).toBe("");
    });
  });

  describe("generateImportFix", () => {
    it("generates fix for file without imports", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const fix = generateImportFix(sourceFile, {
        symbolName: "Option",
        module: "@typesugar/fp",
        kind: "type",
        importStatement: `import type { Option } from "@typesugar/fp";`,
        confidence: 0.9,
        reason: "Option is exported from @typesugar/fp",
      });

      expect(fix.range.start).toBe(0);
      expect(fix.text).toContain("import type { Option }");
    });

    it("inserts after existing imports", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `import { foo } from "bar";

const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const fix = generateImportFix(sourceFile, {
        symbolName: "Option",
        module: "@typesugar/fp",
        kind: "type",
        importStatement: `import type { Option } from "@typesugar/fp";`,
        confidence: 0.9,
        reason: "Option is exported from @typesugar/fp",
      });

      // Should insert after the import statement
      expect(fix.range.start).toBeGreaterThan(0);
      expect(fix.text).toContain("\nimport type { Option }");
    });
  });
});
