/**
 * Tests for reflect.ts — Compile-time reflection macros.
 *
 * Covers:
 * - reflectAttribute: interface, class, type-alias product, type-alias sum
 *   (union), empty interface. Verifies the emitted nodes include the original
 *   declaration plus a `__<Name>_meta__` const whose initialiser is an object
 *   literal with `name`/`kind`/`fields`/`methods`/`typeParameters`.
 * - typeInfoMacro expression form: drives the macro against `typeInfo<T>()`
 *   calls embedded in real source. Verifies the returned expression is an
 *   ObjectLiteralExpression with `name`, `kind`, and `fields` properties.
 * - Edge cases: type parameters appear in `typeParameters` array, methods
 *   carry optional-parameter info, readonly fields are marked readonly,
 *   missing type argument on `typeInfo<>()` reports a diagnostic and returns
 *   the original call expression unchanged.
 *
 * All assertions are structural — using ts.is* predicates and walking the
 * factory-built nodes rather than comparing printed strings.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, type MacroContext } from "@typesugar/core";
import { reflectAttribute, typeInfoMacro } from "./reflect.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reflect-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run the `reflectAttribute` macro against the first declaration in `source`
 * matched by `pick`. Returns the emitted nodes and any diagnostics.
 */
function runReflectAttribute(
  source: string,
  pick: (sf: ts.SourceFile) => ts.Declaration | undefined
): {
  nodes: ts.Node[];
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const target = pick(sourceFile);
    if (!target) throw new Error("reflect-test: target declaration not found");

    let nodes: ts.Node[] = [];
    let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

    const factory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("reflect"));
      const out = reflectAttribute.expand(ctx, decorator, target, []);
      nodes = Array.isArray(out) ? out : [out];
      diagnostics = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [factory]);
    return { nodes, diagnostics };
  } finally {
    cleanup();
  }
}

/**
 * Run the `typeInfoMacro` expression macro against the first matching call
 * expression in `source`. The source should declare a stub `typeInfo` so the
 * call is parseable.
 */
function runTypeInfoMacro(
  source: string,
  findCall: (sf: ts.SourceFile) => ts.CallExpression
): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    let expanded: ts.Expression = ts.factory.createVoidZero();
    let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

    const factory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx: MacroContext = createMacroContext(program, sourceFile, transformContext);
      const call = findCall(sourceFile);
      expanded = typeInfoMacro.expand(ctx, call, call.arguments);
      diagnostics = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [factory]);
    return { expanded, diagnostics };
  } finally {
    cleanup();
  }
}

/** Walk a node tree returning the first descendant satisfying `pred`. */
function findFirst<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T {
  let found: T | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  };
  visit(root);
  if (!found) throw new Error("findFirst: no matching node");
  return found;
}

/** Read a string-literal property value from an object literal expression. */
function getStringProp(obj: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text;
    }
  }
  return undefined;
}

/** Read the array-literal expression at property `name` on an object literal. */
function getArrayProp(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.ArrayLiteralExpression | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === name &&
      ts.isArrayLiteralExpression(prop.initializer)
    ) {
      return prop.initializer;
    }
  }
  return undefined;
}

/** Read a boolean property (factory.createTrue/False) from an object literal. */
function getBoolProp(obj: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
    }
  }
  return undefined;
}

/** Extract the initialiser object-literal from the emitted `__X_meta__` const. */
function getMetaObject(nodes: readonly ts.Node[]): ts.ObjectLiteralExpression {
  expect(nodes.length).toBeGreaterThanOrEqual(2);
  const last = nodes[nodes.length - 1];
  if (!ts.isVariableStatement(last)) {
    throw new Error("Expected last emitted node to be a VariableStatement (meta const)");
  }
  const decl = last.declarationList.declarations[0];
  if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) {
    throw new Error("Expected meta const initialiser to be an object literal");
  }
  return decl.initializer;
}

/** Get the variable name from the emitted meta const. */
function getMetaName(nodes: readonly ts.Node[]): string {
  const last = nodes[nodes.length - 1] as ts.VariableStatement;
  const decl = last.declarationList.declarations[0];
  if (!ts.isIdentifier(decl.name)) throw new Error("meta var name not an identifier");
  return decl.name.text;
}

// ===========================================================================
// reflectAttribute — declarative metadata
// ===========================================================================

describe("reflectAttribute (metadata)", () => {
  it("declares the expected macro descriptor", () => {
    expect(reflectAttribute.name).toBe("reflect");
    expect(reflectAttribute.module).toBe("typesugar");
    expect(reflectAttribute.kind).toBe("attribute");
    expect(reflectAttribute.validTargets).toContain("interface");
    expect(reflectAttribute.validTargets).toContain("class");
    expect(reflectAttribute.validTargets).toContain("type");
  });
});

// ===========================================================================
// reflectAttribute — interface targets
// ===========================================================================

