/**
 * Tests for operators.ts — Operator macros and helpers
 *
 * Covers:
 * - getOperatorString for every supported SyntaxKind plus unknown-kind fallback
 * - Macro registration metadata (name, description, module) for pipe/cons/apply/pipe/compose
 * - Default expansion of __pipe__, __cons__, __apply__ when no typeclass instance matches
 * - Typeclass dispatch path of __pipe__/__cons__/__apply__ when an instance exists
 * - pipeMacro expansion (>=2 args, error on <2 args)
 * - composeMacro expansion (>=1 args, error on 0 args, arrow function shape)
 * - Error handling: too-few/too-many args to op macros
 */

import * as ts from "typescript";
import { describe, it, expect, beforeEach } from "vitest";
import { globalResolutionScope } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

import {
  pipeOpMacro,
  consOpMacro,
  applyOpMacro,
  pipeMacro,
  composeMacro,
  getOperatorString,
} from "./operators.js";
import {
  clearRegistries,
  registerStandardTypeclasses,
  registerTypeclassDef,
  registerInstanceWithMeta,
} from "./typeclass.js";

// ============================================================================
// Stub MacroContext
// ============================================================================

interface StubOptions {
  /** Map from node identity → fake type used by getTypeOf */
  typeMap?: Map<ts.Node, ts.Type>;
  fileName?: string;
}

interface StubResult {
  ctx: MacroContext;
  errors: Array<{ node: ts.Node; message: string }>;
}

/**
 * Build a MacroContext stub that implements only what the operator macros
 * call during `expand()`: factory, reportError, getTypeOf, typeChecker.typeToString,
 * sourceFile.fileName, and generateUniqueName.
 */
function makeStubCtx(opts: StubOptions = {}): StubResult {
  const errors: Array<{ node: ts.Node; message: string }> = [];
  const fileName = opts.fileName ?? "test.ts";
  const sourceFile = ts.createSourceFile(fileName, "", ts.ScriptTarget.Latest, true);

  const typeChecker = {
    typeToString: (type: ts.Type, _enclosing?: ts.Node, _flags?: ts.TypeFormatFlags): string => {
      return (type as any).__name ?? "unknown";
    },
  } as unknown as ts.TypeChecker;

  let uniqueCounter = 0;
  const ctx = {
    factory: ts.factory,
    typeChecker,
    sourceFile,
    reportError(node: ts.Node, message: string) {
      errors.push({ node, message });
    },
    getTypeOf(node: ts.Node): ts.Type {
      const t = opts.typeMap?.get(node);
      if (t) return t;
      throw new Error("no type for node");
    },
    generateUniqueName(prefix: string): ts.Identifier {
      uniqueCounter++;
      return ts.factory.createIdentifier(`${prefix}_${uniqueCounter}`);
    },
  } as unknown as MacroContext;

  return { ctx, errors };
}

/**
 * Build a fake ts.Type that getSymbol()/aliasSymbol report a given name for.
 * Allows tryTypeclassResolution() to extract a base type name without a
 * real TypeScript Program.
 */
function makeFakeNamedType(name: string): ts.Type {
  const symbol = { getName: () => name } as unknown as ts.Symbol;
  return {
    getSymbol: () => symbol,
    aliasSymbol: undefined,
    __name: name,
  } as unknown as ts.Type;
}

/** Build a fake type with no symbol — exercises the primitive fallback path. */
function makeFakePrimitiveType(name: string): ts.Type {
  return {
    getSymbol: () => undefined,
    aliasSymbol: undefined,
    __name: name,
  } as unknown as ts.Type;
}

function makeCallExpr(name: string, args: ts.Expression[]): ts.CallExpression {
  return ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, args);
}

