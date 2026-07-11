/**
 * Tests for specialization.ts — auto-specialization pass.
 *
 * Covers:
 * - Instance name extraction (`getInstanceName`)
 * - @impl annotation detection (`hasImplAnnotation`)
 * - Brand extraction (`extractBrandFromImpl`)
 * - Function body resolution (`resolveAutoSpecFunctionBody`)
 * - Dictionary call rewriting (`rewriteDictCallsForAutoSpec`)
 * - Hoisted specialization construction (`inlineAutoSpecializeForHoisting`)
 * - End-to-end auto-specialization (`tryAutoSpecialize`)
 *     - cache hits reuse cached hoisted identifier
 *     - cache misses generate new hoisted decls
 *     - cache.clear() invalidates entries
 *     - skip paths (no instance args, opted-out scope, @no-specialize comment)
 *     - [TS9602] diagnostic emission when body cannot be resolved
 *     - boundary: zero-param function returns undefined
 * - Return-type-driven specialization (`tryReturnTypeDrivenSpecialize`)
 * - Derived instance inlining (`tryInlineDerivedInstanceCall`)
 * - Post-pass DCE for derived instances (`eliminateDeadDerivedInstances`)
 */

import * as ts from "typescript";
import * as nodePath from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import {
  registerInstanceMethodsFromAST,
  SpecializationCache,
  type DictMethod,
} from "@typesugar/macros";

/**
 * Helper: register an instance with AST-based method nodes (the public API).
 * Builds a synthetic ArrowFunction for each method so the registry has the
 * shape `inlineMethod` expects.
 */
function registerTestInstance(
  dictName: string,
  brand: string,
  specs: Record<string, { params: string[]; body: ts.Expression }>,
  program?: ts.Program
): void {
  const methods = new Map<string, DictMethod>();
  for (const [name, info] of Object.entries(specs)) {
    const arrow = ts.factory.createArrowFunction(
      undefined,
      undefined,
      info.params.map((p) =>
        ts.factory.createParameterDeclaration(undefined, undefined, ts.factory.createIdentifier(p))
      ),
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      info.body
    );
    methods.set(name, { node: arrow, params: info.params });
  }
  registerInstanceMethodsFromAST(dictName, brand, methods, program);
}

import {
  getInstanceName,
  hasImplAnnotation,
  extractBrandFromImpl,
  tryExtractInstanceFromSource,
  resolveAutoSpecFunctionBody,
  rewriteDictCallsForAutoSpec,
  inlineAutoSpecializeForHoisting,
  tryAutoSpecialize,
  tryReturnTypeDrivenSpecialize,
  tryInlineDerivedInstanceCall,
  getTypeName,
  getContextualTypeForCall,
  eliminateDeadDerivedInstances,
} from "../src/specialization.js";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const sharedOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
};

const sharedTransformContext: ts.TransformationContext = {
  factory: ts.factory,
  getCompilerOptions: () => sharedOptions,
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
};

/**
 * Build a real ts.Program from in-memory source text.
 * Returns a program whose TypeChecker can resolve symbols in the test source.
 */
function createProgramFromSource(
  source: string,
  fileName = "test.ts"
): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
} {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  const host = ts.createCompilerHost(sharedOptions);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === fileName) return sourceFile;
    return origGetSourceFile(name, languageVersion, onError, shouldCreate);
  };

  const program = ts.createProgram([fileName], sharedOptions, host);
  return { program, sourceFile: program.getSourceFile(fileName)! };
}

function makeCtx(source = "const x = 1;"): MacroContextImpl {
  const { program, sourceFile } = createProgramFromSource(source);
  return createMacroContext(program, sourceFile, sharedTransformContext);
}

/**
 * Build a real ts.Program from MULTIPLE in-memory files, with cross-file
 * import resolution (PEP-053 Wave 2 cross-module extraction tests).
 * Keys are file names like "main.ts" / "lib.ts"; relative imports ("./lib")
 * resolve between them.
 */
function createMultiFileProgram(
  files: Record<string, string>,
  rootName = "main.ts"
): { program: ts.Program; sourceFile: ts.SourceFile } {
  // Module resolution works with absolute paths — key everything by
  // path.resolve(name) so `./lib` from `main.ts` finds `lib.ts`.
  const sourceFiles = new Map<string, ts.SourceFile>();
  const texts = new Map<string, string>();
  for (const [name, text] of Object.entries(files)) {
    const resolved = nodePath.resolve(name);
    texts.set(resolved, text);
    sourceFiles.set(
      resolved,
      ts.createSourceFile(resolved, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    );
  }

  const host = ts.createCompilerHost(sharedOptions);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    return (
      sourceFiles.get(nodePath.resolve(name)) ??
      origGetSourceFile(name, languageVersion, onError, shouldCreate)
    );
  };
  const origFileExists = host.fileExists.bind(host);
  host.fileExists = (f) => sourceFiles.has(nodePath.resolve(f)) || origFileExists(f);
  const origReadFile = host.readFile.bind(host);
  host.readFile = (f) => texts.get(nodePath.resolve(f)) ?? origReadFile(f);

  const program = ts.createProgram(Array.from(sourceFiles.keys()), sharedOptions, host);
  return { program, sourceFile: program.getSourceFile(nodePath.resolve(rootName))! };
}

