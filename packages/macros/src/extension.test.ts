/**
 * Tests for extension.ts — Standalone extension methods for concrete types.
 *
 * Covers:
 * - createRegistrationCall: AST shape for zero/one method, with/without qualifier.
 * - registerExtensionsMacro / registerExtensionMacro: metadata, success paths,
 *   error paths (wrong arity, non-string-literal type, non-identifier fn).
 * - extensionAttribute: function decls (named, unnamed, no params, exported vs
 *   internal), variable decls (non-function), namespace decls (registration of
 *   methods, runtime emission for exported namespaces), invalid targets.
 * - getBaseTypeName is exercised indirectly through extensionAttribute on
 *   declarations whose first parameter uses TypeReference (simple, generic,
 *   qualified) and ArrayType nodes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, standaloneExtensionRegistry } from "@typesugar/core";
import {
  extensionAttribute,
  registerExtensionsMacro,
  registerExtensionMacro,
  createRegistrationCall,
} from "./extension.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearRegistry(): void {
  standaloneExtensionRegistry.length = 0;
}

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "extension-test-"));
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
 * Run `extensionAttribute.expand` against the first matching target in the
 * source file. The selector picks the target node (function/namespace/var).
 */
function runExtensionAttribute(
  source: string,
  pick: (sf: ts.SourceFile) => ts.Declaration | undefined
): {
  nodes: ts.Node[];
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string[];
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const target = pick(sourceFile);
    if (!target) {
      throw new Error("Test target not found in source");
    }

    let collected: ts.Node[] = [];
    let diags: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const printed: string[] = [];

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      const dummyDecorator = ts.factory.createDecorator(ts.factory.createIdentifier("extension"));
      const result = extensionAttribute.expand(ctx, dummyDecorator, target, []);
      collected = Array.isArray(result) ? result : [result];
      for (const n of collected) {
        printed.push(printer.printNode(ts.EmitHint.Unspecified, n, sourceFile));
      }
      diags = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);

    return { nodes: collected, diagnostics: diags, printed };
  } finally {
    cleanup();
  }
}

/**
 * Run an expression macro (registerExtensions / registerExtension) by building
 * a call expression from the supplied argument factories and invoking expand.
 *
 * Use a real ts.Program so the type checker is available (registerExtensions
 * relies on getTypeAtLocation for the namespace object). The call expression
 * must come from the parsed source so symbols resolve.
 */
function runExpressionMacro(
  macro: typeof registerExtensionsMacro | typeof registerExtensionMacro,
  source: string,
  findCall: (sf: ts.SourceFile) => ts.CallExpression
): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const callExpr = findCall(sourceFile);
    let expanded: ts.Expression = ts.factory.createVoidZero();
    let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      expanded = macro.expand(ctx, callExpr, callExpr.arguments);
      diagnostics = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);
    return { expanded, diagnostics };
  } finally {
    cleanup();
  }
}

/** Walk the file finding the first matching descendant. */
function findFirst<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T | undefined {
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
  return found;
}

// ===========================================================================
// createRegistrationCall — AST shape assertions
// ===========================================================================