function printExpr(node: ts.Node): string {
  const printer = ts.createPrinter({ removeComments: true });
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

// ============================================================================
// getOperatorString
// ============================================================================

describe("getOperatorString", () => {
  const cases: Array<[ts.SyntaxKind, string, string]> = [
    [ts.SyntaxKind.PlusToken, "+", "PlusToken"],
    [ts.SyntaxKind.MinusToken, "-", "MinusToken"],
    [ts.SyntaxKind.AsteriskToken, "*", "AsteriskToken"],
    [ts.SyntaxKind.SlashToken, "/", "SlashToken"],
    [ts.SyntaxKind.PercentToken, "%", "PercentToken"],
    [ts.SyntaxKind.AsteriskAsteriskToken, "**", "AsteriskAsteriskToken"],
    [ts.SyntaxKind.LessThanToken, "<", "LessThanToken"],
    [ts.SyntaxKind.LessThanEqualsToken, "<=", "LessThanEqualsToken"],
    [ts.SyntaxKind.GreaterThanToken, ">", "GreaterThanToken"],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">=", "GreaterThanEqualsToken"],
    [ts.SyntaxKind.EqualsEqualsToken, "==", "EqualsEqualsToken"],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "===", "EqualsEqualsEqualsToken"],
    [ts.SyntaxKind.ExclamationEqualsToken, "!=", "ExclamationEqualsToken"],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!==", "ExclamationEqualsEqualsToken"],
    [ts.SyntaxKind.AmpersandToken, "&", "AmpersandToken"],
    [ts.SyntaxKind.BarToken, "|", "BarToken"],
    [ts.SyntaxKind.CaretToken, "^", "CaretToken"],
    [ts.SyntaxKind.LessThanLessThanToken, "<<", "LessThanLessThanToken"],
    [ts.SyntaxKind.GreaterThanGreaterThanToken, ">>", "GreaterThanGreaterThanToken"],
  ];

  for (const [kind, expected, name] of cases) {
    it(`maps ${name} → "${expected}"`, () => {
      expect(getOperatorString(kind)).toBe(expected);
    });
  }

  it("returns undefined for unknown SyntaxKind", () => {
    // Identifier is definitely not a binary operator token.
    expect(getOperatorString(ts.SyntaxKind.Identifier)).toBeUndefined();
  });

  it("returns undefined for logical operators (not supported)", () => {
    // The source switch does not list && or || — they map to undefined.
    expect(getOperatorString(ts.SyntaxKind.AmpersandAmpersandToken)).toBeUndefined();
    expect(getOperatorString(ts.SyntaxKind.BarBarToken)).toBeUndefined();
  });
});

// ============================================================================
// Macro registration metadata
// ============================================================================

describe("macro registration metadata", () => {
  it("pipeOpMacro has correct kind/name/description", () => {
    expect(pipeOpMacro.kind).toBe("expression");
    expect(pipeOpMacro.name).toBe("__pipe__");
    expect(pipeOpMacro.description).toMatch(/Pipeline operator/);
  });

  it("consOpMacro has correct kind/name/description", () => {
    expect(consOpMacro.kind).toBe("expression");
    expect(consOpMacro.name).toBe("__cons__");
    expect(consOpMacro.description).toMatch(/Cons operator/);
  });

  it("applyOpMacro has correct kind/name/description", () => {
    expect(applyOpMacro.kind).toBe("expression");
    expect(applyOpMacro.name).toBe("__apply__");
    expect(applyOpMacro.description).toMatch(/Reverse-apply operator/);
  });

  it("pipeMacro is registered under the 'typesugar' module", () => {
    expect(pipeMacro.kind).toBe("expression");
    expect(pipeMacro.name).toBe("pipe");
    expect(pipeMacro.module).toBe("typesugar");
  });

  it("composeMacro is registered under the 'typesugar' module", () => {
    expect(composeMacro.kind).toBe("expression");
    expect(composeMacro.name).toBe("compose");
    expect(composeMacro.module).toBe("typesugar");
  });
});

// ============================================================================
// __pipe__ — default expansion (no typeclass)
// ============================================================================

describe("pipeOpMacro.expand", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("a |> f → f(a) when no typeclass instance matches", () => {
    const { ctx, errors } = makeStubCtx();
    const left = ts.factory.createIdentifier("a");
    const right = ts.factory.createIdentifier("f");
    const callExpr = makeCallExpr("__pipe__", [left, right]);

    // No type information available → getTypeOf throws → null resolution.
    const result = pipeOpMacro.expand(ctx, callExpr, [left, right]);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("f(a)");
  });

  it("reports an error and returns the call as-is when not exactly 2 args", () => {
    const { ctx, errors } = makeStubCtx();
    const callExpr = makeCallExpr("__pipe__", [ts.factory.createIdentifier("a")]);

    const result = pipeOpMacro.expand(ctx, callExpr, [ts.factory.createIdentifier("a")]);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exactly 2 arguments/);
  });
});

// ============================================================================
// __cons__ — default expansion
// ============================================================================

describe("consOpMacro.expand", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("h :: t → [h, ...t] when no typeclass instance matches", () => {
    const { ctx, errors } = makeStubCtx();
    const head = ts.factory.createIdentifier("h");
    const tail = ts.factory.createIdentifier("t");
    const callExpr = makeCallExpr("__cons__", [head, tail]);

    const result = consOpMacro.expand(ctx, callExpr, [head, tail]);

    expect(errors).toEqual([]);
    expect(ts.isArrayLiteralExpression(result)).toBe(true);
    expect(printExpr(result)).toBe("[h, ...t]");
  });

  it("reports an error when not exactly 2 args", () => {
    const { ctx, errors } = makeStubCtx();
    const callExpr = makeCallExpr("__cons__", []);

    const result = consOpMacro.expand(ctx, callExpr, []);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exactly 2 arguments/);
  });
});

