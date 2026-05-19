/**
 * Tests for quote.ts — Quasiquote primitives and AST builders
 *
 * Covers:
 * - Splice wrapper classes: SpreadSplice, IdentSplice, RawSplice and their
 *   constructor helpers `spread`, `ident`, `raw`.
 * - `quote(ctx)`: returns a ts.Expression, with no/one/multiple splices,
 *   covering identifier, raw, primitive, and AST-node splices.
 * - `quoteStatements(ctx)`: returns ts.Statement[]; SpreadSplice flattens.
 * - `quoteType(ctx)`: parses primitives, generic, union, intersection,
 *   function types into TypeNodes.
 * - `quoteBlock(ctx)`: returns ts.Block carrying the parsed statements.
 * - High-level builders: quoteCall, quotePropAccess, quoteMethodCall,
 *   quoteConst/quoteLet (flag check), quoteReturn (with/without expr),
 *   quoteIf (with/without else), quoteArrow (block/expression body),
 *   quoteFunction (with/without return type and exported flag).
 * - Edge cases: empty splice array, splice/slot arity mismatches.
 *
 * All assertions are structural — using ts.is* predicates and SyntaxKind
 * comparisons rather than printed-string equality.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, type MacroContext } from "@typesugar/core";
import {
  quote,
  quoteStatements,
  quoteType,
  quoteBlock,
  quoteCall,
  quotePropAccess,
  quoteMethodCall,
  quoteConst,
  quoteLet,
  quoteReturn,
  quoteIf,
  quoteArrow,
  quoteFunction,
  ident,
  raw,
  spread,
  SpreadSplice,
  IdentSplice,
  RawSplice,
} from "./quote.js";

// ---------------------------------------------------------------------------
// Helpers — build a real MacroContext backed by a temp ts.Program
// ---------------------------------------------------------------------------

interface TestCtx {
  ctx: MacroContext;
  cleanup: () => void;
}

/**
 * Create a MacroContext from an inline source. The transformer is invoked
 * synchronously and the context is captured so individual tests can call
 * quote helpers against it directly.
 */
