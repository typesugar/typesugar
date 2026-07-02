/**
 * Tests for typeclass-based operator overloading via @op JSDoc annotations.
 *
 * Tests:
 * 1. getOperatorString — SyntaxKind to string mapping
 * 2. Syntax registry population
 * 3. Operator → method resolution
 * 4. TypeclassMethod.operatorSymbol field
 * 5. TypeclassInfo.syntax field
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { type TypeclassInfo, type TypeclassMethod, getOperatorString } from "@typesugar/macros";

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

  it("should cover all overloadable operator symbols", () => {
    const expectedOperators = [
      "+",
      "-",
      "*",
      "/",
      "%",
      "**",
      "<",
      "<=",
      ">",
      ">=",
      "==",
      "===",
      "!=",
      "!==",
      "&",
      "|",
      "^",
      "<<",
      ">>",
    ];

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

    expect(mapped).toHaveLength(expectedOperators.length);
    for (const sym of expectedOperators) {
      expect(mapped).toContain(sym);
    }
  });
});

// Operator→typeclass syntax resolution is now scope-based via the op-index
// (getOperatorCandidates / getOpMapForTypeclass), not the global typeclassRegistry;
// the old getSyntaxForOperator mechanism was deleted (PEP-052). The op-index path is
// covered by the operator-rewrite integration tests.

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

// extractOpFromReturnType — Op<> was removed; operator dispatch now uses @op JSDoc only.
// Tests for Op<> parsing have been removed.
// The syntax registry and @op JSDoc extraction are tested elsewhere.
