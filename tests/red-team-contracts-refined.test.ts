/**
 * Red Team Tests for @typesugar/contracts-refined
 *
 * Attack surfaces:
 * - Boundary conditions for numeric refinements (Byte, Port, Percentage)
 * - Subtyping rule validation (transitive widening, invalid widening)
 * - Predicate registration edge cases (duplicates, malformed predicates)
 * - Dynamic predicate generation (Vec<N> patterns)
 * - Special numeric values (NaN, Infinity, -0)
 * - Decidability classification consistency
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRefinementPredicate,
  getRegisteredPredicates,
  hasRefinementPredicate,
  getRefinementPredicate,
  canWiden,
  registerSubtypingRule,
  getSubtypingRule,
  getAllSubtypingRules,
  isCompileTimeDecidable,
  requiresRuntimeCheck,
  getDecidability,
  registerDecidability,
  extractVecLength,
  generateVecPredicate,
  VEC_PREDICATE_PATTERN,
} from "@typesugar/contracts-refined";
import {
  Positive,
  NonNegative,
  NonZero,
  Negative,
  Byte,
  Port,
  Percentage,
  Int,
  Finite,
  NonEmpty,
  Trimmed,
  isSubtype,
  widen,
  widenTo,
  type Refined,
} from "@typesugar/type-system";

describe("Contracts-Refined Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Boundary Conditions for Numeric Refinements
  // ==========================================================================
  describe("Numeric boundary conditions", () => {
    describe("Byte refinement (0-255)", () => {
      it("accepts exactly 0 (lower boundary)", () => {
        const result = Byte.safe(0);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(0);
      });

      it("accepts exactly 255 (upper boundary)", () => {
        const result = Byte.safe(255);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(255);
      });

      it("rejects -1 (one below lower boundary)", () => {
        const result = Byte.safe(-1);
        expect(result.ok).toBe(false);
      });

      it("rejects 256 (one above upper boundary)", () => {
        const result = Byte.safe(256);
        expect(result.ok).toBe(false);
      });

      it("rejects non-integer within range", () => {
        const result = Byte.safe(127.5);
        expect(result.ok).toBe(false);
      });
    });

    describe("Port refinement (1-65535)", () => {
      it("accepts exactly 1 (lower boundary)", () => {
        const result = Port.safe(1);
        expect(result.ok).toBe(true);
      });

      it("accepts exactly 65535 (upper boundary)", () => {
        const result = Port.safe(65535);
        expect(result.ok).toBe(true);
      });

      it("rejects 0 (one below lower boundary)", () => {
        const result = Port.safe(0);
        expect(result.ok).toBe(false);
      });

      it("rejects 65536 (one above upper boundary)", () => {
        const result = Port.safe(65536);
        expect(result.ok).toBe(false);
      });
    });

    describe("Percentage refinement (0-100)", () => {
      it("accepts exactly 0 (lower boundary)", () => {
        const result = Percentage.safe(0);
        expect(result.ok).toBe(true);
      });

      it("accepts exactly 100 (upper boundary)", () => {
        const result = Percentage.safe(100);
        expect(result.ok).toBe(true);
      });

      it("rejects -0.0001 (just below lower boundary)", () => {
        const result = Percentage.safe(-0.0001);
        expect(result.ok).toBe(false);
      });

      it("rejects 100.0001 (just above upper boundary)", () => {
        const result = Percentage.safe(100.0001);
        expect(result.ok).toBe(false);
      });

      it("accepts non-integer within range (50.5)", () => {
        const result = Percentage.safe(50.5);
        expect(result.ok).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Attack 2: Special Numeric Values (NaN, Infinity, -0)
  // ==========================================================================
  describe("Special numeric values", () => {
    describe("NaN handling", () => {
      it("Positive rejects NaN", () => {
        expect(Positive.is(NaN)).toBe(false);
      });

      it("NonNegative rejects NaN", () => {
        expect(NonNegative.is(NaN)).toBe(false);
      });

      it("Negative rejects NaN", () => {
        expect(Negative.is(NaN)).toBe(false);
      });

      it("NonZero rejects NaN (predicate explicitly excludes NaN)", () => {
        // NonZero predicate is (n) => n !== 0 && !Number.isNaN(n)
        // Correctly rejects NaN since dividing by NaN produces NaN
        const result = NonZero.is(NaN);
        expect(result).toBe(false);
      });

      it("Int rejects NaN", () => {
        expect(Int.is(NaN)).toBe(false);
      });

      it("Finite rejects NaN", () => {
        expect(Finite.is(NaN)).toBe(false);
      });
    });

    describe("Infinity handling", () => {
      it("Positive rejects positive Infinity (finite-only)", () => {
        // Positive is defined as "$ > 0 && Number.isFinite($)" - excludes Infinity
        // Use NonZero if you need to accept Infinity
        expect(Positive.is(Infinity)).toBe(false);
      });

      it("Negative rejects negative Infinity (finite-only)", () => {
        // Negative is defined as "$ < 0 && Number.isFinite($)" - excludes -Infinity
        expect(Negative.is(-Infinity)).toBe(false);
      });

      it("NonNegative rejects positive Infinity (finite-only)", () => {
        // NonNegative is defined as "$ >= 0 && Number.isFinite($)" - excludes Infinity
        expect(NonNegative.is(Infinity)).toBe(false);
      });

      it("Finite rejects positive Infinity", () => {
        expect(Finite.is(Infinity)).toBe(false);
      });

      it("Finite rejects negative Infinity", () => {
        expect(Finite.is(-Infinity)).toBe(false);
      });

      it("Int rejects Infinity", () => {
        expect(Int.is(Infinity)).toBe(false);
      });

      it("Byte rejects Infinity (not in range)", () => {
        expect(Byte.is(Infinity)).toBe(false);
      });
    });

    describe("Negative zero handling", () => {
      it("NonNegative accepts -0", () => {
        // -0 >= 0 is true in JS
        expect(NonNegative.is(-0)).toBe(true);
      });

      it("Positive rejects -0", () => {
        // -0 > 0 is false
        expect(Positive.is(-0)).toBe(false);
      });

      it("Negative rejects -0", () => {
        // -0 < 0 is false
        expect(Negative.is(-0)).toBe(false);
      });

      it("NonZero rejects -0", () => {
        // -0 !== 0 is false in JS
        expect(NonZero.is(-0)).toBe(false);
      });

      it("Byte accepts -0 (treated as 0)", () => {
        // -0 is treated as 0 in numeric comparisons
        expect(Byte.is(-0)).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Attack 3: Subtyping Rule Validation
  // ==========================================================================
  describe("Subtyping rule validation", () => {
    describe("Valid subtyping relationships", () => {
      it("Positive is subtype of NonNegative", () => {
        expect(isSubtype("Positive", "NonNegative")).toBe(true);
      });

      it("Positive is subtype of NonZero", () => {
        expect(isSubtype("Positive", "NonZero")).toBe(true);
      });

      it("Negative is subtype of NonZero", () => {
        expect(isSubtype("Negative", "NonZero")).toBe(true);
      });

      it("Port is subtype of Positive", () => {
        expect(isSubtype("Port", "Positive")).toBe(true);
      });

      it("Port is subtype of NonNegative (transitive)", () => {
        expect(isSubtype("Port", "NonNegative")).toBe(true);
      });

      it("Byte is subtype of NonNegative", () => {
        expect(isSubtype("Byte", "NonNegative")).toBe(true);
      });

      it("Byte is subtype of Int", () => {
        expect(isSubtype("Byte", "Int")).toBe(true);
      });
    });

    describe("Invalid subtyping relationships", () => {
      it("NonNegative is NOT subtype of Positive (0 is not positive)", () => {
        expect(isSubtype("NonNegative", "Positive")).toBe(false);
      });

      it("NonZero is NOT subtype of Positive (negative numbers exist)", () => {
        expect(isSubtype("NonZero", "Positive")).toBe(false);
      });

      it("Int is NOT subtype of Byte (integers can exceed 255)", () => {
        expect(isSubtype("Int", "Byte")).toBe(false);
      });

      it("Percentage is NOT subtype of Byte (0-100 is subset of 0-255, but no rule declared)", () => {
        // Even though Percentage values (0-100) fit in Byte (0-255),
        // we don't have a declared subtyping rule
        expect(isSubtype("Percentage", "Byte")).toBe(false);
      });
    });

    describe("Reflexive subtyping", () => {
      it("Any type is subtype of itself", () => {
        expect(isSubtype("Positive", "Positive")).toBe(true);
        expect(isSubtype("Byte", "Byte")).toBe(true);
        expect(isSubtype("NonEmpty", "NonEmpty")).toBe(true);
      });
    });

    describe("canWiden from contracts prover", () => {
      it("canWiden respects registered subtyping rules", () => {
        expect(canWiden("Positive", "NonNegative")).toBe(true);
        expect(canWiden("Port", "Positive")).toBe(true);
      });

      it("canWiden rejects unregistered widening", () => {
        expect(canWiden("NonNegative", "Positive")).toBe(false);
        expect(canWiden("Int", "Byte")).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Attack 4: Predicate Registration Edge Cases
  // ==========================================================================
  describe("Predicate registration edge cases", () => {
    describe("Custom predicate registration", () => {
      it("registers and retrieves custom predicate", () => {
        registerRefinementPredicate("CustomPositiveEven", "$ > 0 && $ % 2 === 0");
        expect(hasRefinementPredicate("CustomPositiveEven")).toBe(true);
        expect(getRefinementPredicate("CustomPositiveEven")).toBe("$ > 0 && $ % 2 === 0");
      });

      it("duplicate registration overwrites (replace strategy)", () => {
        registerRefinementPredicate("TestDuplicate", "$ > 10");
        registerRefinementPredicate("TestDuplicate", "$ > 20");
        expect(getRefinementPredicate("TestDuplicate")).toBe("$ > 20");
      });

      it("empty predicate string is rejected by core register", () => {
        // The underlying contracts prover rejects empty predicates
        // This documents that behavior
        registerRefinementPredicate("EmptyPredicate", "");
        // Empty string is falsy, so coreRegister likely treats it as missing
        expect(hasRefinementPredicate("EmptyPredicate")).toBe(false);
      });

      it("predicate with invalid JS syntax is stored as-is (no validation)", () => {
        // The predicate is just a string - validation happens at usage time
        registerRefinementPredicate("InvalidSyntax", "$ >>> &&& !!!");
        expect(getRefinementPredicate("InvalidSyntax")).toBe("$ >>> &&& !!!");
      });
    });

    describe("Built-in predicates are registered", () => {
      it("has all numeric predicates", () => {
        expect(hasRefinementPredicate("Positive")).toBe(true);
        expect(hasRefinementPredicate("NonNegative")).toBe(true);
        expect(hasRefinementPredicate("Negative")).toBe(true);
        expect(hasRefinementPredicate("NonZero")).toBe(true);
        expect(hasRefinementPredicate("Int")).toBe(true);
        expect(hasRefinementPredicate("Byte")).toBe(true);
        expect(hasRefinementPredicate("Port")).toBe(true);
        expect(hasRefinementPredicate("Percentage")).toBe(true);
        expect(hasRefinementPredicate("Finite")).toBe(true);
      });

      it("has all string predicates", () => {
        expect(hasRefinementPredicate("NonEmpty")).toBe(true);
        expect(hasRefinementPredicate("Trimmed")).toBe(true);
        expect(hasRefinementPredicate("Lowercase")).toBe(true);
        expect(hasRefinementPredicate("Uppercase")).toBe(true);
        expect(hasRefinementPredicate("Email")).toBe(true);
        expect(hasRefinementPredicate("Url")).toBe(true);
        expect(hasRefinementPredicate("Uuid")).toBe(true);
      });

      it("has array predicates", () => {
        expect(hasRefinementPredicate("NonEmptyArray")).toBe(true);
      });
    });

    describe("Predicate string patterns", () => {
      it("Positive predicate uses $ placeholder", () => {
        // Positive includes finite check to exclude Infinity
        expect(getRefinementPredicate("Positive")).toBe("$ > 0 && Number.isFinite($)");
      });

      it("Byte predicate uses compound condition", () => {
        expect(getRefinementPredicate("Byte")).toBe("$ >= 0 && $ <= 255");
      });

      it("Email predicate uses regex", () => {
        const emailPred = getRefinementPredicate("Email");
        expect(emailPred).toContain(".test($)");
      });
    });
  });

  // ==========================================================================
  // Attack 5: Decidability Classification
  // ==========================================================================
  describe("Decidability classification", () => {
    describe("Compile-time decidable predicates", () => {
      it("Positive is compile-time decidable", () => {
        expect(isCompileTimeDecidable("Positive")).toBe(true);
      });

      it("NonNegative is compile-time decidable", () => {
        expect(isCompileTimeDecidable("NonNegative")).toBe(true);
      });

      it("Byte is compile-time decidable (linear arithmetic)", () => {
        expect(isCompileTimeDecidable("Byte")).toBe(true);
      });

      it("NonEmpty (string) is compile-time decidable for literals", () => {
        expect(isCompileTimeDecidable("NonEmpty")).toBe(true);
      });
    });

    describe("Runtime-only predicates", () => {
      it("Trimmed requires runtime check", () => {
        expect(requiresRuntimeCheck("Trimmed")).toBe(true);
      });

      it("Lowercase requires runtime check", () => {
        expect(requiresRuntimeCheck("Lowercase")).toBe(true);
      });

      it("Email requires runtime check", () => {
        expect(requiresRuntimeCheck("Email")).toBe(true);
      });

      it("Url requires runtime check", () => {
        expect(requiresRuntimeCheck("Url")).toBe(true);
      });

      it("Uuid requires runtime check", () => {
        expect(requiresRuntimeCheck("Uuid")).toBe(true);
      });
    });

    describe("Decidability info retrieval", () => {
      it("getDecidability returns info for registered predicates", () => {
        const info = getDecidability("Positive");
        expect(info).toBeDefined();
        if (info) {
          expect(info.decidability).toBe("compile-time");
          expect(info.preferredStrategy).toBe("algebra");
        }
      });

      it("getDecidability returns undefined for unregistered predicates", () => {
        expect(getDecidability("NonExistentPredicate")).toBeUndefined();
      });
    });

    describe("Custom decidability registration", () => {
      it("can register decidability for custom predicates", () => {
        registerRefinementPredicate("CustomDecidable", "$ > 100", "compile-time");
        registerDecidability({
          brand: "CustomDecidable",
          decidability: "compile-time",
          preferredStrategy: "algebra",
        });
        expect(isCompileTimeDecidable("CustomDecidable")).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Attack 6: Vec<N> Dynamic Predicate Generation
  // ==========================================================================
  describe("Vec<N> dynamic predicate generation", () => {
    describe("extractVecLength", () => {
      it("extracts length from Vec<5>", () => {
        expect(extractVecLength("Vec<5>")).toBe(5);
      });

      it("extracts length from Vec<0>", () => {
        expect(extractVecLength("Vec<0>")).toBe(0);
      });

      it("extracts length from Vec<100>", () => {
        expect(extractVecLength("Vec<100>")).toBe(100);
      });

      it("returns undefined for non-Vec types", () => {
        expect(extractVecLength("Array")).toBeUndefined();
        expect(extractVecLength("Byte")).toBeUndefined();
        expect(extractVecLength("Vec")).toBeUndefined();
      });

      it("returns undefined for malformed Vec types", () => {
        expect(extractVecLength("Vec<>")).toBeUndefined();
        expect(extractVecLength("Vec<abc>")).toBeUndefined();
        expect(extractVecLength("Vec<-1>")).toBeUndefined();
      });
    });

    describe("generateVecPredicate", () => {
      it("generates predicate for Vec<5>", () => {
        const pred = generateVecPredicate("Vec<5>");
        expect(pred).toBe("$.length === 5");
      });

      it("generates predicate for Vec<0>", () => {
        const pred = generateVecPredicate("Vec<0>");
        expect(pred).toBe("$.length === 0");
      });

      it("returns undefined for non-Vec types", () => {
        expect(generateVecPredicate("Array")).toBeUndefined();
        expect(generateVecPredicate("Byte")).toBeUndefined();
      });
    });

    describe("VEC_PREDICATE_PATTERN", () => {
      it("pattern matches Vec<N> format", () => {
        expect(VEC_PREDICATE_PATTERN.test("Vec<5>")).toBe(true);
        expect(VEC_PREDICATE_PATTERN.test("Vec<0>")).toBe(true);
        expect(VEC_PREDICATE_PATTERN.test("Vec<123>")).toBe(true);
      });

      it("pattern rejects invalid formats", () => {
        expect(VEC_PREDICATE_PATTERN.test("Vec")).toBe(false);
        expect(VEC_PREDICATE_PATTERN.test("Vec<>")).toBe(false);
        expect(VEC_PREDICATE_PATTERN.test("Vec<abc>")).toBe(false);
        expect(VEC_PREDICATE_PATTERN.test("Array<5>")).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Attack 7: String Refinement Edge Cases
  // ==========================================================================
  describe("String refinement edge cases", () => {
    describe("NonEmpty edge cases", () => {
      it("rejects empty string", () => {
        expect(NonEmpty.is("")).toBe(false);
      });

      it("accepts single character", () => {
        expect(NonEmpty.is("a")).toBe(true);
      });

      it("accepts whitespace-only string", () => {
        expect(NonEmpty.is("   ")).toBe(true);
      });

      it("accepts string with null character", () => {
        expect(NonEmpty.is("\0")).toBe(true);
      });
    });

    describe("Trimmed edge cases", () => {
      it("accepts string with no whitespace", () => {
        expect(Trimmed.is("hello")).toBe(true);
      });

      it("accepts empty string (trim of empty is empty)", () => {
        expect(Trimmed.is("")).toBe(true);
      });

      it("rejects leading whitespace", () => {
        expect(Trimmed.is(" hello")).toBe(false);
      });

      it("rejects trailing whitespace", () => {
        expect(Trimmed.is("hello ")).toBe(false);
      });

      it("accepts internal whitespace", () => {
        expect(Trimmed.is("hello world")).toBe(true);
      });

      it("rejects tab characters at edges", () => {
        expect(Trimmed.is("\thello")).toBe(false);
        expect(Trimmed.is("hello\t")).toBe(false);
      });

      it("rejects newline at edges", () => {
        expect(Trimmed.is("\nhello")).toBe(false);
        expect(Trimmed.is("hello\n")).toBe(false);
      });
    });
  });
});
