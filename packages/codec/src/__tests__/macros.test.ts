/**
 * Tests for @typesugar/codec macro registration and @codec expansion
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "@typesugar/testing/macros";
import { codecMacro, register } from "../macros.js";

describe("codec macros", () => {
  it("register exports and runs without error", () => {
    expect(typeof register).toBe("function");
    expect(() => register()).not.toThrow();
  });

  it("codecMacro is defined with correct metadata", () => {
    expect(codecMacro.name).toBe("codec");
    expect(codecMacro.module).toBe("@typesugar/codec");
    expect(codecMacro.validTargets).toContain("interface");
    expect(codecMacro.validTargets).toContain("class");
  });
});

describe("@codec macro expansion", () => {
  function expandCodec(source: string): { nodes: ts.Node[] } {
    const fullSource = `
      import { defineSchema } from "@typesugar/codec";
      ${source}
    `;
    const ctx = createMacroTestContext(fullSource);

    let decl: ts.ClassDeclaration | ts.InterfaceDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node)) {
        decl = node;
      } else if (ts.isInterfaceDeclaration(node)) {
        decl = node;
      } else {
        ts.forEachChild(node, visit);
      }
    }
    ts.forEachChild(ctx.sourceFile, visit);

    if (!decl) throw new Error("No class/interface found");
    const dec = ts.factory.createDecorator(
      ts.factory.createCallExpression(ts.factory.createIdentifier("codec"), undefined, [])
    );

    const result = codecMacro.expand(ctx, dec, decl, []);
    const nodes = Array.isArray(result) ? result : [result];
    return { nodes };
  }

  it("expands @codec on class to return original + schema definition", () => {
    const { nodes } = expandCodec(`
class Product {
  id: number;
  name: string;
}
    `);

    // The macro should return [original class, schema variable statement]
    expect(nodes.length).toBe(2);
    expect(ts.isClassDeclaration(nodes[0])).toBe(true);
    expect(ts.isVariableStatement(nodes[1])).toBe(true);

    // The variable should be named ProductSchema
    const varStmt = nodes[1] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    const name = decl.name as ts.Identifier;
    expect(name.text).toBe("ProductSchema");
  });
});
