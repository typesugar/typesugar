/**
 * Integration tests for source map generation in unplugin-typesugar
 */

import { describe, it, expect } from "vitest";
import { globalExpansionTracker } from "@typesugar/core";
import * as ts from "typescript";

describe("unplugin source map integration", () => {
  describe("globalExpansionTracker integration", () => {
    it("should generate source map after recording expansions", () => {
      // Simulate what the unplugin does: record expansions, generate map
      const sourceCode = "const x = comptime(() => 5 * 5);";
      const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

      // Clear any previous state
      globalExpansionTracker.clear();

      // Find the call expression to simulate a macro expansion
      let callNode: ts.CallExpression | undefined;
      ts.forEachChild(sourceFile, (node) => {
        if (ts.isVariableStatement(node)) {
          const decl = node.declarationList.declarations[0];
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            callNode = decl.initializer;
          }
        }
      });
      expect(callNode).toBeDefined();

      // Record the expansion (simulating what the transformer does)
      globalExpansionTracker.recordExpansion("comptime", callNode!, sourceFile, "25");

      // Generate the source map
      const map = globalExpansionTracker.generateSourceMap(sourceCode, "test.ts");

      // Verify the map structure
      expect(map).not.toBeNull();
      expect(map!.version).toBe(3);
      expect(map!.sources).toContain("test.ts");
      expect(typeof map!.mappings).toBe("string");
      expect(map!.mappings.length).toBeGreaterThan(0);

      // Verify sources content is included
      expect(map!.sourcesContent).toBeDefined();
      expect(map!.sourcesContent![0]).toBe(sourceCode);

      // Clean up
      globalExpansionTracker.clear();
    });

    it("should isolate expansions between files", () => {
      globalExpansionTracker.clear();

      // First file
      const sourceCode1 = "const a = macro1();";
      const sourceFile1 = ts.createSourceFile(
        "file1.ts",
        sourceCode1,
        ts.ScriptTarget.Latest,
        true
      );

      const node1 = sourceFile1.statements[0];
      globalExpansionTracker.recordExpansion("macro1", node1, sourceFile1, "result1");

      // Second file
      const sourceCode2 = "const b = macro2();";
      const sourceFile2 = ts.createSourceFile(
        "file2.ts",
        sourceCode2,
        ts.ScriptTarget.Latest,
        true
      );

      const node2 = sourceFile2.statements[0];
      globalExpansionTracker.recordExpansion("macro2", node2, sourceFile2, "result2");

      // Generate maps for each file
      const map1 = globalExpansionTracker.generateSourceMap(sourceCode1, "file1.ts");
      const map2 = globalExpansionTracker.generateSourceMap(sourceCode2, "file2.ts");

      // Both should have maps
      expect(map1).not.toBeNull();
      expect(map2).not.toBeNull();

      // Maps should be for their respective files
      expect(map1!.sources).toContain("file1.ts");
      expect(map2!.sources).toContain("file2.ts");

      // Clean up
      globalExpansionTracker.clear();
    });

    it("should clear tracker state between transformations", () => {
      const sourceCode = "const x = macro();";
      const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

      // First transformation
      globalExpansionTracker.clear();
      globalExpansionTracker.recordExpansion(
        "macro",
        sourceFile.statements[0],
        sourceFile,
        "first"
      );
      expect(globalExpansionTracker.count).toBe(1);

      // Clear for next transformation
      globalExpansionTracker.clear();
      expect(globalExpansionTracker.count).toBe(0);

      // Second transformation
      globalExpansionTracker.recordExpansion(
        "macro",
        sourceFile.statements[0],
        sourceFile,
        "second"
      );
      expect(globalExpansionTracker.count).toBe(1);

      // Verify only the second expansion is recorded
      const expansions = globalExpansionTracker.getAllExpansions();
      expect(expansions[0].expandedText).toBe("second");

      globalExpansionTracker.clear();
    });
  });

  describe("source map format validation", () => {
    it("should produce valid VLQ-encoded mappings", () => {
      globalExpansionTracker.clear();

      const sourceCode = "const x = macro();";
      const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

      globalExpansionTracker.recordExpansion("macro", sourceFile.statements[0], sourceFile, "42");

      const map = globalExpansionTracker.generateSourceMap(sourceCode, "test.ts");
      expect(map).not.toBeNull();

      // Mappings should only contain valid VLQ characters
      const validChars = /^[A-Za-z0-9+/=,;]*$/;
      expect(map!.mappings).toMatch(validChars);

      globalExpansionTracker.clear();
    });

    it("should set correct file property in map", () => {
      globalExpansionTracker.clear();

      const sourceCode = "const x = macro();";
      const sourceFile = ts.createSourceFile(
        "src/app.ts",
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      globalExpansionTracker.recordExpansion("macro", sourceFile.statements[0], sourceFile, "42");

      const map = globalExpansionTracker.generateSourceMap(sourceCode, "src/app.ts");
      expect(map).not.toBeNull();

      // File should be the output .js file
      expect(map!.file).toBe("src/app.js");

      globalExpansionTracker.clear();
    });
  });
});