// ============================================================================
// __apply__ — default expansion
// ============================================================================

describe("applyOpMacro.expand", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("f <| x → f(x) when no typeclass instance matches", () => {
    const { ctx, errors } = makeStubCtx();
    const fn = ts.factory.createIdentifier("f");
    const arg = ts.factory.createIdentifier("x");
    const callExpr = makeCallExpr("__apply__", [fn, arg]);

    const result = applyOpMacro.expand(ctx, callExpr, [fn, arg]);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("f(x)");
  });

  it("reports an error when called with 3 args", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [
      ts.factory.createIdentifier("a"),
      ts.factory.createIdentifier("b"),
      ts.factory.createIdentifier("c"),
    ];
    const callExpr = makeCallExpr("__apply__", args);

    const result = applyOpMacro.expand(ctx, callExpr, args);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exactly 2 arguments/);
  });
});

// ============================================================================
// __pipe__ / __cons__ / __apply__ — typeclass-dispatch path
// ============================================================================

describe("operator macros: typeclass dispatch", () => {
  const fileName = "/virtual/operators-test.ts";

  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
    // Put our custom typeclasses in scope for the fake test file.
    globalResolutionScope.registerDefinedTypeclass(fileName, "PipeTC");
    globalResolutionScope.registerDefinedTypeclass(fileName, "ConsTC");
    globalResolutionScope.registerDefinedTypeclass(fileName, "ApplyTC");
  });

  it("__pipe__ dispatches to an Instance.method(left, right) when an instance exists", () => {
    registerTypeclassDef({
      name: "PipeTC",
      typeParam: "A",
      methods: [],
      canDeriveProduct: false,
      canDeriveSum: false,
      syntax: new Map([["|>", "pipeThrough"]]),
    });
    registerInstanceWithMeta({
      typeclassName: "PipeTC",
      forType: "MyType",
      instanceName: "pipeTCMyType",
      derived: false,
    });

    const left = ts.factory.createIdentifier("value");
    const right = ts.factory.createIdentifier("step");
    const typeMap = new Map<ts.Node, ts.Type>([[left, makeFakeNamedType("MyType")]]);
    const { ctx } = makeStubCtx({ typeMap, fileName });
    const callExpr = makeCallExpr("__pipe__", [left, right]);

    const result = pipeOpMacro.expand(ctx, callExpr, [left, right]);

    expect(printExpr(result)).toBe("pipeTCMyType.pipeThrough(value, step)");
  });

  it("__cons__ dispatches to an Instance.method(head, tail) when an instance exists", () => {
    registerTypeclassDef({
      name: "ConsTC",
      typeParam: "A",
      methods: [],
      canDeriveProduct: false,
      canDeriveSum: false,
      syntax: new Map([["::", "prepend"]]),
    });
    registerInstanceWithMeta({
      typeclassName: "ConsTC",
      forType: "MyList",
      instanceName: "consTCMyList",
      derived: false,
    });

    const head = ts.factory.createIdentifier("h");
    const tail = ts.factory.createIdentifier("xs");
    const typeMap = new Map<ts.Node, ts.Type>([[head, makeFakeNamedType("MyList")]]);
    const { ctx } = makeStubCtx({ typeMap, fileName });
    const callExpr = makeCallExpr("__cons__", [head, tail]);

    const result = consOpMacro.expand(ctx, callExpr, [head, tail]);

    expect(printExpr(result)).toBe("consTCMyList.prepend(h, xs)");
  });

  it("__apply__ dispatches to an Instance.method(fn, arg) when an instance exists", () => {
    registerTypeclassDef({
      name: "ApplyTC",
      typeParam: "A",
      methods: [],
      canDeriveProduct: false,
      canDeriveSum: false,
      syntax: new Map([["<|", "reverseApply"]]),
    });
    registerInstanceWithMeta({
      typeclassName: "ApplyTC",
      forType: "Fn",
      instanceName: "applyTCFn",
      derived: false,
    });

    const fn = ts.factory.createIdentifier("g");
    const arg = ts.factory.createIdentifier("x");
    const typeMap = new Map<ts.Node, ts.Type>([[fn, makeFakeNamedType("Fn")]]);
    const { ctx } = makeStubCtx({ typeMap, fileName });
    const callExpr = makeCallExpr("__apply__", [fn, arg]);

    const result = applyOpMacro.expand(ctx, callExpr, [fn, arg]);

    expect(printExpr(result)).toBe("applyTCFn.reverseApply(g, x)");
  });

  it("falls back to default expansion when type has no symbol AND no matching instance", () => {
    registerTypeclassDef({
      name: "PipeTC",
      typeParam: "A",
      methods: [],
      canDeriveProduct: false,
      canDeriveSum: false,
      syntax: new Map([["|>", "pipeThrough"]]),
    });

    const left = ts.factory.createIdentifier("value");
    const right = ts.factory.createIdentifier("step");
    // No symbol → falls back to typeChecker.typeToString → "number", no instance for "number"
    const typeMap = new Map<ts.Node, ts.Type>([[left, makeFakePrimitiveType("number")]]);
    const { ctx } = makeStubCtx({ typeMap, fileName });
    const callExpr = makeCallExpr("__pipe__", [left, right]);

    const result = pipeOpMacro.expand(ctx, callExpr, [left, right]);

    expect(printExpr(result)).toBe("step(value)");
  });
});