function makeMultiFileCtx(files: Record<string, string>, rootName = "main.ts"): MacroContextImpl {
  const { program, sourceFile } = createMultiFileProgram(files, rootName);
  return createMacroContext(program, sourceFile, sharedTransformContext);
}

function findFirstCall(sf: ts.SourceFile): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isCallExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function findAllCalls(sf: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function printNode(node: ts.Node, sf?: ts.SourceFile): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const target =
    sf ?? ts.createSourceFile("__print__.ts", "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // emitHint Unspecified can elide details on nodes pulled from a different
  // source file; use the source file the node lives in if available.
  const owning = node.getSourceFile?.();
  return printer.printNode(ts.EmitHint.Unspecified, node, owning ?? target);
}

beforeAll(async () => {
  // Ensure built-in algebras (Option/Either/Promise/Unsafe) are registered.
  await import("@typesugar/macros");
});

// ===========================================================================
// getInstanceName
// ===========================================================================

describe("getInstanceName", () => {
  it("returns the identifier text for a plain identifier", () => {
    const ident = ts.factory.createIdentifier("eqNumber");
    expect(getInstanceName(ident)).toBe("eqNumber");
  });

  it("returns a dotted path for property access", () => {
    const prop = ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier("Point"),
      ts.factory.createIdentifier("Eq")
    );
    expect(getInstanceName(prop)).toBe("Point.Eq");
  });

  it("unwraps parenthesized expressions", () => {
    const inner = ts.factory.createIdentifier("eq");
    const paren = ts.factory.createParenthesizedExpression(inner);
    expect(getInstanceName(paren)).toBe("eq");
  });

  it("unwraps `as` type assertions", () => {
    const ident = ts.factory.createIdentifier("dict");
    const asExpr = ts.factory.createAsExpression(ident, ts.factory.createTypeReferenceNode("any"));
    expect(getInstanceName(asExpr)).toBe("dict");
  });

  it("returns undefined for unsupported expressions (e.g. literal)", () => {
    expect(getInstanceName(ts.factory.createNumericLiteral(42))).toBeUndefined();
  });
});

// ===========================================================================
// hasImplAnnotation / extractBrandFromImpl
// ===========================================================================

describe("hasImplAnnotation", () => {
  it("detects /** @impl */ on a variable declaration", () => {
    const { sourceFile } = createProgramFromSource(
      `/** @impl Eq<number> */ const eqN = { eq: (a: number, b: number) => a === b };`
    );
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(hasImplAnnotation(decl)).toBe(true);
  });

  it("detects /** @instance */ alias on a variable declaration", () => {
    const { sourceFile } = createProgramFromSource(
      `/** @instance Show<number> */ const showN = { show: (n: number) => String(n) };`
    );
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(hasImplAnnotation(decl)).toBe(true);
  });

  it("returns false when no @impl/@instance tag is present", () => {
    const { sourceFile } = createProgramFromSource(`const x = { eq: () => true };`);
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(hasImplAnnotation(decl)).toBe(false);
  });
});

describe("extractBrandFromImpl", () => {
  it("extracts brand from /** @impl Eq<number> */", () => {
    const { sourceFile } = createProgramFromSource(
      `/** @impl Eq<number> */ const eqN = { eq: (a: number, b: number) => a === b };`
    );
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(extractBrandFromImpl(decl)).toBe("number");
  });

  it("extracts nested brand from /** @impl Functor<Map<string, number>> */", () => {
    const { sourceFile } = createProgramFromSource(
      `/** @impl Functor<Map<string, number>> */ const f = { map: (x: any, fn: any) => x };`
    );
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(extractBrandFromImpl(decl)).toBe("Map<string, number>");
  });

  it("returns undefined when no @impl tag is present", () => {
    const { sourceFile } = createProgramFromSource(`const x = { eq: () => true };`);
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    expect(extractBrandFromImpl(decl)).toBeUndefined();
  });
});

// ===========================================================================
// resolveAutoSpecFunctionBody
// ===========================================================================