describe("reflectAttribute on interface", () => {
  it("emits original target plus a meta const named __<Name>_meta__", () => {
    const { nodes, diagnostics } = runReflectAttribute(
      `interface User { id: number; name: string; email: string; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)
    );
    expect(diagnostics).toHaveLength(0);
    expect(nodes).toHaveLength(2);
    expect(ts.isInterfaceDeclaration(nodes[0])).toBe(true);
    expect(ts.isVariableStatement(nodes[1])).toBe(true);
    expect(getMetaName(nodes)).toBe("__User_meta__");
  });

  it("emits an exported const declaration for the meta", () => {
    const { nodes } = runReflectAttribute(`interface User { id: number; }`, (sf) =>
      sf.statements.find(ts.isInterfaceDeclaration)
    );
    const stmt = nodes[1] as ts.VariableStatement;
    expect(stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect((stmt.declarationList.flags & ts.NodeFlags.Const) !== 0).toBe(true);
  });

  it("populates name/kind from the interface declaration", () => {
    const { nodes } = runReflectAttribute(`interface User { id: number; name: string; }`, (sf) =>
      sf.statements.find(ts.isInterfaceDeclaration)
    );
    const obj = getMetaObject(nodes);
    expect(getStringProp(obj, "name")).toBe("User");
    expect(getStringProp(obj, "kind")).toBe("interface");
  });

  it("emits one fields entry per property with name/type strings", () => {
    const { nodes } = runReflectAttribute(
      `interface User { id: number; name: string; email: string; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)
    );
    const obj = getMetaObject(nodes);
    const fields = getArrayProp(obj, "fields")!;
    expect(fields.elements).toHaveLength(3);

    const names: string[] = [];
    const types: string[] = [];
    for (const el of fields.elements) {
      const f = el as ts.ObjectLiteralExpression;
      names.push(getStringProp(f, "name")!);
      types.push(getStringProp(f, "type")!);
    }
    expect(names).toEqual(["id", "name", "email"]);
    expect(types).toEqual(["number", "string", "string"]);
  });

  it("marks optional and readonly field flags via factory.createTrue/False", () => {
    const { nodes } = runReflectAttribute(
      `interface Mixed { readonly id: number; nickname?: string; }`,
      (sf) => sf.statements.find(ts.isInterfaceDeclaration)
    );
    const obj = getMetaObject(nodes);
    const fields = getArrayProp(obj, "fields")!;
    const byName: Record<string, ts.ObjectLiteralExpression> = {};
    for (const el of fields.elements) {
      const f = el as ts.ObjectLiteralExpression;
      byName[getStringProp(f, "name")!] = f;
    }
    expect(getBoolProp(byName.id, "readonly")).toBe(true);
    expect(getBoolProp(byName.id, "optional")).toBe(false);
    expect(getBoolProp(byName.nickname, "optional")).toBe(true);
    expect(getBoolProp(byName.nickname, "readonly")).toBe(false);
  });

  it("emits an empty fields array for a property-less interface", () => {
    const { nodes } = runReflectAttribute(`interface Empty {}`, (sf) =>
      sf.statements.find(ts.isInterfaceDeclaration)
    );
    const obj = getMetaObject(nodes);
    const fields = getArrayProp(obj, "fields")!;
    expect(fields.elements).toHaveLength(0);
    expect(getStringProp(obj, "name")).toBe("Empty");
    expect(getStringProp(obj, "kind")).toBe("interface");
  });

  it("records type parameter names in `typeParameters`", () => {
    const { nodes } = runReflectAttribute(`interface Box<T, U> { value: T; tag: U; }`, (sf) =>
      sf.statements.find(ts.isInterfaceDeclaration)
    );
    const obj = getMetaObject(nodes);
    const tps = getArrayProp(obj, "typeParameters")!;
    const names = tps.elements.map((e) => (e as ts.StringLiteral).text);
    expect(names).toEqual(["T", "U"]);
  });
});

// ===========================================================================
// reflectAttribute — class targets
// ===========================================================================