describe("createRegistrationCall", () => {
  it("returns an ExpressionStatement wrapping an optional call chain", () => {
    const stmt = createRegistrationCall(ts.factory, "head", "Array", undefined);
    expect(ts.isExpressionStatement(stmt)).toBe(true);
    const inner = (stmt as ts.ExpressionStatement).expression;
    expect(ts.isCallChain(inner)).toBe(true);
  });

  it("targets globalThis.__typesugar_registerExtension as the callee", () => {
    const stmt = createRegistrationCall(ts.factory, "head", "Array", undefined);
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression;
    expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    const access = call.expression as ts.PropertyAccessExpression;
    expect(ts.isIdentifier(access.expression)).toBe(true);
    expect((access.expression as ts.Identifier).text).toBe("globalThis");
    expect(access.name.text).toBe("__typesugar_registerExtension");
  });

  it("uses an optional call (?.()) on the global hook", () => {
    const stmt = createRegistrationCall(ts.factory, "head", "Array", undefined);
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression;
    // CallChain has a questionDotToken set when emitted as `hook?.(...)`
    expect(call.questionDotToken).toBeDefined();
    expect(call.questionDotToken!.kind).toBe(ts.SyntaxKind.QuestionDotToken);
  });

  it("passes a single object literal argument with methodName and forType when qualifier is undefined", () => {
    const stmt = createRegistrationCall(ts.factory, "isEven", "number", undefined);
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression;
    expect(call.arguments.length).toBe(1);
    const arg = call.arguments[0];
    expect(ts.isObjectLiteralExpression(arg)).toBe(true);
    const obj = arg as ts.ObjectLiteralExpression;
    expect(obj.properties.length).toBe(2);
    const props = obj.properties.map((p) => {
      const pa = p as ts.PropertyAssignment;
      return {
        key: (pa.name as ts.Identifier | ts.StringLiteral).text,
        value: (pa.initializer as ts.StringLiteral).text,
      };
    });
    expect(props).toEqual([
      { key: "methodName", value: "isEven" },
      { key: "forType", value: "number" },
    ]);
  });

  it("includes a qualifier property when supplied", () => {
    const stmt = createRegistrationCall(ts.factory, "head", "Array", "ArrayExt");
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression;
    const obj = call.arguments[0] as ts.ObjectLiteralExpression;
    expect(obj.properties.length).toBe(3);
    const qualifierProp = obj.properties[2] as ts.PropertyAssignment;
    expect((qualifierProp.name as ts.Identifier).text).toBe("qualifier");
    expect((qualifierProp.initializer as ts.StringLiteral).text).toBe("ArrayExt");
  });

  it("omits the qualifier property when explicitly undefined", () => {
    const stmt = createRegistrationCall(ts.factory, "m", "string", undefined);
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression;
    const obj = call.arguments[0] as ts.ObjectLiteralExpression;
    const keys = obj.properties.map(
      (p) => ((p as ts.PropertyAssignment).name as ts.Identifier).text
    );
    expect(keys).not.toContain("qualifier");
  });
});

// ===========================================================================
// Macro metadata
// ===========================================================================

describe("macro metadata", () => {
  it("extensionAttribute is registered as an attribute macro named 'extension'", () => {
    expect(extensionAttribute.kind).toBe("attribute");
    expect(extensionAttribute.name).toBe("extension");
    expect(extensionAttribute.module).toBe("typesugar");
    expect(extensionAttribute.cacheable).toBe(true);
    expect(extensionAttribute.validTargets).toEqual(["function", "property"]);
  });

  it("registerExtensionsMacro is an expression macro with description", () => {
    expect(registerExtensionsMacro.kind).toBe("expression");
    expect(registerExtensionsMacro.name).toBe("registerExtensions");
    expect(registerExtensionsMacro.description).toContain("namespace");
  });

  it("registerExtensionMacro is an expression macro with description", () => {
    expect(registerExtensionMacro.kind).toBe("expression");
    expect(registerExtensionMacro.name).toBe("registerExtension");
    expect(registerExtensionMacro.description).toContain("single function");
  });
});

// ===========================================================================
// registerExtensionsMacro
// ===========================================================================

describe("registerExtensionsMacro", () => {
  beforeEach(clearRegistry);

  it("registers all callable properties of a namespace object", () => {
    const source = `
      const NumberOps = {
        clamp(n: number, lo: number, hi: number): number { return n; },
        isEven(n: number): boolean { return n % 2 === 0; },
        DESCRIPTION: "math ops",
      };
      registerExtensions("number", NumberOps);
    `;
    const { expanded, diagnostics } = runExpressionMacro(
      registerExtensionsMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtensions"
        )!
    );

    expect(diagnostics).toEqual([]);
    expect(expanded.kind).toBe(ts.SyntaxKind.VoidExpression);

    const entries = standaloneExtensionRegistry.filter((e) => e.forType === "number");
    const methods = entries.map((e) => e.methodName).sort();
    expect(methods).toEqual(["clamp", "isEven"]);
    expect(entries.every((e) => e.qualifier === "NumberOps")).toBe(true);
  });

  it("emits a diagnostic and returns void 0 when arity is below 2", () => {
    const source = `
      const NumberOps = { foo(n: number) { return n; } };
      registerExtensions("number");
    `;
    const { expanded, diagnostics } = runExpressionMacro(
      registerExtensionsMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtensions"
        )!
    );

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(expanded.kind).toBe(ts.SyntaxKind.VoidExpression);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });

  it("emits a diagnostic when the type name is not a string literal", () => {
    const source = `
      const NumberOps = { foo(n: number) { return n; } };
      const t = "number";
      registerExtensions(t, NumberOps);
    `;
    const { diagnostics } = runExpressionMacro(
      registerExtensionsMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtensions"
        )!
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(standaloneExtensionRegistry.length).toBe(0);
  });
});

// ===========================================================================
// registerExtensionMacro
// ===========================================================================