describe("resolveAutoSpecFunctionBody", () => {
  it("returns the arrow function directly when given inline", () => {
    const arrow = ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createNumericLiteral(1)
    );
    const ctx = makeCtx();
    const result = resolveAutoSpecFunctionBody(ctx.typeChecker, arrow);
    expect(result).toBe(arrow);
  });

  it("resolves an identifier to its variable initializer arrow function", () => {
    const { program, sourceFile } = createProgramFromSource(
      `const fn = (a: number) => a + 1;\nfn(2);`
    );
    const checker = program.getTypeChecker();
    const call = findFirstCall(sourceFile)!;
    const resolved = resolveAutoSpecFunctionBody(checker, call.expression);
    expect(resolved).toBeDefined();
    expect(ts.isArrowFunction(resolved!)).toBe(true);
  });

  it("resolves an identifier to a function declaration", () => {
    const { program, sourceFile } = createProgramFromSource(
      `function fn(a: number) { return a + 1; }\nfn(2);`
    );
    const checker = program.getTypeChecker();
    const call = findFirstCall(sourceFile)!;
    const resolved = resolveAutoSpecFunctionBody(checker, call.expression);
    expect(resolved).toBeDefined();
    expect(ts.isFunctionDeclaration(resolved!)).toBe(true);
  });

  it("returns undefined for unresolvable expressions", () => {
    const checker = makeCtx().typeChecker;
    const lit = ts.factory.createNumericLiteral(42);
    expect(resolveAutoSpecFunctionBody(checker, lit)).toBeUndefined();
  });
});

// ===========================================================================
// rewriteDictCallsForAutoSpec
// ===========================================================================

describe("rewriteDictCallsForAutoSpec", () => {
  it("rewrites a dict.method(args) call into the inlined method body", () => {
    // Source: function f(dict) { return dict.eq(1, 2); }
    const { sourceFile } = createProgramFromSource(
      `function f(dict: any) { return dict.eq(1, 2); }`
    );
    const ctx = makeCtx();
    const fnDecl = sourceFile.statements[0] as ts.FunctionDeclaration;
    const body = fnDecl.body!;

    // Build a DictMethodMap that inlines eq(a, b) → a === b
    const methods = new Map<string, { node?: ts.Expression; params: string[] }>();
    methods.set("eq", {
      node: ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            ts.factory.createIdentifier("a")
          ),
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            ts.factory.createIdentifier("b")
          ),
        ],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBinaryExpression(
          ts.factory.createIdentifier("a"),
          ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          ts.factory.createIdentifier("b")
        )
      ),
      params: ["a", "b"],
    });

    const dictParamMap = new Map([["dict", { brand: "T", methods }]]);
    const rewritten = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap);
    const out = printNode(rewritten);

    // The dict.eq(1, 2) call should be replaced by `1 === 2`.
    expect(out).toContain("1 === 2");
    expect(out).not.toContain("dict.eq");
  });

  it("leaves unrelated calls untouched", () => {
    const { sourceFile } = createProgramFromSource(
      `function f(dict: any, x: any) { return x.foo(1); }`
    );
    const ctx = createMacroContext(
      createProgramFromSource(`function f(dict: any, x: any) { return x.foo(1); }`).program,
      sourceFile,
      sharedTransformContext
    );
    const fnDecl = sourceFile.statements[0] as ts.FunctionDeclaration;
    const body = fnDecl.body!;

    const dictParamMap = new Map([
      [
        "dict",
        { brand: "T", methods: new Map<string, { node?: ts.Expression; params: string[] }>() },
      ],
    ]);
    const rewritten = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap);
    // Since no rewrite happens, the body should be identical (same reference even).
    // Verify there's still a call to x.foo present with one argument.
    let foundCall: ts.CallExpression | undefined;
    const visit = (n: ts.Node): void => {
      if (
        !foundCall &&
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "x"
      ) {
        foundCall = n;
      }
      ts.forEachChild(n, visit);
    };
    visit(rewritten);
    expect(foundCall).toBeDefined();
    expect(foundCall!.arguments).toHaveLength(1);
  });
});

// ===========================================================================
// inlineAutoSpecializeForHoisting
// ===========================================================================

