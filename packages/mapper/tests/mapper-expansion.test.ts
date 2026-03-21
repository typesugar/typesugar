/**
 * @typesugar/mapper — macro expansion tests for nested, collections, and renamePaths
 *
 * Tests the transformInto and transformArrayInto macro expansion directly using
 * MacroContext, verifying code generation for Phase 2 features.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroContext } from "@typesugar/core";
import { transformIntoMacro, transformArrayIntoMacro } from "../src/macros.js";

function createTestContext(sourceText: string) {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  const transformContext: ts.TransformationContext = {
    factory: ts.factory,
    getCompilerOptions: () => options,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_hint, node) => node,
    onEmitNode: (_hint, node, emitCallback) => emitCallback(_hint, node),
    addDiagnostic: () => {},
  };

  return createMacroContext(program, sourceFile, transformContext);
}

function expandMacro(
  macro: typeof transformIntoMacro,
  source: string
): { result: ts.Expression; output: string } {
  const preamble =
    "export declare function transformInto<From, To>(source: From, config?: any): To;\n" +
    "export declare function transformArrayInto<From, To>(items: From[], config?: any): To[];\n";
  const fullSource = preamble + source;
  const ctx = createTestContext(fullSource);

  let callExpr: ts.CallExpression | undefined;
  ts.forEachChild(ctx.sourceFile, function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      callExpr = node;
    } else {
      ts.forEachChild(node, visit);
    }
  });

  if (!callExpr) throw new Error("No CallExpression found");

  const result = macro.expand(ctx, callExpr, callExpr.arguments);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = printer.printNode(ts.EmitHint.Unspecified, result, ctx.sourceFile);

  return { result, output };
}

function expandTransformInto(source: string) {
  return expandMacro(transformIntoMacro, source);
}

function expandTransformArrayInto(source: string) {
  return expandMacro(transformArrayIntoMacro, source);
}

/** Normalize whitespace for comparison */
function norm(s: string): string {
  return s.replace(/\s+/g, "");
}

describe("nested object transformation", () => {
  it("generates nested object literal with rename sub-config", () => {
    const { output } = expandTransformInto(`
      interface SourceAddress { city: string; zip: string; }
      interface TargetAddress { location: string; zip: string; }
      interface Source { address: SourceAddress; }
      interface Target { address: TargetAddress; }
      const s: Source = { address: { city: "NYC", zip: "10001" } };
      transformInto<Source, Target>(s, {
        nested: { address: { rename: { location: "city" } } }
      });
    `);
    // Should generate a nested object for address with renamed field
    expect(norm(output)).toContain("address:");
    expect(norm(output)).toContain("location:s.address.city");
    expect(norm(output)).toContain("zip:s.address.zip");
  });

  it("generates nested object literal with const sub-config", () => {
    const { output } = expandTransformInto(`
      interface SourceMeta { name: string; }
      interface TargetMeta { name: string; kind: string; }
      interface Source { meta: SourceMeta; }
      interface Target { meta: TargetMeta; }
      const s: Source = { meta: { name: "test" } };
      transformInto<Source, Target>(s, {
        nested: { meta: { const: { kind: "nested" } } }
      });
    `);
    expect(norm(output)).toContain("name:s.meta.name");
    expect(norm(output)).toContain('kind:"nested"');
  });

  it("passes through non-nested fields alongside nested ones", () => {
    const { output } = expandTransformInto(`
      interface Source { id: number; address: { city: string; }; }
      interface Target { id: number; address: { location: string; }; }
      const s: Source = { id: 1, address: { city: "NYC" } };
      transformInto<Source, Target>(s, {
        nested: { address: { rename: { location: "city" } } }
      });
    `);
    expect(norm(output)).toContain("id:s.id");
    expect(norm(output)).toContain("location:s.address.city");
  });

  it("handles empty nested config (identity copy of nested object)", () => {
    const { output } = expandTransformInto(`
      interface Inner { x: number; y: string; }
      interface Source { inner: Inner; }
      interface Target { inner: Inner; }
      const s: Source = { inner: { x: 1, y: "a" } };
      transformInto<Source, Target>(s, {
        nested: { inner: {} }
      });
    `);
    expect(norm(output)).toContain("x:s.inner.x");
    expect(norm(output)).toContain("y:s.inner.y");
  });
});

