/**
 * Tests for typeclass-based operator overloading via Op<> annotations.
 *
 * Tests:
 * 1. Op<> extraction from return types
 * 2. Syntax registry population
 * 3. Operator → method resolution
 * 4. Ambiguity detection
 * 5. OPERATOR_SYMBOLS and OperatorSymbol definitions
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  typeclassRegistry,
  syntaxRegistry,
  registerTypeclassSyntax,
  getSyntaxForOperator,
  clearSyntaxRegistry,
  extractOpFromReturnType,
  type TypeclassInfo,
  type TypeclassMethod,
  type SyntaxEntry,
} from "../src/macros/typeclass.js";
import { getOperatorString } from "../src/macros/operators.js";
import { OPERATOR_SYMBOLS, type OperatorSymbol } from "../src/core/types.js";

// ============================================================================
// OPERATOR_SYMBOLS and OperatorSymbol
// ============================================================================

describe("OPERATOR_SYMBOLS", () => {
  it("should contain all standard arithmetic operators", () => {
    expect(OPERATOR_SYMBOLS).toContain("+");
    expect(OPERATOR_SYMBOLS).toContain("-");
    expect(OPERATOR_SYMBOLS).toContain("*");
    expect(OPERATOR_SYMBOLS).toContain("/");
    expect(OPERATOR_SYMBOLS).toContain("%");
    expect(OPERATOR_SYMBOLS).toContain("**");
  });

  it("should contain all comparison operators", () => {
    expect(OPERATOR_SYMBOLS).toContain("<");
    expect(OPERATOR_SYMBOLS).toContain("<=");
    expect(OPERATOR_SYMBOLS).toContain(">");
    expect(OPERATOR_SYMBOLS).toContain(">=");
    expect(OPERATOR_SYMBOLS).toContain("==");
    expect(OPERATOR_SYMBOLS).toContain("===");
    expect(OPERATOR_SYMBOLS).toContain("!=");
    expect(OPERATOR_SYMBOLS).toContain("!==");
  });

  it("should contain bitwise operators", () => {
    expect(OPERATOR_SYMBOLS).toContain("&");
    expect(OPERATOR_SYMBOLS).toContain("|");
    expect(OPERATOR_SYMBOLS).toContain("^");
    expect(OPERATOR_SYMBOLS).toContain("<<");
    expect(OPERATOR_SYMBOLS).toContain(">>");
  });

  it("should have exactly 19 operators", () => {
    expect(OPERATOR_SYMBOLS).toHaveLength(19);
  });
});

// ============================================================================
// getOperatorString — SyntaxKind to string
// ============================================================================

describe("getOperatorString", () => {
  it("should map PlusToken to '+'", () => {
    expect(getOperatorString(ts.SyntaxKind.PlusToken)).toBe("+");
  });

  it("should map AsteriskAsteriskToken to '**'", () => {
    expect(getOperatorString(ts.SyntaxKind.AsteriskAsteriskToken)).toBe("**");
  });

  it("should map EqualsEqualsEqualsToken to '==='", () => {
    expect(getOperatorString(ts.SyntaxKind.EqualsEqualsEqualsToken)).toBe("===");
  });

  it("should return undefined for non-overloadable tokens", () => {
    expect(getOperatorString(ts.SyntaxKind.EqualsToken)).toBeUndefined();
    expect(getOperatorString(ts.SyntaxKind.PlusEqualsToken)).toBeUndefined();
  });

  it("should cover every OPERATOR_SYMBOL", () => {
    const syntaxKinds: ts.SyntaxKind[] = [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.AsteriskAsteriskToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.AmpersandToken,
      ts.SyntaxKind.BarToken,
      ts.SyntaxKind.CaretToken,
      ts.SyntaxKind.LessThanLessThanToken,
      ts.SyntaxKind.GreaterThanGreaterThanToken,
    ];

    const mapped = syntaxKinds.map(getOperatorString).filter((s): s is string => s !== undefined);

    expect(mapped).toHaveLength(OPERATOR_SYMBOLS.length);
    for (const sym of OPERATOR_SYMBOLS) {
      expect(mapped).toContain(sym);
    }
  });
});

// ============================================================================
// Syntax Registry
// ============================================================================

describe("syntax registry", () => {
  beforeEach(() => {
    clearSyntaxRegistry();
  });

  it("should start empty", () => {
    expect(getSyntaxForOperator("+")).toBeUndefined();
  });

  it("should register and retrieve operator mappings", () => {
    const syntax = new Map<string, string>([["+" as string, "concat"]]);
    registerTypeclassSyntax("Semigroup", syntax);

    const entries = getSyntaxForOperator("+");
    expect(entries).toBeDefined();
    expect(entries).toHaveLength(1);
    expect(entries![0]).toEqual({ typeclass: "Semigroup", method: "concat" });
  });

  it("should support multiple typeclasses for the same operator", () => {
    registerTypeclassSyntax("Semigroup", new Map<string, string>([["+" as string, "concat"]]));
    registerTypeclassSyntax("Num", new Map<string, string>([["+" as string, "add"]]));

    const entries = getSyntaxForOperator("+");
    expect(entries).toHaveLength(2);
    expect(entries!.map((e) => e.typeclass)).toContain("Semigroup");
    expect(entries!.map((e) => e.typeclass)).toContain("Num");
  });

  it("should support multiple operators for one typeclass", () => {
    registerTypeclassSyntax(
      "Eq",
      new Map<string, string>([
        ["===" as string, "eq"],
        ["!==" as string, "neq"],
      ])
    );

    expect(getSyntaxForOperator("===")).toHaveLength(1);
    expect(getSyntaxForOperator("!==")).toHaveLength(1);
    expect(getSyntaxForOperator("===")![0].method).toBe("eq");
    expect(getSyntaxForOperator("!==")![0].method).toBe("neq");
  });

  it("should clear all entries", () => {
    registerTypeclassSyntax("Semigroup", new Map<string, string>([["+" as string, "concat"]]));
    clearSyntaxRegistry();
    expect(getSyntaxForOperator("+")).toBeUndefined();
  });
});

// ============================================================================
// TypeclassMethod.operatorSymbol field
// ============================================================================

describe("TypeclassMethod.operatorSymbol", () => {
  it("should be optional and default to undefined", () => {
    const method: TypeclassMethod = {
      name: "show",
      params: [{ name: "a", typeString: "A" }],
      returnType: "string",
      isSelfMethod: true,
    };
    expect(method.operatorSymbol).toBeUndefined();
  });

  it("should store an operator symbol when set", () => {
    const method: TypeclassMethod = {
      name: "concat",
      params: [
        { name: "a", typeString: "A" },
        { name: "b", typeString: "A" },
      ],
      returnType: "A",
      isSelfMethod: true,
      operatorSymbol: "+",
    };
    expect(method.operatorSymbol).toBe("+");
  });
});

// ============================================================================
// TypeclassInfo.syntax field
// ============================================================================

describe("TypeclassInfo.syntax", () => {
  it("should be optional", () => {
    const tc: TypeclassInfo = {
      name: "Show",
      typeParam: "A",
      methods: [],
      canDeriveProduct: true,
      canDeriveSum: true,
    };
    expect(tc.syntax).toBeUndefined();
  });

  it("should store operator->method mappings", () => {
    const syntax = new Map<string, string>([
      ["+", "concat"],
      ["===", "eq"],
    ]);

    const tc: TypeclassInfo = {
      name: "Semigroup",
      typeParam: "A",
      methods: [
        {
          name: "concat",
          params: [
            { name: "a", typeString: "A" },
            { name: "b", typeString: "A" },
          ],
          returnType: "A",
          isSelfMethod: true,
          operatorSymbol: "+",
        },
      ],
      canDeriveProduct: true,
      canDeriveSum: true,
      syntax,
    };

    expect(tc.syntax!.get("+")).toBe("concat");
    expect(tc.syntax!.get("===")).toBe("eq");
  });
});

// ============================================================================
// extractOpFromReturnType — AST-level Op<> extraction
// ============================================================================

describe("extractOpFromReturnType", () => {
  function parseReturnType(code: string): ts.TypeNode | undefined {
    const src = ts.createSourceFile("test.ts", `type T = ${code};`, ts.ScriptTarget.Latest, true);
    const stmt = src.statements[0];
    if (ts.isTypeAliasDeclaration(stmt)) {
      return stmt.type;
    }
    return undefined;
  }

  it("should return undefined operatorSymbol for plain types", () => {
    const typeNode = parseReturnType("string");
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBeUndefined();
    expect(result.cleanReturnType).toBe("string");
  });

  it("should return undefined operatorSymbol for undefined input", () => {
    const result = extractOpFromReturnType(undefined);
    expect(result.operatorSymbol).toBeUndefined();
    expect(result.cleanReturnType).toBe("void");
  });

  it('should extract operator from A & Op<"+">', () => {
    const typeNode = parseReturnType('A & Op<"+">');
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBe("+");
    expect(result.cleanReturnType).toBe("A");
  });

  it('should extract operator from boolean & Op<"===">', () => {
    const typeNode = parseReturnType('boolean & Op<"===">');
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBe("===");
    expect(result.cleanReturnType).toBe("boolean");
  });

  it("should reject invalid operator symbols", () => {
    const typeNode = parseReturnType('A & Op<"invalid">');
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBeUndefined();
  });

  it("should handle intersection types without Op<>", () => {
    const typeNode = parseReturnType("A & B");
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBeUndefined();
    expect(result.cleanReturnType).toBe("A & B");
  });

  it("should handle intersection with Op<> and other types", () => {
    const typeNode = parseReturnType('A & Serializable & Op<"*">');
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBe("*");
    expect(result.cleanReturnType).toBe("A & Serializable");
  });

  it("should extract ** operator", () => {
    const typeNode = parseReturnType('number & Op<"**">');
    const result = extractOpFromReturnType(typeNode);
    expect(result.operatorSymbol).toBe("**");
    expect(result.cleanReturnType).toBe("number");
  });
});