describe("inlineAutoSpecializeForHoisting", () => {
  it("produces an arrow function with the dict param removed and dict calls inlined", () => {
    // const f = <T>(dict: Eq<T>, a: T, b: T) => dict.eq(a, b);
    const { sourceFile } = createProgramFromSource(
      `const f = (dict: any, a: any, b: any) => dict.eq(a, b);`
    );
    const ctx = makeCtx();
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    const arrow = decl.initializer as ts.ArrowFunction;

    const methods = new Map<string, { node?: ts.Expression; params: string[] }>();
    methods.set("eq", {
      node: ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            ts.factory.createIdentifier("x")
          ),
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            ts.factory.createIdentifier("y")
          ),
        ],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createBinaryExpression(
          ts.factory.createIdentifier("x"),
          ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          ts.factory.createIdentifier("y")
        )
      ),
      params: ["x", "y"],
    });

    const result = inlineAutoSpecializeForHoisting(
      ctx,
      arrow,
      [{ index: 0, name: "eqNumber", methods: { brand: "number", methods } }],
      "f"
    );
    expect(result).toBeDefined();
    expect(ts.isArrowFunction(result!)).toBe(true);
    const arr = result as ts.ArrowFunction;
    // dict param removed; a and b remain
    expect(arr.parameters).toHaveLength(2);
    expect((arr.parameters[0].name as ts.Identifier).text).toBe("a");
    expect((arr.parameters[1].name as ts.Identifier).text).toBe("b");
    const out = printNode(result!);
    expect(out).toContain("===");
    expect(out).not.toContain("dict");
  });

  it("returns undefined when the function has no parameters", () => {
    const arrow = ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createNumericLiteral(0)
    );
    const ctx = makeCtx();
    const result = inlineAutoSpecializeForHoisting(ctx, arrow, [], "f");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no dict params are matched", () => {
    const { sourceFile } = createProgramFromSource(`const f = (a: number) => a;`);
    const ctx = makeCtx();
    const varStmt = sourceFile.statements[0] as ts.VariableStatement;
    const arrow = varStmt.declarationList.declarations[0].initializer as ts.ArrowFunction;

    // index 5 is past the end; nothing matches
    const result = inlineAutoSpecializeForHoisting(
      ctx,
      arrow,
      [{ index: 5, name: "x", methods: { brand: "B", methods: new Map() } }],
      "f"
    );
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// SpecializationCache key/name conventions (exercised through specialization)
// ===========================================================================

describe("SpecializationCache integration", () => {
  it("computeKey is stable for the same inputs", () => {
    expect(SpecializationCache.computeKey("f", ["Array"])).toBe(
      SpecializationCache.computeKey("f", ["Array"])
    );
  });

  it("computeKey sorts brands so order does not matter", () => {
    expect(SpecializationCache.computeKey("f", ["B", "A"])).toBe(
      SpecializationCache.computeKey("f", ["A", "B"])
    );
  });

  it("generateHoistedName includes the function name and brand in its identifier", () => {
    const ctx = makeCtx();
    const ident = SpecializationCache.generateHoistedName("map", ["Array"], ctx.hygiene);
    // The hygiene context mangles the base name (e.g. __typesugar___map_Array_<n>__),
    // but both pieces must appear in the result so downstream debuggers can read it.
    expect(ident.text).toContain("__map_Array");
  });
});

// ===========================================================================
// tryAutoSpecialize — end-to-end
// ===========================================================================

describe("tryAutoSpecialize", () => {
  const SOURCE = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
myEq(eqNumber, 1, 2);
myEq(eqNumber, 3, 4);
`;

  it("returns undefined when no instance args are present", () => {
    const { program, sourceFile } = createProgramFromSource(`
const fn = (a: number, b: number) => a + b;
fn(1, 2);
`);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();
    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "fn"
    )!;
    expect(tryAutoSpecialize(ctx, false, cache, call)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("specializes a call with an @impl instance argument and hoists a declaration", () => {
    const { program, sourceFile } = createProgramFromSource(SOURCE);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    const result = tryAutoSpecialize(ctx, false, cache, call);

    expect(result).toBeDefined();
    expect(cache.size).toBe(1);
    expect(cache.getHoistedDeclarations()).toHaveLength(1);

    // Rewritten call references the hoisted identifier
    expect(ts.isCallExpression(result!)).toBe(true);
    const newCall = result as ts.CallExpression;
    expect(ts.isIdentifier(newCall.expression)).toBe(true);
    // Hygiene mangling wraps the name; both function name and brand appear inside.
    expect((newCall.expression as ts.Identifier).text).toContain("__myEq_number");

    // Dict argument is dropped, remaining args kept
    expect(newCall.arguments).toHaveLength(2);
  });

  it("reuses the cached specialization on a second call with the same key", () => {
    const { program, sourceFile } = createProgramFromSource(SOURCE);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const calls = findAllCalls(sourceFile).filter(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    );
    expect(calls).toHaveLength(2);

    const first = tryAutoSpecialize(ctx, false, cache, calls[0]) as ts.CallExpression;
    expect(cache.size).toBe(1);

    const second = tryAutoSpecialize(ctx, false, cache, calls[1]) as ts.CallExpression;
    // Cache size unchanged — same key reused
    expect(cache.size).toBe(1);
    expect(cache.getHoistedDeclarations()).toHaveLength(1);

    const firstName = (first.expression as ts.Identifier).text;
    const secondName = (second.expression as ts.Identifier).text;
    expect(secondName).toBe(firstName);
  });

  it("after cache.clear() the next call produces a fresh hoisted decl", () => {
    const { program, sourceFile } = createProgramFromSource(SOURCE);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const calls = findAllCalls(sourceFile).filter(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    );

    tryAutoSpecialize(ctx, false, cache, calls[0]);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.getHoistedDeclarations()).toHaveLength(0);

    tryAutoSpecialize(ctx, false, cache, calls[1]);
    expect(cache.size).toBe(1);
    expect(cache.getHoistedDeclarations()).toHaveLength(1);
  });

  it("honors inline `// @no-specialize` directive and returns undefined", () => {
    // The directive must appear on the same line, before the call.
    const src = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
/* @no-specialize */ myEq(eqNumber, 1, 2);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    expect(tryAutoSpecialize(ctx, false, cache, call)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("honors `// @no-specialize` on the preceding comment line", () => {
    const src = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
// @no-specialize
myEq(eqNumber, 1, 2);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    expect(tryAutoSpecialize(ctx, false, cache, call)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("`// @no-specialize-warn` suppresses warnings only — specialization still happens", () => {
    const src = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
/* @no-specialize-warn */ myEq(eqNumber, 1, 2);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    // Must NOT bail like plain @no-specialize — the substring collision bug
    // (fixed) used to make -warn disable specialization entirely.
    expect(tryAutoSpecialize(ctx, false, cache, call)).toBeDefined();
    expect(cache.size).toBe(1);
  });

  it("ignores `@no-specialize` in a TRAILING comment on the preceding line", () => {
    // The marker after `other(...)` belongs to that line's statement — it must
    // not opt out the unrelated call on the next line.
    const src = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
const other = myEq(eqNumber, 3, 4); // @no-specialize
myEq(eqNumber, 1, 2);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const calls = findAllCalls(sourceFile).filter(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    );
    // The second call (line after the trailing comment) must still specialize.
    expect(tryAutoSpecialize(ctx, false, cache, calls[1])).toBeDefined();
    expect(cache.size).toBe(1);
  });

  it("honors `// @no-specialize-warn` on the preceding comment line (suppress only)", () => {
    const src = `
/** @impl Eq<number> */
const eqNumber = { eq: (a: number, b: number) => a === b };
const myEq = <T>(dict: { eq: (a: T, b: T) => boolean }, a: T, b: T) => dict.eq(a, b);
// @no-specialize-warn
myEq(eqNumber, 1, 2);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    expect(tryAutoSpecialize(ctx, false, cache, call)).toBeDefined();
    expect(cache.size).toBe(1);
  });

  it("emits [TS9602] diagnostic when the function body cannot be resolved", () => {
    // Call an imported (unresolvable) function with a registered instance arg.
    // Use a manually-registered instance so getInstanceMethods finds it,
    // but the function body itself cannot be resolved.
    const src = `
declare const externFn: (dict: any, a: number) => boolean;
externFn(__test_eq_TS9602, 1);
`;
    const { program, sourceFile } = createProgramFromSource(src);
    registerTestInstance(
      "__test_eq_TS9602",
      "TS9602Brand",
      {
        eq: {
          params: ["a", "b"],
          body: ts.factory.createBinaryExpression(
            ts.factory.createIdentifier("a"),
            ts.factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            ts.factory.createIdentifier("b")
          ),
        },
      },
      program
    );
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "externFn"
    )!;
    const result = tryAutoSpecialize(ctx, false, cache, call);
    expect(result).toBeUndefined();
    const diags = ctx.getDiagnostics();
    const tsDiag = diags.find((d) => d.message.includes("TS9602"));
    expect(tsDiag).toBeDefined();
    expect(tsDiag!.message).toContain("externFn");
  });

  it("does not emit warnings on synthetic nodes (pos === -1)", () => {
    // Build a fully synthetic CallExpression — no source positions.
    const ctx = makeCtx();
    const cache = new SpecializationCache();

    const syntheticCall = ts.factory.createCallExpression(
      ts.factory.createIdentifier("noSuchFn"),
      undefined,
      [ts.factory.createIdentifier("nonexistentDict"), ts.factory.createNumericLiteral(1)]
    );
    // Synthetic nodes have pos === -1 by default; verify suppression path.
    expect(syntheticCall.pos).toBe(-1);

    const before = ctx.getDiagnostics().length;
    const result = tryAutoSpecialize(ctx, false, cache, syntheticCall);
    expect(result).toBeUndefined();
    expect(ctx.getDiagnostics().length).toBe(before);
  });

  it("hoisted specialization references the original function name", () => {
    const { program, sourceFile } = createProgramFromSource(SOURCE);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();

    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "myEq"
    )!;
    tryAutoSpecialize(ctx, false, cache, call);

    const decl = cache.getHoistedDeclarations()[0];
    const decls = decl.declarationList.declarations;
    expect(decls).toHaveLength(1);
    const name = (decls[0].name as ts.Identifier).text;
    expect(name).toContain("__myEq_");
    expect(name).toContain("number");
  });
});

// ===========================================================================
// Return-type-driven specialization
// ===========================================================================

describe("getTypeName", () => {
  it("returns the named type for a simple type", () => {
    const { program, sourceFile } = createProgramFromSource(
      `interface Foo {}\nconst x: Foo = {} as Foo;`
    );
    const checker = program.getTypeChecker();
    const varStmt = sourceFile.statements[1] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    const type = checker.getTypeAtLocation(decl);
    expect(getTypeName(checker, type)).toBe("Foo");
  });
});

describe("getContextualTypeForCall", () => {
  it("returns the declared variable type as contextual type", () => {
    const { program, sourceFile } = createProgramFromSource(
      `declare function fn(): number;\nconst x: number = fn();`
    );
    const checker = program.getTypeChecker();
    const varStmt = sourceFile.statements[1] as ts.VariableStatement;
    const decl = varStmt.declarationList.declarations[0];
    const call = decl.initializer as ts.CallExpression;
    const contextual = getContextualTypeForCall(checker, call);
    expect(contextual).toBeDefined();
  });

  it("returns undefined when no contextual type exists", () => {
    const { program, sourceFile } = createProgramFromSource(
      `declare function fn(): number;\nfn();`
    );
    const checker = program.getTypeChecker();
    const call = findFirstCall(sourceFile)!;
    // Top-level expression statement has no contextual type.
    const contextual = getContextualTypeForCall(checker, call);
    expect(contextual).toBeUndefined();
  });
});

describe("tryReturnTypeDrivenSpecialize", () => {
  it("returns undefined when the function does not return a Result-like type", () => {
    const { program, sourceFile } = createProgramFromSource(
      `const fn = (x: number) => x + 1;\nconst y: number = fn(2);`
    );
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();
    const call = findFirstCall(sourceFile)!;
    const result = tryReturnTypeDrivenSpecialize(ctx, false, cache, call);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no contextual type exists", () => {
    const { program, sourceFile } = createProgramFromSource(
      `type Result<E, T> = { ok: true; value: T } | { ok: false; error: E };
const fn = (x: number): Result<string, number> => ({ ok: true, value: x });
fn(1);`
    );
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const cache = new SpecializationCache();
    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "fn"
    )!;
    const result = tryReturnTypeDrivenSpecialize(ctx, false, cache, call);
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// tryInlineDerivedInstanceCall
// ===========================================================================

describe("tryInlineDerivedInstanceCall", () => {
  // Registry lookups are partitioned per ts.Program, so each test registers
  // `__test_inc_inst` against its own program right after creating it, rather
  // than sharing one `beforeEach` registration across every test's program.
  function registerTestIncInst(program: ts.Program): void {
    registerTestInstance(
      "__test_inc_inst",
      "TestInc",
      {
        inc: {
          params: ["a"],
          body: ts.factory.createBinaryExpression(
            ts.factory.createIdentifier("a"),
            ts.factory.createToken(ts.SyntaxKind.PlusToken),
            ts.factory.createNumericLiteral(1)
          ),
        },
      },
      program
    );
  }

  it("inlines a known instance method call", () => {
    const { program, sourceFile } = createProgramFromSource(`__test_inc_inst.inc(5);`);
    registerTestIncInst(program);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const call = findFirstCall(sourceFile)!;
    const result = tryInlineDerivedInstanceCall(ctx, call);
    expect(result).toBeDefined();
    expect(printNode(result!)).toContain("5 + 1");
  });

  it("returns undefined when the call is not a property access on a known instance", () => {
    const { program, sourceFile } = createProgramFromSource(`const f = (x: number) => x; f(1);`);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const call = findAllCalls(sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "f"
    )!;
    expect(tryInlineDerivedInstanceCall(ctx, call)).toBeUndefined();
  });

  it("returns undefined when the method is not defined on the instance", () => {
    const { program, sourceFile } = createProgramFromSource(`__test_inc_inst.nonexistent(1);`);
    registerTestIncInst(program);
    const ctx = createMacroContext(program, sourceFile, sharedTransformContext);
    const call = findFirstCall(sourceFile)!;
    expect(tryInlineDerivedInstanceCall(ctx, call)).toBeUndefined();
  });
});

// ===========================================================================
// eliminateDeadDerivedInstances
// ===========================================================================

describe("eliminateDeadDerivedInstances", () => {
  it("removes declarations whose only references are themselves and their registration call", () => {
    const { sourceFile } = createProgramFromSource(
      `const eqPoint = { eq: () => true };
Foo.registerInstance("Point", eqPoint);
const useless = 1;`
    );
    const inlined = new Set(["eqPoint"]);
    const filtered = eliminateDeadDerivedInstances(
      Array.from(sourceFile.statements),
      inlined,
      false
    );
    // eqPoint decl + registerInstance call should be removed; `useless` survives.
    expect(filtered.length).toBe(1);
    const survivor = filtered[0];
    expect(ts.isVariableStatement(survivor)).toBe(true);
    const decl = (survivor as ts.VariableStatement).declarationList.declarations[0];
    expect((decl.name as ts.Identifier).text).toBe("useless");
  });

  it("keeps declarations that are still referenced elsewhere", () => {
    const { sourceFile } = createProgramFromSource(
      `const eqPoint = { eq: () => true };
Foo.registerInstance("Point", eqPoint);
const ref = eqPoint;`
    );
    const inlined = new Set(["eqPoint"]);
    const filtered = eliminateDeadDerivedInstances(
      Array.from(sourceFile.statements),
      inlined,
      false
    );
    // External reference exists → nothing is removed.
    expect(filtered.length).toBe(3);
  });

  it("returns input unchanged when inlinedInstanceNames is empty", () => {
    const stmts: ts.Statement[] = [
      ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [
            ts.factory.createVariableDeclaration(
              ts.factory.createIdentifier("x"),
              undefined,
              undefined,
              ts.factory.createNumericLiteral(1)
            ),
          ],
          ts.NodeFlags.Const
        )
      ),
    ];
    const result = eliminateDeadDerivedInstances(stmts, new Set(), false);
    expect(result).toBe(stmts);
  });
});

describe("module wiring", () => {
  it("imports registerInstanceMethodsFromAST", () => {
    expect(typeof registerInstanceMethodsFromAST).toBe("function");
  });
});

// ===========================================================================
// PEP-053 Wave 2 — shared source-based extraction (cross-module capability)
// ===========================================================================

describe("tryExtractInstanceFromSource (PEP-053 Wave 2)", () => {
  const FUNCTOR_TC = `
export interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
`.trim();

  /** Find the call named `fnName` in the root file and return its argument. */
  function argOfCall(ctx: MacroContextImpl, argIndex = 0): ts.Expression {
    const call = findAllCalls(ctx.sourceFile).find(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === "use"
    );
    expect(call).toBeDefined();
    return call!.arguments[argIndex];
  }

  it("extracts an instance imported from another module (gap 1)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
${FUNCTOR_TC}
/** @impl Functor<Array> */
export const w2ImportedFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      "main.ts": `
import { w2ImportedFunctor } from "./lib";
declare function use(x: unknown): void;
use(w2ImportedFunctor);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.brand).toBe("Array");
    expect(result!.methods.has("map")).toBe(true);
  });

  it("follows renamed imports (gap 1)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
${FUNCTOR_TC}
/** @impl Functor<Array> */
export const w2RenamedFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      "main.ts": `
import { w2RenamedFunctor as rf } from "./lib";
declare function use(x: unknown): void;
use(rf);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
  });

  it("extracts a zero-arg factory instance (gap 2)", () => {
    const ctx = makeMultiFileCtx({
      "main.ts": `
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function w2Factory<E>(): Functor<any> {
  return {
    map: (fa: any, f: (a: any) => any) => (fa.ok ? { ok: true, value: f(fa.value) } : fa),
  };
}
declare function use(x: unknown): void;
use(w2Factory<string>());
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
  });

  it("rejects factories with value parameters (gap 2)", () => {
    const ctx = makeMultiFileCtx({
      "main.ts": `
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function w2ValueFactory(tag: string): Functor<any> {
  return {
    map: (fa: any[], f: (a: any) => any) => fa.map(f),
  };
}
declare function use(x: unknown): void;
use(w2ValueFactory("x"));
`.trim(),
    });

    expect(tryExtractInstanceFromSource(ctx, argOfCall(ctx))).toBeUndefined();
  });

  it("chases identifier-alias consts across modules (gap 3)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
${FUNCTOR_TC}
const base: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
export const w2AliasFunctor = base;
`.trim(),
      "main.ts": `
import { w2AliasFunctor } from "./lib";
declare function use(x: unknown): void;
use(w2AliasFunctor);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
  });

  it("resolves property-access members (gap 4)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
export interface Monad<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
  flatMap<A, B>(fa: any, f: (a: A) => any): any;
}
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
const baseFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
export const w2MemberMonad: Monad<Array<any>> = {
  map: baseFunctor.map,
  flatMap: (fa: any[], f: (a: any) => any[]) => fa.flatMap(f),
};
`.trim(),
      "main.ts": `
import { w2MemberMonad } from "./lib";
declare function use(x: unknown): void;
use(w2MemberMonad);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
    expect(result!.methods.has("flatMap")).toBe(true);
  });

  it("accepts annotation-only instances without @impl (gap 5, unified criteria)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
${FUNCTOR_TC}
export const w2AnnotatedOnly: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};
`.trim(),
      "main.ts": `
import { w2AnnotatedOnly } from "./lib";
declare function use(x: unknown): void;
use(w2AnnotatedOnly);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
  });

  it("resolves companion paths through scope when the checker has no symbol (gap 6)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
export interface Numeric<T> {
  add(a: T, b: T): T;
}
export interface Point { x: number; y: number; }
/** @impl Numeric<Point> */
export const w2NumericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};
`.trim(),
      "main.ts": `
