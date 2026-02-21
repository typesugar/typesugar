/**
 * Tests for the opt-out directive system
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  globalResolutionScope,
  scanImportsForScope,
  hasInlineOptOut,
  isInOptedOutScope,
  ResolutionScopeTracker,
} from "../packages/core/src/resolution-scope.js";

describe("opt-out directive system", () => {
  let tracker: ResolutionScopeTracker;

  beforeEach(() => {
    tracker = new ResolutionScopeTracker();
  });

  describe("file-level opt-out detection", () => {
    it("detects 'use no typesugar' with double quotes", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `import { foo } from "bar";
"use no typesugar";

const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOut).toBe(true);
    });

    it("detects 'use no typesugar' with single quotes", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `'use no typesugar';
const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOut).toBe(true);
    });

    it("does not trigger opt-out without the directive", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOut).toBe(false);
    });
  });

  describe("feature-specific opt-out", () => {
    it("detects 'use no typesugar macros'", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `"use no typesugar macros";
const x = 1;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOut).toBe(false);
      expect(scope.optedOutFeatures.has("macros")).toBe(true);
    });

    it("detects 'use no typesugar extensions'", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `"use no typesugar extensions";`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOutFeatures.has("extensions")).toBe(true);
    });

    it("detects 'use no typesugar derive'", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `"use no typesugar derive";`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOutFeatures.has("derive")).toBe(true);
    });

    it("detects multiple feature opt-outs", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `"use no typesugar macros";
"use no typesugar extensions";`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);
      const scope = tracker.getScope("test.ts");

      expect(scope.optedOutFeatures.has("macros")).toBe(true);
      expect(scope.optedOutFeatures.has("extensions")).toBe(true);
    });
  });

  describe("inline opt-out comments", () => {
    it("detects @ts-no-typesugar on a line", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `const x = 1;
const y = 2; // @ts-no-typesugar
const z = 3;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      // Find the 'y' declaration node
      const yDecl = sourceFile.statements[1] as ts.VariableStatement;

      expect(hasInlineOptOut(sourceFile, yDecl)).toBe(true);
      expect(hasInlineOptOut(sourceFile, sourceFile.statements[0])).toBe(false);
      expect(hasInlineOptOut(sourceFile, sourceFile.statements[2])).toBe(false);
    });

    it("detects @ts-no-typesugar with feature", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `x.clamp(0, 100); // @ts-no-typesugar extensions`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const stmt = sourceFile.statements[0];

      expect(hasInlineOptOut(sourceFile, stmt, "extensions")).toBe(true);
      expect(hasInlineOptOut(sourceFile, stmt, "macros")).toBe(false);
    });

    it("detects @ts-no-typesugar-all", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `x.foo(); // @ts-no-typesugar-all`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const stmt = sourceFile.statements[0];

      expect(hasInlineOptOut(sourceFile, stmt, "extensions")).toBe(true);
      expect(hasInlineOptOut(sourceFile, stmt, "macros")).toBe(true);
    });
  });

  describe("function-scoped opt-out", () => {
    it("detects 'use no typesugar' in function body", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `function foo() {
  "use no typesugar";
  const x = comptime(() => 1);
  return x;
}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);

      // Find the inner expression
      const funcDecl = sourceFile.statements[0] as ts.FunctionDeclaration;
      const body = funcDecl.body!;
      const varStmt = body.statements[1] as ts.VariableStatement;

      expect(isInOptedOutScope(sourceFile, varStmt, tracker)).toBe(true);
    });

    it("does not opt out code outside the function", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `const before = 1;
function foo() {
  "use no typesugar";
  const inside = 2;
}
const after = 3;`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);

      const beforeStmt = sourceFile.statements[0];
      const afterStmt = sourceFile.statements[2];
      const funcDecl = sourceFile.statements[1] as ts.FunctionDeclaration;
      const insideStmt = funcDecl.body!.statements[1];

      expect(isInOptedOutScope(sourceFile, beforeStmt, tracker)).toBe(false);
      expect(isInOptedOutScope(sourceFile, afterStmt, tracker)).toBe(false);
      expect(isInOptedOutScope(sourceFile, insideStmt, tracker)).toBe(true);
    });

    it("detects feature-specific opt-out in function", () => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        `function foo() {
  "use no typesugar extensions";
  x.clamp(0, 100);
}`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      scanImportsForScope(sourceFile, tracker);

      const funcDecl = sourceFile.statements[0] as ts.FunctionDeclaration;
      const callStmt = funcDecl.body!.statements[1];

      expect(
        isInOptedOutScope(sourceFile, callStmt, tracker, "extensions"),
      ).toBe(true);
      expect(isInOptedOutScope(sourceFile, callStmt, tracker, "macros")).toBe(
        false,
      );
    });
  });

  describe("isFeatureOptedOut", () => {
    it("returns true for file-level opt-out", () => {
      tracker.setOptedOut("test.ts", true);

      expect(tracker.isFeatureOptedOut("test.ts", "macros")).toBe(true);
      expect(tracker.isFeatureOptedOut("test.ts", "extensions")).toBe(true);
    });

    it("returns true for specific feature opt-out", () => {
      tracker.addOptedOutFeature("test.ts", "macros");

      expect(tracker.isFeatureOptedOut("test.ts", "macros")).toBe(true);
      expect(tracker.isFeatureOptedOut("test.ts", "extensions")).toBe(false);
    });
  });

  describe("scope clearing", () => {
    it("clears scope for file", () => {
      tracker.setOptedOut("test.ts", true);
      tracker.addOptedOutFeature("test.ts", "macros");

      tracker.clearScope("test.ts");

      const scope = tracker.getScope("test.ts");
      expect(scope.optedOut).toBe(false);
      expect(scope.optedOutFeatures.size).toBe(0);
    });

    it("resets all scopes", () => {
      tracker.setOptedOut("a.ts", true);
      tracker.setOptedOut("b.ts", true);

      tracker.reset();

      expect(tracker.getScope("a.ts").optedOut).toBe(false);
      expect(tracker.getScope("b.ts").optedOut).toBe(false);
    });
  });
});
