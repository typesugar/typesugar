/**
 * Red Team Tests for @typesugar/contracts
 *
 * Focus areas:
 * - Prover edge cases (linear arithmetic, algebraic rules)
 * - Floating point precision
 * - Malformed inputs
 * - Variable name edge cases
 * - Negation handling
 */

import { describe, it, expect } from "vitest";
import {
  tryLinearArithmetic,
  tryLinearProof,
  trySimpleLinearProof,
  type TypeFact,
} from "../packages/contracts/src/prover/linear.js";
import {
  tryAlgebraicProof,
  registerAlgebraicRule,
} from "../packages/contracts/src/prover/algebra.js";
import {
  extractTypeFacts,
  registerRefinementPredicate,
} from "../packages/contracts/src/prover/type-facts.js";

describe("Linear Arithmetic Prover Edge Cases", () => {
  // ==========================================================================
  // Floating point precision
  // ==========================================================================
  describe("Floating point precision", () => {
    it("0.1 + 0.2 != 0.3 in floating point", () => {
      // Classic floating point issue
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0.1" },
        { variable: "y", predicate: "y >= 0.2" },
      ];

      // Can we prove x + y >= 0.3?
      const result = tryLinearArithmetic("x + y >= 0.3", facts);
      // 0.1 + 0.2 = 0.30000000000000004, not 0.3
      // The prover should handle this but might have precision issues
      expect(result.proven).toBe(true);
    });

    it("Very small numbers (underflow territory)", () => {
      // FIXED: Scientific notation now supported in prover regex
      // See Finding #10 in FINDINGS.md
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 1e-300" }];

      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("Very large numbers (overflow territory)", () => {
      // FIXED: Scientific notation now supported in prover regex
      // See Finding #10 in FINDINGS.md
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 1e308" }];

      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("Infinity in predicates", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= Infinity" }];

      // This should probably not parse correctly
      const result = tryLinearArithmetic("x > 0", facts);
      // Depends on how parseFloat handles "Infinity"
    });

    it("NaN in predicates", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= NaN" }];

      const result = tryLinearArithmetic("x > 0", facts);
      // NaN comparisons are always false
    });

    it("Negative zero", () => {
      // FIXED: Bound implication handles -0 correctly (-0 >= 0 is true)
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= -0" }];

      const result = tryLinearArithmetic("x >= 0", facts);
      // x >= -0 implies x >= 0 (since -0 >= 0 in IEEE floating point)
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Malformed inputs
  // ==========================================================================
  describe("Malformed inputs", () => {
    it("Empty predicate", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "" }];

      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("Whitespace-only predicate", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "   " }];

      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("Invalid operator", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >== 0" }];

      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("Unicode in variable names", () => {
      // FIXED: Unicode variable names now fully supported
      // See Finding #11 in FINDINGS.md
      const facts: TypeFact[] = [{ variable: "αβγ", predicate: "αβγ > 0" }];

      // Direct match works
      const result = tryLinearArithmetic("αβγ > 0", facts);
      expect(result.proven).toBe(true);

      // Bound implication now works too with unicode regex patterns
      const facts2: TypeFact[] = [{ variable: "αβγ", predicate: "αβγ > 5" }];
      const result2 = tryLinearArithmetic("αβγ > 0", facts2);
      expect(result2.proven).toBe(true);
    });

    it("Variable name with numbers", () => {
      // FIXED: Now works with direct match pattern
      const facts: TypeFact[] = [{ variable: "x1", predicate: "x1 > 0" }];

      const result = tryLinearArithmetic("x1 > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("Variable name that looks like a number", () => {
      // Edge case: what if variable name is just digits?
      const facts: TypeFact[] = [{ variable: "123", predicate: "123 > 0" }];

      // This might confuse the parser
      const result = tryLinearArithmetic("123 > 0", facts);
      // Likely false because "123" is parsed as a number, not variable
    });

    it("Predicate with SQL injection-like content", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0; DROP TABLE users;" }];

      // Should not parse
      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("Predicate with regex special characters", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0 && (y)" }];

      const result = tryLinearArithmetic("x > 0", facts);
      // Depends on regex parsing
    });
  });

  // ==========================================================================
  // Negation edge cases
  // ==========================================================================
  describe("Negation edge cases", () => {
    it("Cannot prove strict inequality from weak inequality", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0" }];

      // x >= 0 does NOT imply x > 0 (x could be 0)
      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("Equality implies inequalities", () => {
      // FIXED: Equality now implies inequalities
      // See Finding #12 in FINDINGS.md
      const facts: TypeFact[] = [{ variable: "x", predicate: "x == 5" }];

      // x == 5 now correctly implies x > 0 (because 5 > 0)
      const result = tryLinearArithmetic("x > 0", facts);
      expect(result.proven).toBe(true);

      // And other inequalities
      const result2 = tryLinearArithmetic("x >= 0", facts);
      expect(result2.proven).toBe(true);

      const result3 = tryLinearArithmetic("x < 10", facts);
      expect(result3.proven).toBe(true);
    });

    it("Double negation", () => {
      // What if we have a negative fact?
      const facts: TypeFact[] = [{ variable: "x", predicate: "x < 0" }];

      // x < 0 should NOT prove x >= 0
      const result = tryLinearArithmetic("x >= 0", facts);
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Variable elimination edge cases
  // ==========================================================================
  describe("Variable elimination edge cases", () => {
    it("Circular dependencies", () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > y" },
        { variable: "y", predicate: "y > z" },
        { variable: "z", predicate: "z > x" },
      ];

      // This is a contradiction! x > y > z > x is impossible
      // Can the prover detect it?
      const result = tryLinearArithmetic("x > 0", facts);
      // Unclear - depends on elimination order
    });

    it("Many variables (potential exponential blowup)", () => {
      // Fourier-Motzkin can be exponential
      const facts: TypeFact[] = [];
      for (let i = 0; i < 10; i++) {
        facts.push({ variable: `x${i}`, predicate: `x${i} > 0` });
      }

      const result = tryLinearArithmetic("x0 + x1 + x2 > 0", facts);
      // Should work but might be slow
    });

    it("No facts provided", () => {
      const result = tryLinearArithmetic("x > 0", []);
      expect(result.proven).toBe(false);
    });

    it("Goal has variables not in facts", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

      // y is not mentioned in facts
      const result = tryLinearArithmetic("y > 0", facts);
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Operator handling
  // ==========================================================================
  describe("Operator handling", () => {
    it("Mixed strict and non-strict inequalities", () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y >= 0" },
      ];

      // x + y should be strictly > 0 because x > 0
      const result = tryLinearArithmetic("x + y > 0", facts);
      expect(result.proven).toBe(true);

      // What about >= ?
      const result2 = tryLinearArithmetic("x + y >= 0", facts);
      expect(result2.proven).toBe(true);
    });

    it("Strict equality (===) vs equality (==)", () => {
      // BUG: x === y doesn't prove x == y in the prover
      // The goal and fact patterns don't match due to === vs ==
      const facts: TypeFact[] = [{ variable: "x", predicate: "x === y" }];

      const result = tryLinearArithmetic("x == y", facts);
      // Should be true (=== implies ==) but patterns don't match
      expect(result.proven).toBe(false);
    });

    it("Chained comparison (x < y < z)", () => {
      // JavaScript doesn't have chained comparisons, but user might try
      const facts: TypeFact[] = [{ variable: "x", predicate: "x < y < z" }];

      // Should not parse
      const result = tryLinearArithmetic("x < z", facts);
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Compound predicates
  // ==========================================================================
  describe("Compound predicates", () => {
    it("AND with multiple conditions", () => {
      // FIXED: Compound predicates now split correctly
      // See Finding #13 in FINDINGS.md
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0 && x <= 255" }];

      // Should split the compound predicate and prove individual parts
      const result1 = tryLinearArithmetic("x >= 0", facts);
      expect(result1.proven).toBe(true);

      const result2 = tryLinearArithmetic("x <= 255", facts);
      expect(result2.proven).toBe(true);
    });

    it("Nested ANDs", () => {
      // FIXED: Compound predicates now split correctly
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0 && x <= 100 && x > 5" }];

      const result = tryLinearArithmetic("x > 0", facts);
      // x > 5 implies x > 0
      expect(result.proven).toBe(true);
    });

    it("OR in predicate (not supported)", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0 || x < -10" }];

      // OR is much harder to handle
      const result = tryLinearArithmetic("x > 0", facts);
      // Can't prove because x might be < -10
      expect(result.proven).toBe(false);
    });
  });
});

describe("Algebraic Prover Edge Cases", () => {
  // ==========================================================================
  // Identity rules
  // ==========================================================================
  describe("Identity rules", () => {
    it("Zero addition identity", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

      const result = tryAlgebraicProof("x + 0 > 0", facts);
      // Should recognize x + 0 = x
    });

    it("One multiplication identity", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

      const result = tryAlgebraicProof("x * 1 > 0", facts);
      // Should recognize x * 1 = x
    });

    it("Zero multiplication annihilator", () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];

      const result = tryAlgebraicProof("x * 0 >= 0", facts);
      // x * 0 = 0, and 0 >= 0 is true
    });
  });

  // ==========================================================================
  // Transitivity
  // ==========================================================================
  describe("Transitivity edge cases", () => {
    it("Long chain of inequalities", () => {
      const facts: TypeFact[] = [
        { variable: "a", predicate: "a > b" },
        { variable: "b", predicate: "b > c" },
        { variable: "c", predicate: "c > d" },
        { variable: "d", predicate: "d > e" },
      ];

      const result = tryAlgebraicProof("a > e", facts);
      // Long chain might not be fully traversed
    });

    it("Transitivity with equality", () => {
      const facts: TypeFact[] = [
        { variable: "a", predicate: "a == b" },
        { variable: "b", predicate: "b > c" },
      ];

      const result = tryAlgebraicProof("a > c", facts);
      // a == b and b > c should imply a > c
    });
  });
});

describe("Type Facts Edge Cases", () => {
  describe("Refinement predicate registration", () => {
    it("Registering overlapping predicates", () => {
      // What if two refinements have the same brand?
      registerRefinementPredicate("Positive", (v) => `${v} > 0`);

      // Register again with different predicate
      registerRefinementPredicate("Positive", (v) => `${v} >= 1`);

      // Which one wins?
      // Depends on implementation - could be last-wins or first-wins
    });

    it("Predicate with invalid characters", () => {
      registerRefinementPredicate("Weird<Type>", (v) => `${v} > 0`);
      // Type name with < > might break things
    });
  });
});

describe("Contract Runtime Edge Cases", () => {
  describe("requires() at runtime", () => {
    it("Falsy but valid values", async () => {
      const { requires } = await import("../packages/contracts/src/macros/requires.js");

      // requires(0) should throw (0 is falsy)
      expect(() => requires(0 as unknown as boolean)).toThrow();

      // requires("") should throw (empty string is falsy)
      expect(() => requires("" as unknown as boolean)).toThrow();

      // requires(null) should throw
      expect(() => requires(null as unknown as boolean)).toThrow();

      // requires(undefined) should throw
      expect(() => requires(undefined as unknown as boolean)).toThrow();
    });

    it("Truthy but potentially unexpected values", async () => {
      const { requires } = await import("../packages/contracts/src/macros/requires.js");

      // Any non-empty string is truthy
      expect(() => requires("false" as unknown as boolean)).not.toThrow();

      // Any non-zero number is truthy
      expect(() => requires(-1 as unknown as boolean)).not.toThrow();

      // Empty object is truthy
      expect(() => requires({} as unknown as boolean)).not.toThrow();

      // Empty array is truthy
      expect(() => requires([] as unknown as boolean)).not.toThrow();

      // NaN is falsy!
      expect(() => requires(NaN as unknown as boolean)).toThrow();
    });

    it("Error message interpolation", async () => {
      const { requires } = await import("../packages/contracts/src/macros/requires.js");

      try {
        requires(false, "${process.env.SECRET}");
      } catch (e) {
        // Message should be literal, not interpolated
        expect((e as Error).message).toContain("${process.env.SECRET}");
      }
    });
  });

  describe("ensures() at runtime", () => {
    it("Runtime ensures with falsy condition", async () => {
      const { ensures } = await import("../packages/contracts/src/macros/ensures.js");

      expect(() => ensures(false)).toThrow();
    });
  });

  describe("old() at runtime", () => {
    it("Runtime old without transformer", async () => {
      const { old } = await import("../packages/contracts/src/macros/old.js");

      // old() should just return its argument at runtime
      const value = { count: 5 };
      const captured = old(value);

      // Without transformer, old() just returns the value
      // This might be a shallow copy or the same reference
      expect(captured).toEqual(value);

      // Modifying original
      value.count = 10;

      // Is captured modified? (shallow copy issue)
      // Depends on implementation
    });
  });
});

describe("Contract Stripping Edge Cases", () => {
  describe("Mode configuration", () => {
    it("Mode: none should strip all checks", async () => {
      const { setContractConfig, shouldEmitCheck } =
        await import("../packages/contracts/src/config.js");

      setContractConfig({ mode: "none" });
      expect(shouldEmitCheck("precondition")).toBe(false);
      expect(shouldEmitCheck("postcondition")).toBe(false);
      expect(shouldEmitCheck("invariant")).toBe(false);
    });

    it("Mode: assertions should keep invariants", async () => {
      const { setContractConfig, shouldEmitCheck } =
        await import("../packages/contracts/src/config.js");

      setContractConfig({ mode: "assertions" });
      expect(shouldEmitCheck("precondition")).toBe(false);
      expect(shouldEmitCheck("postcondition")).toBe(false);
      expect(shouldEmitCheck("invariant")).toBe(true);
    });

    it("Mode: full should keep all checks", async () => {
      const { setContractConfig, shouldEmitCheck } =
        await import("../packages/contracts/src/config.js");

      setContractConfig({ mode: "full" });
      expect(shouldEmitCheck("precondition")).toBe(true);
      expect(shouldEmitCheck("postcondition")).toBe(true);
      expect(shouldEmitCheck("invariant")).toBe(true);
    });
  });
});