import { w2NumericPoint } from "./lib";
import type { Point } from "./lib";
declare const Point: any;
declare function use(x: unknown): void;
use(Point.Numeric);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("add")).toBe(true);
  });

  it("drops cross-module methods that reference module-local helpers (safety)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
${FUNCTOR_TC}
function localHelper(fa: any[], f: (a: any) => any): any[] {
  return fa.map(f);
}
export const w2HelperFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => localHelper(fa, f),
};
`.trim(),
      "main.ts": `
import { w2HelperFunctor } from "./lib";
declare function use(x: unknown): void;
use(w2HelperFunctor);
`.trim(),
    });

    // The only method captures a module-local helper — extraction yields
    // nothing and the call falls back to dictionary passing.
    expect(tryExtractInstanceFromSource(ctx, argOfCall(ctx))).toBeUndefined();
  });

  it("keeps safe siblings when only some methods are unsafe (safety)", () => {
    const ctx = makeMultiFileCtx({
      "lib.ts": `
export interface Monad<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
  flatMap<A, B>(fa: any, f: (a: A) => any): any;
}
function localFlatten(fa: any[], f: (a: any) => any[]): any[] {
  return fa.flatMap(f);
}
export const w2MixedMonad: Monad<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
  flatMap: (fa: any[], f: (a: any) => any[]) => localFlatten(fa, f),
};
`.trim(),
      "main.ts": `
