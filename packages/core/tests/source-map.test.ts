/**
 * Additional tests for ExpansionTracker.generateExpandedCode and edge cases.
 *
 * Core behavioral tests live in tests/source-map.test.ts (legacy root).
 * This file covers:
 * - generateExpandedCode() text surgery
 * - Edge cases: empty expansion, nested output verification, overlapping ranges
 * - preserveSourceMap with synthetic node
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { preserveSourceMap, ExpansionTracker } from "@typesugar/core";

function findCallExpression(sourceFile: ts.SourceFile, index = 0): ts.CallExpression | undefined {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls[index];
}

function findCallExpressions(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

describe("ExpansionTracker.generateExpandedCode", () => {
  let tracker: ExpansionTracker;

  beforeEach(() => {
    tracker = new ExpansionTracker();
  });

  it("should return null when no expansions recorded", () => {
    const code = tracker.generateExpandedCode("const x = 1;", "test.ts");
    expect(code).toBeNull();
  });

  it("should return null when no expansions for the given file", () => {
    const sourceCode = "const x = macro();";
    const sourceFile = ts.createSourceFile("other.ts", sourceCode, ts.ScriptTarget.Latest, true);
    tracker.recordExpansion("macro", sourceFile.statements[0], sourceFile, "result");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).toBeNull();
  });

  it("should surgically replace single expansion", () => {
    const sourceCode = "const x = comptime(() => 5 * 5);";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);
    const callNode = findCallExpression(sourceFile);
    expect(callNode).toBeDefined();

    tracker.recordExpansion("comptime", callNode!, sourceFile, "25");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).not.toBeNull();
    expect(code).toBe("const x = 25;");
  });

  it("should replace multiple non-overlapping expansions", () => {
    const sourceCode = "const x = comptime(() => 1); const y = comptime(() => 2);";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);
    const calls = findCallExpressions(sourceFile);
    expect(calls).toHaveLength(2);

    tracker.recordExpansion("comptime", calls[0], sourceFile, "1");
    tracker.recordExpansion("comptime", calls[1], sourceFile, "2");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).not.toBeNull();
    expect(code).toBe("const x = 1; const y = 2;");
  });

  it("should apply only outermost expansion when nested", () => {
    const sourceCode = "const x = outer(inner(1));";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);

    let outerCall: ts.CallExpression | undefined;
    let innerCall: ts.CallExpression | undefined;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl.initializer && ts.isCallExpression(decl.initializer)) {
          outerCall = decl.initializer;
          if (outerCall.arguments.length > 0 && ts.isCallExpression(outerCall.arguments[0])) {
            innerCall = outerCall.arguments[0];
          }
        }
      }
    });
    expect(outerCall).toBeDefined();
    expect(innerCall).toBeDefined();

    tracker.recordExpansion("inner", innerCall!, sourceFile, "wrapped(1)");
    tracker.recordExpansion("outer", outerCall!, sourceFile, "result");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).not.toBeNull();
    // Only outer is applied; inner is skipped (nested)
    expect(code).toBe("const x = result;");
  });

  it("should handle empty expansion text", () => {
    const sourceCode = "const x = macro();";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);
    const callNode = findCallExpression(sourceFile);
    expect(callNode).toBeDefined();

    tracker.recordExpansion("macro", callNode!, sourceFile, "");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).not.toBeNull();
    // macro() replaced with empty string
    expect(code).toBe("const x = ;");
  });

  it("should preserve surrounding source byte-for-byte", () => {
    const sourceCode = "  const x = macro();  \n  // comment\n";
    const sourceFile = ts.createSourceFile("test.ts", sourceCode, ts.ScriptTarget.Latest, true);
    const callNode = findCallExpression(sourceFile);
    expect(callNode).toBeDefined();

    tracker.recordExpansion("macro", callNode!, sourceFile, "42");

    const code = tracker.generateExpandedCode(sourceCode, "test.ts");
    expect(code).not.toBeNull();
    expect(code).toBe("  const x = 42;  \n  // comment\n");
  });
});

describe("preserveSourceMap edge cases", () => {
  it("should handle original node with no source map range", () => {
    // Synthetic node has pos/end -1; getSourceMapRange may return default
    const factory = ts.factory;
    const syntheticOriginal = factory.createNumericLiteral("0");
    const newNode = factory.createNumericLiteral("1");

    // Should not throw; may set empty/default range on newNode
    const result = preserveSourceMap(newNode, syntheticOriginal);
    expect(result).toBe(newNode);
  });
});