describe("registerExtensionMacro", () => {
  beforeEach(clearRegistry);

  it("registers a single function with no qualifier", () => {
    const source = `
      function capitalize(s: string): string { return s; }
      registerExtension("string", capitalize);
    `;
    const { expanded, diagnostics } = runExpressionMacro(
      registerExtensionMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtension"
        )!
    );

    expect(diagnostics).toEqual([]);
    expect(expanded.kind).toBe(ts.SyntaxKind.VoidExpression);
    expect(standaloneExtensionRegistry).toEqual([
      { methodName: "capitalize", forType: "string", qualifier: undefined },
    ]);
  });

  it("diagnoses arity below 2", () => {
    const source = `
      function capitalize(s: string) { return s; }
      registerExtension("string");
    `;
    const { diagnostics } = runExpressionMacro(
      registerExtensionMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtension"
        )!
    );
    expect(diagnostics.length).toBe(1);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });

  it("diagnoses non-string-literal type argument", () => {
    const source = `
      function capitalize(s: string) { return s; }
      const t = "string";
      registerExtension(t, capitalize);
    `;
    const { diagnostics } = runExpressionMacro(
      registerExtensionMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtension"
        )!
    );
    expect(diagnostics.length).toBe(1);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });

  it("diagnoses when the second argument is not an identifier", () => {
    const source = `
      registerExtension("string", function inline(s: string) { return s; });
    `;
    const { diagnostics } = runExpressionMacro(
      registerExtensionMacro,
      source,
      (sf) =>
        findFirst(
          sf,
          (n): n is ts.CallExpression =>
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "registerExtension"
        )!
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(standaloneExtensionRegistry.length).toBe(0);
  });
});

// ===========================================================================
// extensionAttribute on function declarations
// ===========================================================================