import { w2MixedMonad } from "./lib";
declare function use(x: unknown): void;
use(w2MixedMonad);
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
    expect(result!.methods.has("flatMap")).toBe(false);
  });

  it("drops factory methods that reference factory-local bindings, even same-file (safety)", () => {
    const ctx = makeMultiFileCtx({
      "main.ts": `
interface Monad<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
  flatMap<A, B>(fa: any, f: (a: A) => any): any;
}
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function w2BaseFactory<E>(): Functor<any> {
  return {
    map: (fa: any[], f: (a: any) => any) => fa.map(f),
  };
}
function w2LocalBindingFactory<E>(): Monad<any> {
  const functor = w2BaseFactory<E>();
  return {
    map: functor.map,
    flatMap: (fa: any[], f: (a: any) => any[]) => functor.map(fa, f).flat(),
  };
}
declare function use(x: unknown): void;
use(w2LocalBindingFactory<string>());
`.trim(),
    });

    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    // \`map: functor.map\` resolves THROUGH the local binding to the base
    // factory's self-contained arrow — extractable. The flatMap body
    // references \`functor\` directly, which exists only inside the factory —
    // inlining it would dangle, so it must be dropped even same-file.
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
    expect(result!.methods.has("flatMap")).toBe(false);
  });

  it("still extracts same-file instances whose methods use file-local helpers (no scan same-module)", () => {
    const ctx = makeMultiFileCtx({
      "main.ts": `
interface Functor<F> {
  map<A, B>(fa: any, f: (a: A) => B): any;
}
function sameFileHelper(fa: any[], f: (a: any) => any): any[] {
  return fa.map(f);
}
/** @impl Functor<Array> */
const w2SameFileFunctor: Functor<Array<any>> = {
  map: (fa: any[], f: (a: any) => any) => sameFileHelper(fa, f),
};
declare function use(x: unknown): void;
use(w2SameFileFunctor);
`.trim(),
    });

    // Same-module helpers are in scope at the call site — extraction proceeds.
    const result = tryExtractInstanceFromSource(ctx, argOfCall(ctx));
    expect(result).toBeDefined();
    expect(result!.methods.has("map")).toBe(true);
  });
});