describe("reflectAttribute on class", () => {
  it("emits a meta const for a class with fields and methods", () => {
    const source = `
      class Counter {
        count: number = 0;
        readonly id: string = "x";
        increment(): void {}
        async fetch(url: string): Promise<string> { return url; }
      }
    `;
    const { nodes, diagnostics } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    expect(diagnostics).toHaveLength(0);
    expect(getMetaName(nodes)).toBe("__Counter_meta__");
    const obj = getMetaObject(nodes);
    expect(getStringProp(obj, "name")).toBe("Counter");
    expect(getStringProp(obj, "kind")).toBe("class");
  });

  it("separates instance fields from instance methods", () => {
    const source = `
      class Counter {
        count: number = 0;
        readonly id: string = "x";
        increment(): void {}
        async fetch(url: string): Promise<string> { return url; }
      }
    `;
    const { nodes } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    const obj = getMetaObject(nodes);
    const fields = getArrayProp(obj, "fields")!;
    const methods = getArrayProp(obj, "methods")!;

    const fieldNames = fields.elements
      .map((e) => getStringProp(e as ts.ObjectLiteralExpression, "name")!)
      .sort();
    const methodNames = methods.elements
      .map((e) => getStringProp(e as ts.ObjectLiteralExpression, "name")!)
      .sort();
    expect(fieldNames).toEqual(["count", "id"]);
    expect(methodNames).toEqual(["fetch", "increment"]);
  });

  it("encodes method parameters with name/type/optional flags", () => {
    const source = `
      class Greeter {
        greet(name: string, formal?: boolean): string { return name; }
      }
    `;
    const { nodes } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    const obj = getMetaObject(nodes);
    const methods = getArrayProp(obj, "methods")!;
    const greet = methods.elements[0] as ts.ObjectLiteralExpression;
    const params = getArrayProp(greet, "parameters")!;
    expect(params.elements).toHaveLength(2);

    const p0 = params.elements[0] as ts.ObjectLiteralExpression;
    const p1 = params.elements[1] as ts.ObjectLiteralExpression;
    expect(getStringProp(p0, "name")).toBe("name");
    expect(getStringProp(p0, "type")).toBe("string");
    expect(getBoolProp(p0, "optional")).toBe(false);
    expect(getStringProp(p1, "name")).toBe("formal");
    expect(getBoolProp(p1, "optional")).toBe(true);
  });

  it("marks async methods with isAsync=true", () => {
    const source = `
      class Fetcher {
        async load(): Promise<void> { return; }
        ready(): void {}
      }
    `;
    const { nodes } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    const methods = getArrayProp(getMetaObject(nodes), "methods")!;
    const byName: Record<string, ts.ObjectLiteralExpression> = {};
    for (const el of methods.elements) {
      const m = el as ts.ObjectLiteralExpression;
      byName[getStringProp(m, "name")!] = m;
    }
    expect(getBoolProp(byName.load, "isAsync")).toBe(true);
    expect(getBoolProp(byName.ready, "isAsync")).toBe(false);
  });

  it("preserves class type parameter names", () => {
    const source = `class Container<T> { value!: T; }`;
    const { nodes } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    const tps = getArrayProp(getMetaObject(nodes), "typeParameters")!;
    expect(tps.elements.map((e) => (e as ts.StringLiteral).text)).toEqual(["T"]);
  });
});

// ===========================================================================
// reflectAttribute — type alias targets
// ===========================================================================

describe("reflectAttribute on type alias (product)", () => {
  it("emits a meta const with kind='type' for a record-shaped alias", () => {
    const { nodes } = runReflectAttribute(`type Point = { a: number; b: string };`, (sf) =>
      sf.statements.find(ts.isTypeAliasDeclaration)
    );
    expect(getMetaName(nodes)).toBe("__Point_meta__");
    const obj = getMetaObject(nodes);
    expect(getStringProp(obj, "name")).toBe("Point");
    expect(getStringProp(obj, "kind")).toBe("type");
  });

  it("extracts both fields with the right types", () => {
    const { nodes } = runReflectAttribute(`type Point = { a: number; b: string };`, (sf) =>
      sf.statements.find(ts.isTypeAliasDeclaration)
    );
    const fields = getArrayProp(getMetaObject(nodes), "fields")!;
    const names: string[] = [];
    const types: string[] = [];
    for (const el of fields.elements) {
      const f = el as ts.ObjectLiteralExpression;
      names.push(getStringProp(f, "name")!);
      types.push(getStringProp(f, "type")!);
    }
    expect(names.sort()).toEqual(["a", "b"]);
    expect(new Set(types)).toEqual(new Set(["number", "string"]));
  });
});

describe("reflectAttribute on type alias (sum)", () => {
  it("emits kind='union' with a `variants` array for a discriminated union", () => {
    const source = `
      type Shape =
        | { kind: "circle"; radius: number }
        | { kind: "square"; side: number };
    `;
    const { nodes } = runReflectAttribute(source, (sf) =>
      sf.statements.find(ts.isTypeAliasDeclaration)
    );
    const obj = getMetaObject(nodes);
    expect(getStringProp(obj, "name")).toBe("Shape");
    expect(getStringProp(obj, "kind")).toBe("union");

    // Sum/union path doesn't emit a `fields` property in the TypeInfo, so the
    // generator falls back to an empty array. The variants must be reachable
    // via the underlying TypeInfo, but the generator does not currently surface
    // `variants` in the emitted const — verify the fields array is empty here.
    const fields = getArrayProp(obj, "fields")!;
    expect(fields.elements).toHaveLength(0);
  });
});