function makeContext(source = "export {};"): TestCtx {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-test-"));
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

  let captured: MacroContext | undefined;
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    captured = createMacroContext(program, sourceFile, transformContext);
    return (sf) => sf;
  };
  ts.transform(sourceFile, [transformerFactory]);

  if (!captured) {
    throw new Error("Failed to capture MacroContext");
  }

  return {
    ctx: captured,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Convenience wrapper that runs `fn` with a context and tears it down.
 */
function withCtx<T>(fn: (ctx: MacroContext) => T): T {
  const { ctx, cleanup } = makeContext();
  try {
    return fn(ctx);
  } finally {
    cleanup();
  }
}

// ===========================================================================
// Splice Wrapper Classes
// ===========================================================================

describe("SpreadSplice / spread", () => {
  it("constructs a SpreadSplice carrying the given statements", () => {
    const stmts: ts.Statement[] = [
      ts.factory.createExpressionStatement(ts.factory.createIdentifier("a")),
      ts.factory.createExpressionStatement(ts.factory.createIdentifier("b")),
    ];
    const s = spread(stmts);
    expect(s).toBeInstanceOf(SpreadSplice);
    expect(s.nodes).toBe(stmts);
    expect(s.nodes).toHaveLength(2);
  });

  it("accepts an empty statement list", () => {
    const s = spread([]);
    expect(s).toBeInstanceOf(SpreadSplice);
    expect(s.nodes).toHaveLength(0);
  });
});

describe("IdentSplice / ident", () => {
  it("produces an IdentSplice with the given name", () => {
    const i = ident("foo");
    expect(i).toBeInstanceOf(IdentSplice);
    expect(i.name).toBe("foo");
  });

  it("preserves the literal name (no mangling)", () => {
    expect(ident("$weird_name1").name).toBe("$weird_name1");
  });
});

describe("RawSplice / raw", () => {
  it("produces a RawSplice with the given name", () => {
    const r = raw("bar");
    expect(r).toBeInstanceOf(RawSplice);
    expect(r.name).toBe("bar");
  });

  it("does not conflate with IdentSplice", () => {
    const r = raw("baz");
    const i = ident("baz");
    expect(r).toBeInstanceOf(RawSplice);
    expect(r).not.toBeInstanceOf(IdentSplice);
    expect(i).toBeInstanceOf(IdentSplice);
    expect(i).not.toBeInstanceOf(RawSplice);
    // SpreadSplice is also unrelated
    expect(spread([])).not.toBeInstanceOf(IdentSplice);
    expect(spread([])).not.toBeInstanceOf(RawSplice);
  });
});

// ===========================================================================
// quote — Expression quasiquote
// ===========================================================================

describe("quote(ctx)", () => {
  it("parses a literal expression with no splices", () => {
    withCtx((ctx) => {
      const expr = quote(ctx)`1 + 2`;
      expect(ts.isBinaryExpression(expr)).toBe(true);
      const bin = expr as ts.BinaryExpression;
      expect(bin.operatorToken.kind).toBe(ts.SyntaxKind.PlusToken);
      expect(ts.isNumericLiteral(bin.left)).toBe(true);
      expect(ts.isNumericLiteral(bin.right)).toBe(true);
      expect((bin.left as ts.NumericLiteral).text).toBe("1");
      expect((bin.right as ts.NumericLiteral).text).toBe("2");
    });
  });

  it("splices an ident() name into expression position", () => {
    withCtx((ctx) => {
      const expr = quote(ctx)`${ident("x")} + 1`;
      expect(ts.isBinaryExpression(expr)).toBe(true);
      const bin = expr as ts.BinaryExpression;
      expect(ts.isIdentifier(bin.left)).toBe(true);
      expect((bin.left as ts.Identifier).text).toBe("x");
    });
  });

  it("splices a raw() name into expression position", () => {
    withCtx((ctx) => {
      const expr = quote(ctx)`${raw("foo")}`;
      expect(ts.isIdentifier(expr)).toBe(true);
      expect((expr as ts.Identifier).text).toBe("foo");
    });
  });

  it("splices an existing ts.Expression node", () => {
    withCtx((ctx) => {
      const inner = ts.factory.createNumericLiteral("42");
      const expr = quote(ctx)`${inner} * 2`;
      expect(ts.isBinaryExpression(expr)).toBe(true);
      const bin = expr as ts.BinaryExpression;
      expect(bin.operatorToken.kind).toBe(ts.SyntaxKind.AsteriskToken);
      expect(ts.isNumericLiteral(bin.left)).toBe(true);
      expect((bin.left as ts.NumericLiteral).text).toBe("42");
    });
  });

  it("splices a string primitive verbatim (as source text)", () => {
    withCtx((ctx) => {
      // The string "100" is inserted as source code, producing a numeric literal.
      const expr = quote(ctx)`${"100"}`;
      expect(ts.isNumericLiteral(expr)).toBe(true);
      expect((expr as ts.NumericLiteral).text).toBe("100");
    });
  });

  it("splices a number primitive as a literal", () => {
    withCtx((ctx) => {
      const expr = quote(ctx)`${7} + ${3}`;
      expect(ts.isBinaryExpression(expr)).toBe(true);
      const bin = expr as ts.BinaryExpression;
      expect((bin.left as ts.NumericLiteral).text).toBe("7");
      expect((bin.right as ts.NumericLiteral).text).toBe("3");
    });
  });

  it("splices a boolean primitive as a keyword", () => {
    withCtx((ctx) => {
      const expr = quote(ctx)`${true}`;
      expect(expr.kind).toBe(ts.SyntaxKind.TrueKeyword);
    });
  });

  it("composes multiple node splices in one template", () => {
    withCtx((ctx) => {
      const a = ts.factory.createIdentifier("a");
      const b = ts.factory.createIdentifier("b");
      const expr = quote(ctx)`${a}(${b})`;
      expect(ts.isCallExpression(expr)).toBe(true);
      const call = expr as ts.CallExpression;
      expect(ts.isIdentifier(call.expression)).toBe(true);
      expect((call.expression as ts.Identifier).text).toBe("a");
      expect(call.arguments).toHaveLength(1);
      expect((call.arguments[0] as ts.Identifier).text).toBe("b");
    });
  });

  it("throws when the assembled template is not a valid expression", () => {
    withCtx((ctx) => {
      // `const` is a statement keyword — invalid in expression position.
      expect(() => quote(ctx)`const x = 1`).toThrow(/Failed to parse expression/);
    });
  });
});

// ===========================================================================
// quoteStatements
// ===========================================================================

describe("quoteStatements(ctx)", () => {
  it("returns a ts.Statement[] for a single statement", () => {
    withCtx((ctx) => {
      const stmts = quoteStatements(ctx)`const x = 1;`;
      expect(Array.isArray(stmts)).toBe(true);
      expect(stmts).toHaveLength(1);
      expect(ts.isVariableStatement(stmts[0])).toBe(true);
    });
  });

  it("returns multiple statements in source order", () => {
    withCtx((ctx) => {
      const stmts = quoteStatements(ctx)`const x = 1; const y = 2;`;
      expect(stmts).toHaveLength(2);
      expect(ts.isVariableStatement(stmts[0])).toBe(true);
      expect(ts.isVariableStatement(stmts[1])).toBe(true);
    });
  });

  it("flattens a SpreadSplice of statements", () => {
    withCtx((ctx) => {
      const s1 = ts.factory.createExpressionStatement(ts.factory.createIdentifier("first"));
      const s2 = ts.factory.createExpressionStatement(ts.factory.createIdentifier("second"));
      const stmts = quoteStatements(ctx)`${spread([s1, s2])} const tail = 0;`;
      expect(stmts).toHaveLength(3);
      expect(ts.isExpressionStatement(stmts[0])).toBe(true);
      expect(ts.isExpressionStatement(stmts[1])).toBe(true);
      expect(ts.isVariableStatement(stmts[2])).toBe(true);
      expect(((stmts[0] as ts.ExpressionStatement).expression as ts.Identifier).text).toBe("first");
      expect(((stmts[1] as ts.ExpressionStatement).expression as ts.Identifier).text).toBe(
        "second"
      );
    });
  });

  it("splices an identifier into a declaration name slot", () => {
    withCtx((ctx) => {
      const init = ts.factory.createNumericLiteral("9");
      const stmts = quoteStatements(ctx)`const ${ident("answer")} = ${init};`;
      expect(stmts).toHaveLength(1);
      const vs = stmts[0] as ts.VariableStatement;
      expect(ts.isVariableStatement(vs)).toBe(true);
      const decl = vs.declarationList.declarations[0];
      expect(ts.isIdentifier(decl.name)).toBe(true);
      expect((decl.name as ts.Identifier).text).toBe("answer");
      expect(ts.isNumericLiteral(decl.initializer!)).toBe(true);
    });
  });
});

// ===========================================================================
// quoteType
// ===========================================================================

describe("quoteType(ctx)", () => {
  it("parses a primitive type", () => {
    withCtx((ctx) => {
      const t = quoteType(ctx)`number`;
      expect(t.kind).toBe(ts.SyntaxKind.NumberKeyword);
    });
  });

  it("parses a generic type with a splice", () => {
    withCtx((ctx) => {
      const elem = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
      const t = quoteType(ctx)`Array<${elem}>`;
      expect(ts.isTypeReferenceNode(t)).toBe(true);
      const ref = t as ts.TypeReferenceNode;
      expect(ts.isIdentifier(ref.typeName)).toBe(true);
      expect((ref.typeName as ts.Identifier).text).toBe("Array");
      expect(ref.typeArguments).toBeDefined();
      expect(ref.typeArguments).toHaveLength(1);
      expect(ref.typeArguments![0].kind).toBe(ts.SyntaxKind.NumberKeyword);
    });
  });

  it("parses a function type", () => {
    withCtx((ctx) => {
      const t = quoteType(ctx)`(a: number) => string`;
      expect(ts.isFunctionTypeNode(t)).toBe(true);
      const fn = t as ts.FunctionTypeNode;
      expect(fn.parameters).toHaveLength(1);
      expect(fn.type.kind).toBe(ts.SyntaxKind.StringKeyword);
    });
  });

  it("parses a union type", () => {
    withCtx((ctx) => {
      const t = quoteType(ctx)`number | string`;
      expect(ts.isUnionTypeNode(t)).toBe(true);
      const u = t as ts.UnionTypeNode;
      expect(u.types).toHaveLength(2);
      expect(u.types[0].kind).toBe(ts.SyntaxKind.NumberKeyword);
      expect(u.types[1].kind).toBe(ts.SyntaxKind.StringKeyword);
    });
  });

  it("parses an intersection type", () => {
    withCtx((ctx) => {
      const t = quoteType(ctx)`{ a: number } & { b: string }`;
      expect(ts.isIntersectionTypeNode(t)).toBe(true);
      const i = t as ts.IntersectionTypeNode;
      expect(i.types).toHaveLength(2);
      expect(ts.isTypeLiteralNode(i.types[0])).toBe(true);
      expect(ts.isTypeLiteralNode(i.types[1])).toBe(true);
    });
  });

  it("throws on a malformed type template", () => {
    withCtx((ctx) => {
      expect(() => quoteType(ctx)`Array<`).toThrow(/Failed to parse type/);
    });
  });
});

// ===========================================================================
// quoteBlock
// ===========================================================================

describe("quoteBlock(ctx)", () => {
  it("returns a ts.Block containing the parsed statements", () => {
    withCtx((ctx) => {
      const b = quoteBlock(ctx)`const x = 1; return x;`;
      expect(ts.isBlock(b)).toBe(true);
      expect(b.statements).toHaveLength(2);
      expect(ts.isVariableStatement(b.statements[0])).toBe(true);
      expect(ts.isReturnStatement(b.statements[1])).toBe(true);
    });
  });

  it("returns an empty block for an empty template", () => {
    withCtx((ctx) => {
      const b = quoteBlock(ctx)``;
      expect(ts.isBlock(b)).toBe(true);
      expect(b.statements).toHaveLength(0);
    });
  });

  it("includes spread-spliced statements", () => {
    withCtx((ctx) => {
      const inner = ts.factory.createReturnStatement(ts.factory.createIdentifier("done"));
      const b = quoteBlock(ctx)`${spread([inner])}`;
      expect(ts.isBlock(b)).toBe(true);
      expect(b.statements).toHaveLength(1);
      expect(ts.isReturnStatement(b.statements[0])).toBe(true);
    });
  });
});

// ===========================================================================
// quoteCall / quotePropAccess / quoteMethodCall
// ===========================================================================

describe("quoteCall", () => {
  it("builds a CallExpression with a string callee parsed as an expression", () => {
    withCtx((ctx) => {
      const arg1 = ts.factory.createStringLiteral("hello");
      const arg2 = ts.factory.createNumericLiteral("42");
      const call = quoteCall(ctx, "console.log", [arg1, arg2]);
      expect(ts.isCallExpression(call)).toBe(true);
      expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
      const callee = call.expression as ts.PropertyAccessExpression;
      expect((callee.expression as ts.Identifier).text).toBe("console");
      expect(callee.name.text).toBe("log");
      expect(call.arguments).toHaveLength(2);
      expect(call.arguments[0]).toBe(arg1);
      expect(call.arguments[1]).toBe(arg2);
    });
  });

  it("accepts a pre-built Expression callee verbatim", () => {
    withCtx((ctx) => {
      const callee = ts.factory.createIdentifier("doit");
      const call = quoteCall(ctx, callee, []);
      expect(ts.isCallExpression(call)).toBe(true);
      expect(call.expression).toBe(callee);
      expect(call.arguments).toHaveLength(0);
      expect(call.typeArguments).toBeUndefined();
    });
  });

  it("passes through optional type arguments", () => {
    withCtx((ctx) => {
      const typeArg = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
      const call = quoteCall(ctx, "f", [], [typeArg]);
      expect(call.typeArguments).toBeDefined();
      expect(call.typeArguments).toHaveLength(1);
      expect(call.typeArguments![0].kind).toBe(ts.SyntaxKind.NumberKeyword);
    });
  });
});

describe("quotePropAccess", () => {
  it("builds a PropertyAccessExpression with the given property identifier", () => {
    withCtx((ctx) => {
      const obj = ts.factory.createIdentifier("xs");
      const access = quotePropAccess(ctx, obj, "length");
      expect(ts.isPropertyAccessExpression(access)).toBe(true);
      expect(access.expression).toBe(obj);
      expect(access.name.text).toBe("length");
    });
  });
});

describe("quoteMethodCall", () => {
  it("builds CallExpression over a PropertyAccessExpression", () => {
    withCtx((ctx) => {
      const obj = ts.factory.createIdentifier("o");
      const arg = ts.factory.createStringLiteral("k");
      const call = quoteMethodCall(ctx, obj, "get", [arg]);
      expect(ts.isCallExpression(call)).toBe(true);
      expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
      const pa = call.expression as ts.PropertyAccessExpression;
      expect(pa.expression).toBe(obj);
      expect(pa.name.text).toBe("get");
      expect(call.arguments).toHaveLength(1);
      expect(call.arguments[0]).toBe(arg);
    });
  });

  it("supports zero-argument method calls", () => {
    withCtx((ctx) => {
      const obj = ts.factory.createIdentifier("o");
      const call = quoteMethodCall(ctx, obj, "toString", []);
      expect(call.arguments).toHaveLength(0);
    });
  });
});

// ===========================================================================
// quoteConst / quoteLet
// ===========================================================================

describe("quoteConst / quoteLet", () => {
  it("quoteConst emits a VariableStatement with the Const flag set", () => {
    withCtx((ctx) => {
      const init = ts.factory.createNumericLiteral("1");
      const decl = quoteConst(ctx, "x", init);
      expect(ts.isVariableStatement(decl)).toBe(true);
      const flags = decl.declarationList.flags;
      expect(flags & ts.NodeFlags.Const).toBe(ts.NodeFlags.Const);
      expect(flags & ts.NodeFlags.Let).toBe(0);
      const d = decl.declarationList.declarations[0];
      expect((d.name as ts.Identifier).text).toBe("x");
      expect(d.initializer).toBe(init);
    });
  });

  it("quoteLet emits a VariableStatement with the Let flag set", () => {
    withCtx((ctx) => {
      const init = ts.factory.createNumericLiteral("2");
      const decl = quoteLet(ctx, "y", init);
      expect(ts.isVariableStatement(decl)).toBe(true);
      const flags = decl.declarationList.flags;
      expect(flags & ts.NodeFlags.Let).toBe(ts.NodeFlags.Let);
      expect(flags & ts.NodeFlags.Const).toBe(0);
    });
  });

  it("quoteLet allows omitting the initializer", () => {
    withCtx((ctx) => {
      const decl = quoteLet(ctx, "z");
      const d = decl.declarationList.declarations[0];
      expect(d.initializer).toBeUndefined();
    });
  });

  it("quoteConst accepts a pre-built Identifier", () => {
    withCtx((ctx) => {
      const nameId = ts.factory.createIdentifier("preBuilt");
      const decl = quoteConst(ctx, nameId, ts.factory.createNumericLiteral("0"));
      expect(decl.declarationList.declarations[0].name).toBe(nameId);
    });
  });

  it("quoteConst applies an optional type annotation", () => {
    withCtx((ctx) => {
      const typeAnn = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
      const decl = quoteConst(ctx, "x", ts.factory.createNumericLiteral("0"), typeAnn);
      const d = decl.declarationList.declarations[0];
      expect(d.type).toBe(typeAnn);
    });
  });
});

// ===========================================================================
// quoteReturn
// ===========================================================================

describe("quoteReturn", () => {
  it("builds a ReturnStatement with an expression", () => {
    withCtx((ctx) => {
      const expr = ts.factory.createIdentifier("v");
      const ret = quoteReturn(ctx, expr);
      expect(ts.isReturnStatement(ret)).toBe(true);
      expect(ret.expression).toBe(expr);
    });
  });

  it("builds a bare ReturnStatement when no expression is supplied", () => {
    withCtx((ctx) => {
      const ret = quoteReturn(ctx);
      expect(ts.isReturnStatement(ret)).toBe(true);
      expect(ret.expression).toBeUndefined();
    });
  });
});

// ===========================================================================
// quoteIf
// ===========================================================================

describe("quoteIf", () => {
  it("builds an IfStatement with single-statement bodies wrapped in blocks", () => {
    withCtx((ctx) => {
      const cond = ts.factory.createTrue();
      const thenStmt = ts.factory.createExpressionStatement(ts.factory.createIdentifier("t"));
      const ifs = quoteIf(ctx, cond, thenStmt);
      expect(ts.isIfStatement(ifs)).toBe(true);
      expect(ifs.expression).toBe(cond);
      expect(ts.isBlock(ifs.thenStatement)).toBe(true);
      expect((ifs.thenStatement as ts.Block).statements).toHaveLength(1);
      expect(ifs.elseStatement).toBeUndefined();
    });
  });

  it("includes an else branch when provided", () => {
    withCtx((ctx) => {
      const cond = ts.factory.createFalse();
      const thenStmt = ts.factory.createExpressionStatement(ts.factory.createIdentifier("t"));
      const elseStmt = ts.factory.createExpressionStatement(ts.factory.createIdentifier("e"));
      const ifs = quoteIf(ctx, cond, thenStmt, elseStmt);
      expect(ts.isBlock(ifs.thenStatement)).toBe(true);
      expect(ifs.elseStatement).toBeDefined();
      expect(ts.isBlock(ifs.elseStatement!)).toBe(true);
    });
  });

  it("accepts an array body and produces a block of those statements", () => {
    withCtx((ctx) => {
      const cond = ts.factory.createTrue();
      const s1 = ts.factory.createExpressionStatement(ts.factory.createIdentifier("a"));
      const s2 = ts.factory.createExpressionStatement(ts.factory.createIdentifier("b"));
      const ifs = quoteIf(ctx, cond, [s1, s2]);
      expect(ts.isBlock(ifs.thenStatement)).toBe(true);
      expect((ifs.thenStatement as ts.Block).statements).toHaveLength(2);
    });
  });

  it("reuses an existing Block body without re-wrapping", () => {
    withCtx((ctx) => {
      const cond = ts.factory.createTrue();
      const block = ts.factory.createBlock(
        [ts.factory.createExpressionStatement(ts.factory.createIdentifier("a"))],
        true
      );
      const ifs = quoteIf(ctx, cond, block);
      expect(ifs.thenStatement).toBe(block);
    });
  });
});

// ===========================================================================
// quoteArrow
// ===========================================================================

describe("quoteArrow", () => {
  it("builds an ArrowFunction with string-named parameters", () => {
    withCtx((ctx) => {
      const body = ts.factory.createIdentifier("x");
      const arrow = quoteArrow(ctx, ["x"], body);
      expect(ts.isArrowFunction(arrow)).toBe(true);
      expect(arrow.parameters).toHaveLength(1);
      const p = arrow.parameters[0];
      expect(ts.isIdentifier(p.name)).toBe(true);
      expect((p.name as ts.Identifier).text).toBe("x");
      expect(arrow.body).toBe(body);
      expect(arrow.equalsGreaterThanToken.kind).toBe(ts.SyntaxKind.EqualsGreaterThanToken);
    });
  });

  it("supports a Block body", () => {
    withCtx((ctx) => {
      const block = ts.factory.createBlock(
        [ts.factory.createReturnStatement(ts.factory.createNumericLiteral("0"))],
        true
      );
      const arrow = quoteArrow(ctx, [], block);
      expect(ts.isBlock(arrow.body)).toBe(true);
    });
  });

  it("preserves pre-built parameter declarations", () => {
    withCtx((ctx) => {
      const pre = ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        ts.factory.createIdentifier("z"),
        undefined,
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
      );
      const arrow = quoteArrow(ctx, [pre], ts.factory.createIdentifier("z"));
      expect(arrow.parameters[0]).toBe(pre);
    });
  });

  it("attaches an optional return type", () => {
    withCtx((ctx) => {
      const ret = ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
      const arrow = quoteArrow(ctx, ["x"], ts.factory.createStringLiteral("ok"), undefined, ret);
      expect(arrow.type).toBe(ret);
    });
  });
});

