/**
 * Tests for the quasiquoting system (quote, quoteStatements, quoteType, etc.)
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
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
} from "../src/macros/quote.js";

describe("quasiquoting system", () => {
  let ctx: MacroContextImpl;
  let printer: ts.Printer;

  function printExpr(node: ts.Expression): string {
    return printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
  }

  function printStmt(node: ts.Statement): string {
    return printer.printNode(ts.EmitHint.Unspecified, node, ctx.sourceFile);
  }

  function printType(node: ts.TypeNode): string {
    return printer.printNode(ts.EmitHint.Unspecified, node, ctx.sourceFile);
  }

  beforeEach(() => {
    const sourceText = "const x = 1;";
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

    ctx = createMacroContext(program, sourceFile, transformContext);
    printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  });

  // ===========================================================================
  // quote() — Expression quasiquoting
  // ===========================================================================

  describe("quote() — expression quasiquoting", () => {
    it("should create a simple expression from a template", () => {
      const result = quote(ctx)`1 + 2`;
      expect(printExpr(result)).toBe("1 + 2");
    });

    it("should splice expression nodes", () => {
      const left = ts.factory.createNumericLiteral(5);
      const right = ts.factory.createNumericLiteral(3);
      const result = quote(ctx)`${left} + ${right}`;
      expect(printExpr(result)).toBe("5 + 3");
    });

    it("should splice string values as source code", () => {
      const varName = "myVariable";
      const result = quote(ctx)`${varName}.toString()`;
      expect(printExpr(result)).toBe("myVariable.toString()");
    });

    it("should splice number values as literals", () => {
      const count = 42;
      const result = quote(ctx)`[${count}]`;
      expect(printExpr(result)).toBe("[42]");
    });

    it("should splice boolean values", () => {
      const flag = true;
      const result = quote(ctx)`${flag} && x`;
      expect(printExpr(result)).toBe("true && x");
    });

    it("should splice identifier nodes", () => {
      const id = ts.factory.createIdentifier("foo");
      const result = quote(ctx)`${id}.bar`;
      expect(printExpr(result)).toBe("foo.bar");
    });

    it("should handle complex nested expressions", () => {
      const arr = ts.factory.createIdentifier("items");
      const fn = ts.factory.createIdentifier("transform");
      const result = quote(ctx)`${arr}.map(x => ${fn}(x))`;
      expect(printExpr(result)).toBe("items.map(x => transform(x))");
    });

    it("should handle ident() splice for string-to-identifier", () => {
      const name = ident("myFunc");
      const result = quote(ctx)`${name}(42)`;
      expect(printExpr(result)).toBe("myFunc(42)");
    });

    it("should handle raw() splice for unhygienic names", () => {
      const name = raw("result");
      // raw() inserts the string as-is into an expression context
      const result = quote(ctx)`${name}(42)`;
      expect(printExpr(result)).toContain("result");
      expect(printExpr(result)).toContain("42");
    });

    it("should handle object literal templates", () => {
      const key = "name";
      const value = ts.factory.createStringLiteral("hello");
      const result = quote(ctx)`{ ${key}: ${value} }`;
      expect(printExpr(result)).toBe('{ name: "hello" }');
    });

    it("should throw on malformed expression templates", () => {
      expect(() => {
        quote(ctx)`if (true) {`;
      }).toThrow("Failed to parse expression");
    });
  });

  // ===========================================================================
  // quoteStatements() — Statement quasiquoting
  // ===========================================================================

  describe("quoteStatements() — statement quasiquoting", () => {
    it("should parse a single statement", () => {
      const stmts = quoteStatements(ctx)`const x = 42;`;
      expect(stmts).toHaveLength(1);
      expect(printStmt(stmts[0])).toContain("const x = 42");
    });

    it("should parse multiple statements", () => {
      const stmts = quoteStatements(ctx)`
        const a = 1;
        const b = 2;
        const c = a + b;
      `;
      expect(stmts).toHaveLength(3);
    });

    it("should splice expressions into statements", () => {
      const name = "myVar";
      const init = ts.factory.createNumericLiteral(99);
      const stmts = quoteStatements(ctx)`const ${name} = ${init};`;
      expect(stmts).toHaveLength(1);
      expect(printStmt(stmts[0])).toContain("99");
    });

    it("should handle function declarations", () => {
      const fnName = "greet";
      const stmts = quoteStatements(ctx)`
        function ${fnName}(name: string): string {
          return "Hello, " + name;
        }
      `;
      expect(stmts).toHaveLength(1);
      expect(printStmt(stmts[0])).toContain("greet");
    });

    it("should handle if/else statements", () => {
      const cond = ts.factory.createIdentifier("isReady");
      const stmts = quoteStatements(ctx)`
        if (${cond}) {
          console.log("ready");
        } else {
          console.log("not ready");
        }
      `;
      expect(stmts).toHaveLength(1);
      expect(printStmt(stmts[0])).toContain("isReady");
    });
  });

  // ===========================================================================
  // quoteType() — Type quasiquoting
  // ===========================================================================

  describe("quoteType() — type quasiquoting", () => {
    it("should parse a simple type", () => {
      const typeNode = quoteType(ctx)`string`;
      expect(printType(typeNode)).toBe("string");
    });

    it("should parse a generic type", () => {
      const elementType = "number";
      const typeNode = quoteType(ctx)`Array<${elementType}>`;
      expect(printType(typeNode)).toBe("Array<number>");
    });

    it("should parse union types", () => {
      const typeNode = quoteType(ctx)`string | number | boolean`;
      expect(printType(typeNode)).toBe("string | number | boolean");
    });

    it("should parse object types", () => {
      const fieldType = "string";
      const typeNode = quoteType(ctx)`{ name: ${fieldType}; age: number }`;
      expect(printType(typeNode)).toContain("name");
      expect(printType(typeNode)).toContain("age");
    });

    it("should parse function types", () => {
      const typeNode = quoteType(ctx)`(x: number) => string`;
      expect(printType(typeNode)).toContain("number");
      expect(printType(typeNode)).toContain("string");
    });

    it("should throw on malformed type templates", () => {
      expect(() => {
        quoteType(ctx)`if (true)`;
      }).toThrow();
    });
  });

  // ===========================================================================
  // quoteBlock() — Block quasiquoting
  // ===========================================================================

  describe("quoteBlock() — block quasiquoting", () => {
    it("should create a block from statements", () => {
      const block = quoteBlock(ctx)`
        const x = 1;
        return x;
      `;
      expect(ts.isBlock(block)).toBe(true);
      expect(block.statements).toHaveLength(2);
    });

    it("should splice into blocks", () => {
      const value = ts.factory.createNumericLiteral(42);
      const block = quoteBlock(ctx)`
        const result = ${value};
        return result;
      `;
      expect(block.statements).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Convenience builders
  // ===========================================================================

  describe("quoteCall()", () => {
    it("should create a function call", () => {
      const result = quoteCall(ctx, "console.log", [ts.factory.createStringLiteral("hello")]);
      expect(ts.isCallExpression(result)).toBe(true);
      expect(printExpr(result)).toBe('console.log("hello")');
    });

    it("should handle expression callee", () => {
      const callee = ts.factory.createIdentifier("myFunc");
      const result = quoteCall(ctx, callee, [ts.factory.createNumericLiteral(42)]);
      expect(printExpr(result)).toBe("myFunc(42)");
    });
  });

  describe("quotePropAccess()", () => {
    it("should create property access", () => {
      const obj = ts.factory.createIdentifier("obj");
      const result = quotePropAccess(ctx, obj, "length");
      expect(printExpr(result)).toBe("obj.length");
    });
  });

  describe("quoteMethodCall()", () => {
    it("should create a method call", () => {
      const obj = ts.factory.createIdentifier("arr");
      const result = quoteMethodCall(ctx, obj, "push", [ts.factory.createNumericLiteral(1)]);
      expect(printExpr(result)).toBe("arr.push(1)");
    });
  });

  describe("quoteConst()", () => {
    it("should create a const declaration", () => {
      const result = quoteConst(ctx, "x", ts.factory.createNumericLiteral(42));
      expect(ts.isVariableStatement(result)).toBe(true);
      expect(printStmt(result)).toContain("const x = 42");
    });

    it("should accept an Identifier for the name", () => {
      const id = ts.factory.createIdentifier("myVar");
      const result = quoteConst(ctx, id, ts.factory.createTrue());
      expect(printStmt(result)).toContain("myVar");
      expect(printStmt(result)).toContain("true");
    });
  });

  describe("quoteLet()", () => {
    it("should create a let declaration", () => {
      const result = quoteLet(ctx, "count", ts.factory.createNumericLiteral(0));
      expect(printStmt(result)).toContain("let count = 0");
    });

    it("should handle declaration without initializer", () => {
      const result = quoteLet(ctx, "x");
      expect(printStmt(result)).toContain("let x");
    });
  });

  describe("quoteReturn()", () => {
    it("should create a return statement with expression", () => {
      const result = quoteReturn(ctx, ts.factory.createNumericLiteral(42));
      expect(printStmt(result)).toContain("return 42");
    });

    it("should create a bare return", () => {
      const result = quoteReturn(ctx);
      expect(printStmt(result)).toContain("return");
    });
  });

  describe("quoteIf()", () => {
    it("should create an if statement", () => {
      const cond = ts.factory.createTrue();
      const thenStmt = quoteReturn(ctx, ts.factory.createNumericLiteral(1));
      const result = quoteIf(ctx, cond, thenStmt);
      const text = printStmt(result);
      expect(text).toContain("if (true)");
      expect(text).toContain("return 1");
    });

    it("should create an if/else statement", () => {
      const cond = ts.factory.createIdentifier("flag");
      const thenStmt = quoteReturn(ctx, ts.factory.createNumericLiteral(1));
      const elseStmt = quoteReturn(ctx, ts.factory.createNumericLiteral(0));
      const result = quoteIf(ctx, cond, thenStmt, elseStmt);
      const text = printStmt(result);
      expect(text).toContain("if (flag)");
      expect(text).toContain("return 1");
      expect(text).toContain("return 0");
    });
  });

  describe("quoteArrow()", () => {
    it("should create an arrow function with expression body", () => {
      const body = quote(ctx)`x * 2`;
      const result = quoteArrow(ctx, ["x"], body);
      expect(printExpr(result)).toContain("=>");
      expect(printExpr(result)).toContain("x * 2");
    });

    it("should create an arrow function with block body", () => {
      const body = quoteBlock(ctx)`return x * 2;`;
      const result = quoteArrow(ctx, ["x"], body);
      expect(printExpr(result)).toContain("=>");
      expect(printExpr(result)).toContain("return x * 2");
    });
  });

  describe("quoteFunction()", () => {
    it("should create a function declaration", () => {
      const body = [quoteReturn(ctx, ts.factory.createNumericLiteral(42))];
      const result = quoteFunction(ctx, "getAnswer", [], body);
      const text = printStmt(result);
      expect(text).toContain("function getAnswer()");
      expect(text).toContain("return 42");
    });

    it("should create an exported function with params", () => {
      const returnExpr = quote(ctx)`a + b`;
      const body = [ctx.factory.createReturnStatement(returnExpr)];
      const result = quoteFunction(
        ctx,
        "add",
        [
          { name: "a", type: quoteType(ctx)`number` },
          { name: "b", type: quoteType(ctx)`number` },
        ],
        body,
        {
          returnType: quoteType(ctx)`number`,
          exported: true,
        }
      );
      const text = printStmt(result);
      expect(text).toContain("export");
      expect(text).toContain("function add");
      expect(text).toContain("a: number");
      expect(text).toContain("b: number");
    });
  });

  // ===========================================================================
  // Splice wrapper types
  // ===========================================================================

  describe("splice wrappers", () => {
    it("SpreadSplice should wrap statement arrays", () => {
      const stmts = [
        ctx.factory.createExpressionStatement(
          ts.factory.createCallExpression(ts.factory.createIdentifier("foo"), undefined, [])
        ),
      ];
      const s = spread(stmts);
      expect(s).toBeInstanceOf(SpreadSplice);
      expect(s.nodes).toBe(stmts);
    });
  });
});
