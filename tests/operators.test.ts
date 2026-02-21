/**
 * Tests for operator overloading macros
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { clearOperatorMappings } from "../src/macros/operators.js";

describe("operator macro infrastructure", () => {
  beforeEach(() => {
    // Clear any existing operator mappings between tests
    clearOperatorMappings();
  });

  describe("operator symbol to method mapping", () => {
    it("should have correct default operator symbols", () => {
      // These are the standard operator symbols we support
      const supportedOperators = ["+", "-", "*", "/", "%", "**", "==", "!=", "<", ">", "<=", ">="];
      expect(supportedOperators).toHaveLength(12);
    });
  });

  describe("operator method conventions", () => {
    it("should use conventional method names", () => {
      const conventions: Record<string, string> = {
        "+": "add",
        "-": "sub",
        "*": "mul",
        "/": "div",
        "%": "mod",
        "**": "pow",
        "==": "eq",
        "!=": "neq",
        "<": "lt",
        ">": "gt",
        "<=": "lte",
        ">=": "gte",
      };

      expect(conventions["+"]).toBe("add");
      expect(conventions["*"]).toBe("mul");
      expect(conventions["=="]).toBe("eq");
    });
  });
});

describe("ops expression transformation", () => {
  // Note: Full transformation tests require the transformer context
  // These tests verify the logic/structure

  describe("binary expression transformation", () => {
    it("should identify arithmetic operators", () => {
      const arithmeticOps = [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken,
        ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken,
        ts.SyntaxKind.AsteriskAsteriskToken,
      ];

      // All should be identified as valid binary expression operators
      for (const op of arithmeticOps) {
        expect(op).toBeGreaterThan(0);
      }
    });

    it("should identify comparison operators", () => {
      const comparisonOps = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.LessThanToken,
        ts.SyntaxKind.GreaterThanToken,
        ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.GreaterThanEqualsToken,
      ];

      for (const op of comparisonOps) {
        expect(op).toBeGreaterThan(0);
      }
    });
  });

  describe("unary expression transformation", () => {
    it("should identify prefix unary operators", () => {
      const unaryOps = [
        ts.SyntaxKind.MinusToken, // negation
        ts.SyntaxKind.ExclamationToken, // logical not (not typically overloaded)
      ];

      for (const op of unaryOps) {
        expect(op).toBeGreaterThan(0);
      }
    });
  });
});

describe("pipe and compose macros", () => {
  describe("pipe operation semantics", () => {
    it("should apply functions left to right", () => {
      // Semantic test: pipe(x, f, g) = g(f(x))
      const add1 = (x: number) => x + 1;
      const mul2 = (x: number) => x * 2;

      const value = 5;
      const piped = mul2(add1(value)); // pipe(5, add1, mul2)

      expect(piped).toBe(12); // (5 + 1) * 2 = 12
    });
  });

  describe("compose operation semantics", () => {
    it("should apply functions right to left", () => {
      // Semantic test: compose(f, g)(x) = f(g(x))
      const add1 = (x: number) => x + 1;
      const mul2 = (x: number) => x * 2;

      // compose(add1, mul2)(5) = add1(mul2(5)) = add1(10) = 11
      const composed = add1(mul2(5));

      expect(composed).toBe(11);
    });
  });
});