// ===========================================================================
// quoteFunction
// ===========================================================================

describe("quoteFunction", () => {
  it("builds a FunctionDeclaration with no modifiers by default", () => {
    withCtx((ctx) => {
      const fn = quoteFunction(
        ctx,
        "doIt",
        [{ name: "a" }],
        [ts.factory.createReturnStatement(ts.factory.createIdentifier("a"))]
      );
      expect(ts.isFunctionDeclaration(fn)).toBe(true);
      expect(fn.name?.text).toBe("doIt");
      expect(fn.parameters).toHaveLength(1);
      expect((fn.parameters[0].name as ts.Identifier).text).toBe("a");
      expect(fn.modifiers).toBeUndefined();
      expect(fn.type).toBeUndefined();
      expect(ts.isBlock(fn.body!)).toBe(true);
      expect(fn.body!.statements).toHaveLength(1);
    });
  });

  it("emits an exported modifier when options.exported is true", () => {
    withCtx((ctx) => {
      const fn = quoteFunction(ctx, "ex", [], [], { exported: true });
      expect(fn.modifiers).toBeDefined();
      expect(fn.modifiers).toHaveLength(1);
      expect(fn.modifiers![0].kind).toBe(ts.SyntaxKind.ExportKeyword);
    });
  });

  it("attaches a return type when supplied", () => {
    withCtx((ctx) => {
      const retTy = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
      const fn = quoteFunction(ctx, "n", [], [], { returnType: retTy });
      expect(fn.type).toBe(retTy);
    });
  });

  it("encodes optional + typed parameters", () => {
    withCtx((ctx) => {
      const typeAnn = ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
      const fn = quoteFunction(ctx, "f", [{ name: "x", type: typeAnn, optional: true }], []);
      const p = fn.parameters[0];
      expect((p.name as ts.Identifier).text).toBe("x");
      expect(p.type).toBe(typeAnn);
      expect(p.questionToken).toBeDefined();
      expect(p.questionToken!.kind).toBe(ts.SyntaxKind.QuestionToken);
    });
  });

  it("passes through type parameters", () => {
    withCtx((ctx) => {
      const tp = ts.factory.createTypeParameterDeclaration(
        undefined,
        ts.factory.createIdentifier("T")
      );
      const fn = quoteFunction(ctx, "g", [], [], { typeParams: [tp] });
      expect(fn.typeParameters).toBeDefined();
      expect(fn.typeParameters).toHaveLength(1);
      expect(fn.typeParameters![0]).toBe(tp);
    });
  });
});