describe("extensionAttribute on function declarations", () => {
  beforeEach(clearRegistry);

  it("registers an exported function and emits a runtime registration call", () => {
    const source = `export function head<A>(arr: A[]): A | undefined { return arr[0]; }`;
    const { nodes, diagnostics, printed } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(2);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
    expect(ts.isExpressionStatement(nodes[1])).toBe(true);
    // The emitted statement must invoke the global registration hook.
    expect(printed[1]).toContain("globalThis.__typesugar_registerExtension");
    expect(printed[1]).toContain('"head"');
    expect(printed[1]).toContain('"Array"');

    expect(standaloneExtensionRegistry).toEqual([
      { methodName: "head", forType: "Array", qualifier: undefined },
    ]);
  });

  it("registers a non-exported function without emitting a registration call", () => {
    const source = `function isEven(n: number): boolean { return n % 2 === 0; }`;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
    expect(standaloneExtensionRegistry).toEqual([
      { methodName: "isEven", forType: "number", qualifier: undefined },
    ]);
  });

  it("derives forType from a simple TypeReference (Point)", () => {
    const source = `
      interface Point { x: number; y: number; }
      export function translate(p: Point, dx: number, dy: number): Point { return p; }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(
        (s): s is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(s) && s.name?.text === "translate"
      )
    );
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "translate",
      forType: "Point",
      qualifier: undefined,
    });
  });

  it("derives forType='Array' from ReadonlyArray<A>", () => {
    const source = `
      export function tail<A>(arr: ReadonlyArray<A>): readonly A[] { return arr.slice(1); }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "tail",
      forType: "Array",
      qualifier: undefined,
    });
  });

  it("derives forType='Array' from A[] (ArrayTypeNode)", () => {
    const source = `
      export function first<A>(arr: A[]): A | undefined { return arr[0]; }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "first",
      forType: "Array",
      qualifier: undefined,
    });
  });

  it("derives forType from a generic type reference, dropping type args (Set<A> -> Set)", () => {
    const source = `
      export function size<A>(s: Set<A>): number { return s.size; }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "size",
      forType: "Set",
      qualifier: undefined,
    });
  });

  it("uses primitive type names verbatim (string)", () => {
    const source = `
      export function shout(s: string): string { return s.toUpperCase(); }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "shout",
      forType: "string",
      qualifier: undefined,
    });
  });

  it("uses qualified name text for QualifiedName type references", () => {
    const source = `
      namespace Foo { export interface Bar { x: number } }
      export function probe(b: Foo.Bar): number { return b.x; }
    `;
    const { diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "probe"
      )
    );
    expect(diagnostics).toEqual([]);
    const entry = standaloneExtensionRegistry.find((e) => e.methodName === "probe");
    expect(entry).toBeDefined();
    expect(entry!.forType).toBe("Foo.Bar");
  });

  it("emits TS9206 when the function declaration has no name", () => {
    // An anonymous function declaration can only appear via `export default`.
    const source = `export default function (n: number) { return n; }`;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });

  it("emits TS9206 when the function has zero parameters", () => {
    const source = `export function noParams() { return 1; }`;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(nodes.length).toBe(1);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });
});

// ===========================================================================
// extensionAttribute on variable declarations
// ===========================================================================

describe("extensionAttribute on variable declarations", () => {
  beforeEach(clearRegistry);

  it("registers an arrow-function variable using checker-inferred receiver type", () => {
    const source = `const negate = (n: number): number => -n;`;
    const { diagnostics } = runExtensionAttribute(source, (sf) => {
      const v = sf.statements.find(ts.isVariableStatement)!;
      return v.declarationList.declarations[0];
    });
    expect(diagnostics).toEqual([]);
    expect(standaloneExtensionRegistry).toContainEqual({
      methodName: "negate",
      forType: "number",
      qualifier: undefined,
    });
  });

  it("reports an error when the variable is not a function", () => {
    const source = `const notAFn = 42;`;
    const { diagnostics } = runExtensionAttribute(source, (sf) => {
      const v = sf.statements.find(ts.isVariableStatement)!;
      return v.declarationList.declarations[0];
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/must be a function/);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });

  it("reports an error when the function variable has zero parameters", () => {
    const source = `const zeroArgs = (): number => 1;`;
    const { diagnostics } = runExtensionAttribute(source, (sf) => {
      const v = sf.statements.find(ts.isVariableStatement)!;
      return v.declarationList.declarations[0];
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/at least one parameter/);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });
});

// ===========================================================================
// extensionAttribute on namespace declarations
// ===========================================================================

describe("extensionAttribute on namespace declarations", () => {
  beforeEach(clearRegistry);

  it("registers all exported functions and emits registration calls when namespace is exported", () => {
    const source = `
      export namespace NumberExt {
        export function clamp(n: number, lo: number, hi: number): number { return n; }
        export function isEven(n: number): boolean { return n % 2 === 0; }
      }
    `;
    const { nodes, diagnostics, printed } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isModuleDeclaration)
    );
    expect(diagnostics).toEqual([]);
    // 1 namespace + 2 registration ExpressionStatements.
    expect(nodes.length).toBe(3);
    expect(ts.isModuleDeclaration(nodes[0])).toBe(true);
    expect(ts.isExpressionStatement(nodes[1])).toBe(true);
    expect(ts.isExpressionStatement(nodes[2])).toBe(true);
    // Each emitted statement carries the namespace qualifier.
    expect(printed[1]).toContain('"NumberExt"');
    expect(printed[2]).toContain('"NumberExt"');

    const entries = standaloneExtensionRegistry
      .filter((e) => e.qualifier === "NumberExt")
      .map((e) => e.methodName)
      .sort();
    expect(entries).toEqual(["clamp", "isEven"]);
  });

  it("registers functions but emits no registration calls for a non-exported namespace", () => {
    const source = `
      namespace InternalExt {
        export function ping(n: number): number { return n; }
      }
    `;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isModuleDeclaration)
    );
    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(ts.isModuleDeclaration(nodes[0])).toBe(true);
    expect(standaloneExtensionRegistry).toEqual([
      { methodName: "ping", forType: "number", qualifier: "InternalExt" },
    ]);
  });

  it("skips non-exported and zero-arg functions inside the namespace", () => {
    const source = `
      export namespace MixedExt {
        export function good(n: number): number { return n; }
        function privateOne(n: number): number { return n; }
        export function noArgs(): number { return 1; }
      }
    `;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isModuleDeclaration)
    );
    expect(diagnostics).toEqual([]);
    // 1 namespace + exactly 1 registration call ("good").
    expect(nodes.length).toBe(2);

    const entries = standaloneExtensionRegistry.filter((e) => e.qualifier === "MixedExt");
    expect(entries.map((e) => e.methodName).sort()).toEqual(["good"]);
  });
});

// ===========================================================================
// extensionAttribute on invalid targets
// ===========================================================================

describe("extensionAttribute on invalid targets", () => {
  beforeEach(clearRegistry);

  it("reports an error for an unsupported target (class declaration)", () => {
    const source = `export class Foo { x = 1; }`;
    const { nodes, diagnostics } = runExtensionAttribute(source, (sf) =>
      sf.statements.find(ts.isClassDeclaration)
    );
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(
      /can only be applied to functions, arrow function variables, or namespaces/
    );
    expect(nodes.length).toBe(1);
    expect(ts.isClassDeclaration(nodes[0])).toBe(true);
    expect(standaloneExtensionRegistry.length).toBe(0);
  });
});