describe("collection mapping", () => {
  it("generates .map() call for array field with rename sub-config", () => {
    const { output } = expandTransformInto(`
      interface ItemFrom { id: number; name: string; }
      interface ItemTo { itemId: number; name: string; }
      interface Source { items: ItemFrom[]; }
      interface Target { items: ItemTo[]; }
      const s: Source = { items: [{ id: 1, name: "a" }] };
      transformInto<Source, Target>(s, {
        collections: { items: { rename: { itemId: "id" } } }
      });
    `);
    expect(output).toContain(".map(");
    expect(output).toContain("s.items.map");
    // The callback should map itemId from id
    expect(norm(output)).toMatch(/itemId:.*\.id/);
    expect(norm(output)).toMatch(/name:.*\.name/);
  });

  it("generates .map() with const in element config", () => {
    const { output } = expandTransformInto(`
      interface ItemFrom { x: number; }
      interface ItemTo { x: number; tag: string; }
      interface Source { items: ItemFrom[]; }
      interface Target { items: ItemTo[]; }
      const s: Source = { items: [{ x: 1 }] };
      transformInto<Source, Target>(s, {
        collections: { items: { const: { tag: "item" } } }
      });
    `);
    expect(output).toContain(".map(");
    expect(norm(output)).toMatch(/tag:"item"/);
  });

  it("passes through non-collection fields alongside collections", () => {
    const { output } = expandTransformInto(`
      interface ItemFrom { id: number; }
      interface ItemTo { id: number; }
      interface Source { name: string; items: ItemFrom[]; }
      interface Target { name: string; items: ItemTo[]; }
      const s: Source = { name: "test", items: [{ id: 1 }] };
      transformInto<Source, Target>(s, {
        collections: { items: {} }
      });
    `);
    expect(norm(output)).toContain("name:s.name");
    expect(output).toContain("s.items.map");
  });
});

describe("transformArrayInto macro", () => {
  it("generates .map() call for array with rename config", () => {
    const { output } = expandTransformArrayInto(`
      interface From { first_name: string; }
      interface To { firstName: string; }
      const items: From[] = [{ first_name: "John" }];
      transformArrayInto<From, To>(items, { rename: { firstName: "first_name" } });
    `);
    expect(output).toContain("items.map(");
    expect(norm(output)).toContain("firstName:");
    expect(norm(output)).toContain(".first_name");
  });

  it("generates .map() with const config for elements", () => {
    const { output } = expandTransformArrayInto(`
      interface From { x: number; }
      interface To { x: number; role: string; }
      const items: From[] = [{ x: 1 }];
      transformArrayInto<From, To>(items, { const: { role: "user" } });
    `);
    expect(output).toContain("items.map(");
    expect(norm(output)).toMatch(/role:"user"/);
  });
});

describe("renamePaths (dot-notation renames)", () => {
  it("generates nested property access for dot-notation paths", () => {
    const { output } = expandTransformInto(`
      interface Source { address: { city: string; zip: string; }; }
      interface Target { address: { location: string; zip: string; }; }
      const s: Source = { address: { city: "NYC", zip: "10001" } };
      transformInto<Source, Target>(s, {
        renamePaths: { "address.location": "address.city" }
      });
    `);
    // Should generate a nested object with location mapped from address.city
    expect(norm(output)).toContain("address:");
    expect(norm(output)).toContain("location:s.address.city");
    expect(norm(output)).toContain("zip:s.address.zip");
  });

  it("handles top-level renamePaths (no dots)", () => {
    const { output } = expandTransformInto(`
      interface Source { first_name: string; }
      interface Target { name: string; }
      const s: Source = { first_name: "John" };
      transformInto<Source, Target>(s, {
        renamePaths: { name: "first_name" }
      });
    `);
    expect(norm(output)).toContain("name:s.first_name");
  });
});

describe("combined features", () => {
  it("handles nested + collections + flat fields together", () => {
    const { output } = expandTransformInto(`
      interface ItemFrom { id: number; }
      interface ItemTo { itemId: number; }
      interface Source { name: string; items: ItemFrom[]; meta: { version: number; }; }
      interface Target { name: string; items: ItemTo[]; meta: { version: number; }; }
      const s: Source = { name: "test", items: [{ id: 1 }], meta: { version: 1 } };
      transformInto<Source, Target>(s, {
        nested: { meta: {} },
        collections: { items: { rename: { itemId: "id" } } }
      });
    `);
    expect(norm(output)).toContain("name:s.name");
    expect(output).toContain("s.items.map");
    expect(norm(output)).toContain("version:s.meta.version");
  });
});