// ===========================================================================
// Edge cases: arity mismatches between strings and splices
// ===========================================================================

describe("template/splice arity", () => {
  it("concatenates extra splices after the final string segment", () => {
    // A tagged template always has strings.length === splices.length + 1.
    // Manually calling the underlying tag with too many splices reveals the
    // assembler's actual behavior: it loops over `strings.length`, and the
    // splice at the same index as the last string is concatenated to that
    // trailing empty string. With strings ["", " + ", ""] and splices
    // [1, 2, 999], the assembled text is "1 + 2999" (a single numeric
    // literal on the right).
    withCtx((ctx) => {
      const tag = quote(ctx);
      const strings = Object.assign(["", " + ", ""], {
        raw: ["", " + ", ""],
      }) as unknown as TemplateStringsArray;
      const expr = tag(
        strings,
        ts.factory.createNumericLiteral("1"),
        ts.factory.createNumericLiteral("2"),
        ts.factory.createNumericLiteral("999")
      );
      expect(ts.isBinaryExpression(expr)).toBe(true);
      const bin = expr as ts.BinaryExpression;
      expect((bin.left as ts.NumericLiteral).text).toBe("1");
      // Splice 3 is concatenated onto splice 2's trailing slot — yielding 2999.
      expect((bin.right as ts.NumericLiteral).text).toBe("2999");
    });
  });

  it("throws when fewer splices than slots leaves a malformed template", () => {
    // Fewer splices than slots: the assembler walks all string segments but
    // skips the splice for slots without a corresponding arg. With strings
    // ["1 + ", ""] and zero splices, assembled text is "1 + " which is not
    // a valid expression and must throw.
    withCtx((ctx) => {
      const tag = quote(ctx);
      const strings = Object.assign(["1 + ", ""], {
        raw: ["1 + ", ""],
      }) as unknown as TemplateStringsArray;
      expect(() => tag(strings)).toThrow(/Failed to parse expression/);
    });
  });
});