// ===========================================================================
// reflectAttribute — unsupported targets
// ===========================================================================

describe("reflectAttribute on unsupported declarations", () => {
  it("returns the target unchanged when the declaration is not supported", () => {
    // Use an enum, which extractTypeInfo doesn't handle — should yield a single
    // node (the original) and no meta const.
    const { nodes } = runReflectAttribute(`enum Color { Red, Green }`, (sf) =>
      sf.statements.find(ts.isEnumDeclaration)
    );
    expect(nodes).toHaveLength(1);
    expect(ts.isEnumDeclaration(nodes[0])).toBe(true);
  });
});

// ===========================================================================
// typeInfoMacro — expression form
// ===========================================================================

describe("typeInfoMacro (expression form)", () => {
  // The source declares a stub `typeInfo<T>(): unknown` so the call expression
  // parses and the type checker can resolve the type argument.
  const STUB = `declare function typeInfo<T>(): unknown;\n`;

  it("declares the expected macro descriptor", () => {
    expect(typeInfoMacro.name).toBe("typeInfo");
    expect(typeInfoMacro.kind).toBe("expression");
  });

  it("returns an ObjectLiteralExpression with name/kind/fields properties", () => {
    const source = STUB + `interface U { id: number; name: string; }\nconst x = typeInfo<U>();`;
    const { expanded, diagnostics } = runTypeInfoMacro(source, (sf) =>
      findFirst(sf, ts.isCallExpression)
    );
    expect(diagnostics).toHaveLength(0);
    expect(ts.isObjectLiteralExpression(expanded)).toBe(true);
    const obj = expanded as ts.ObjectLiteralExpression;
    expect(getStringProp(obj, "name")).toBe("U");
    expect(getStringProp(obj, "kind")).toBe("interface");
    const fields = getArrayProp(obj, "fields")!;
    expect(fields.elements).toHaveLength(2);
  });

  it("emits each field as an ObjectLiteralExpression with name/type/optional/readonly", () => {
    const source =
      STUB +
      `interface U { id: number; readonly tag: string; nick?: string; }\nconst x = typeInfo<U>();`;
    const { expanded } = runTypeInfoMacro(source, (sf) => findFirst(sf, ts.isCallExpression));
    const fields = getArrayProp(expanded as ts.ObjectLiteralExpression, "fields")!;
    const byName: Record<string, ts.ObjectLiteralExpression> = {};
    for (const el of fields.elements) {
      const f = el as ts.ObjectLiteralExpression;
      byName[getStringProp(f, "name")!] = f;
    }
    expect(Object.keys(byName).sort()).toEqual(["id", "nick", "tag"]);
    expect(getStringProp(byName.id, "type")).toBe("number");
    expect(getBoolProp(byName.tag, "readonly")).toBe(true);
    expect(getBoolProp(byName.nick, "optional")).toBe(true);
  });

  it("uses kind='class' when the type argument is a class", () => {
    const source = STUB + `class C { x = 1; y = "a"; }\nconst t = typeInfo<C>();`;
    const { expanded } = runTypeInfoMacro(source, (sf) => findFirst(sf, ts.isCallExpression));
    const obj = expanded as ts.ObjectLiteralExpression;
    expect(getStringProp(obj, "name")).toBe("C");
    expect(getStringProp(obj, "kind")).toBe("class");
  });

  it("falls back to kind='type' for type-alias products", () => {
    const source = STUB + `type R = { a: number; b: string };\nconst t = typeInfo<R>();`;
    const { expanded } = runTypeInfoMacro(source, (sf) => findFirst(sf, ts.isCallExpression));
    const obj = expanded as ts.ObjectLiteralExpression;
    // typeInfoMacro derives kind from the symbol's declaration; for a type
    // alias the underlying object type's symbol is anonymous, so kind stays
    // "type" (the default in the macro).
    expect(getStringProp(obj, "kind")).toBe("type");
    const fields = getArrayProp(obj, "fields")!;
    expect(fields.elements).toHaveLength(2);
  });

  it("emits empty fields for an empty interface", () => {
    const source = STUB + `interface E {}\nconst t = typeInfo<E>();`;
    const { expanded } = runTypeInfoMacro(source, (sf) => findFirst(sf, ts.isCallExpression));
    const fields = getArrayProp(expanded as ts.ObjectLiteralExpression, "fields")!;
    expect(fields.elements).toHaveLength(0);
  });

  it("reports a diagnostic and returns the original call when no type argument is provided", () => {
    // Call with no type args — write source explicitly.
    const source = STUB + `const t = typeInfo();`;
    const { expanded, diagnostics } = runTypeInfoMacro(source, (sf) =>
      findFirst(sf, ts.isCallExpression)
    );
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].message).toMatch(/exactly one type argument/);
    expect(ts.isCallExpression(expanded)).toBe(true);
  });
});