// ============================================================================
// pipeMacro
// ============================================================================

describe("pipeMacro.expand", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("pipe(x, f) → f(x)", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [ts.factory.createIdentifier("x"), ts.factory.createIdentifier("f")];
    const callExpr = makeCallExpr("pipe", args);

    const result = pipeMacro.expand(ctx, callExpr, args);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("f(x)");
  });

  it("pipe(x, f, g, h) → h(g(f(x)))", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [
      ts.factory.createIdentifier("x"),
      ts.factory.createIdentifier("f"),
      ts.factory.createIdentifier("g"),
      ts.factory.createIdentifier("h"),
    ];
    const callExpr = makeCallExpr("pipe", args);

    const result = pipeMacro.expand(ctx, callExpr, args);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("h(g(f(x)))");
  });

  it("pipe(x) (single arg) reports an error and returns the call as-is", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [ts.factory.createIdentifier("x")];
    const callExpr = makeCallExpr("pipe", args);

    const result = pipeMacro.expand(ctx, callExpr, args);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/at least an initial value and one function/);
  });

  it("pipe() (zero args) reports an error", () => {
    const { ctx, errors } = makeStubCtx();
    const callExpr = makeCallExpr("pipe", []);

    const result = pipeMacro.expand(ctx, callExpr, []);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
  });
});

// ============================================================================
// composeMacro
// ============================================================================

describe("composeMacro.expand", () => {
  beforeEach(() => {
    clearRegistries();
    registerStandardTypeclasses();
  });

  it("compose(f) → (x) => f(x)", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [ts.factory.createIdentifier("f")];
    const callExpr = makeCallExpr("compose", args);

    const result = composeMacro.expand(ctx, callExpr, args);

    expect(errors).toEqual([]);
    expect(ts.isArrowFunction(result)).toBe(true);
    // generateUniqueName yields x_1 for the first call. The TS printer omits
    // parens around a single un-typed arrow parameter.
    expect(printExpr(result)).toBe("x_1 => f(x_1)");
  });

  it("compose(f, g) → (x) => g(f(x))  [right-to-left composition: source iterates args.length-1..0, body wraps args[i](body)]", () => {
    // NOTE on direction: the source builds body by iterating i from
    // args.length-1 down to 0, wrapping body = args[i](body). So for
    // compose(f, g): start body=x; i=1 → body=g(x); i=0 → body=f(g(x)).
    // i.e. compose(f, g)(x) = f(g(x)) — classic mathematical compose
    // (right-to-left), matching the macro's "Compose functions right-to-left"
    // description.
    const { ctx, errors } = makeStubCtx();
    const args = [ts.factory.createIdentifier("f"), ts.factory.createIdentifier("g")];
    const callExpr = makeCallExpr("compose", args);

    const result = composeMacro.expand(ctx, callExpr, args);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("x_1 => f(g(x_1))");
  });

  it("compose(f, g, h) → (x) => f(g(h(x)))", () => {
    const { ctx, errors } = makeStubCtx();
    const args = [
      ts.factory.createIdentifier("f"),
      ts.factory.createIdentifier("g"),
      ts.factory.createIdentifier("h"),
    ];
    const callExpr = makeCallExpr("compose", args);

    const result = composeMacro.expand(ctx, callExpr, args);

    expect(errors).toEqual([]);
    expect(printExpr(result)).toBe("x_1 => f(g(h(x_1)))");
  });

  it("compose() (zero args) reports an error and returns the call as-is", () => {
    const { ctx, errors } = makeStubCtx();
    const callExpr = makeCallExpr("compose", []);

    const result = composeMacro.expand(ctx, callExpr, []);

    expect(result).toBe(callExpr);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/at least one function/);
  });
});
