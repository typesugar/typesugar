/**
 * Red Team Tests for @typesugar/contracts-z3
 *
 * Attack surfaces:
 * - Parser edge cases: malformed predicates, incomplete parses, operator precedence
 * - Variable naming: special characters, Unicode, reserved words, property access
 * - Arithmetic edge cases: division by zero, modulo, overflow, type coercion
 * - Solver behavior: timeout handling, unsatisfiable constraints, UNKNOWN results
 * - Initialization: Z3 unavailable, double initialization, eager vs lazy init
 * - Non-linear arithmetic: Z3 limitations with multiplication of variables
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  z3ProverPlugin,
  proveWithZ3Async,
  type TypeFact,
  type Z3ProverPlugin,
} from "../packages/contracts-z3/src/index.js";

// Helper to check if Z3 is available in this environment
let z3Available = false;
let plugin: Z3ProverPlugin;

beforeAll(async () => {
  plugin = z3ProverPlugin({ timeout: 5000 });
  try {
    await plugin.init();
    z3Available = plugin.isReady();
  } catch {
    z3Available = false;
  }
});

describe("Contracts-Z3 Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Parser Edge Cases
  // ==========================================================================
  describe("Parser edge cases", () => {
    it("should reject malformed predicates gracefully", async () => {
      if (!z3Available) {
        // When Z3 unavailable, verify graceful fallback
        const result = await plugin.prove("malformed >>><<< predicate", []);
        expect(result.proven).toBe(false);
        expect(result.reason).toContain("Z3");
        return;
      }

      // Malformed predicates should fail gracefully, not throw
      const malformed = [
        "x >",
        "> 5",
        "x + ",
        "+ y",
        "((x > 5)",
        "x > 5))",
        "x && ",
        "&& y",
        "x ||",
        "|| y",
        "x ===",
        "=== 5",
        "x..",
        "..y",
        "x..y",
      ];

      for (const pred of malformed) {
        const result = await plugin.prove(pred, []);
        expect(result.proven).toBe(false);
        // Should fail with parse error, not throw
      }
    });

    it("should handle empty and whitespace-only predicates", async () => {
      if (!z3Available) return;

      const result1 = await plugin.prove("", []);
      expect(result1.proven).toBe(false);

      const result2 = await plugin.prove("   ", []);
      expect(result2.proven).toBe(false);

      const result3 = await plugin.prove("\n\t", []);
      expect(result3.proven).toBe(false);
    });

    it("should handle operator precedence correctly", async () => {
      if (!z3Available) return;

      // x + y * z should be x + (y * z), not (x + y) * z
      // If x=1, y=2, z=3: correct is 1+6=7, wrong would be 3*3=9
      // Prove that x + y * z === 7 given x=1, y=2, z=3
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 1" },
        { variable: "y", predicate: "y === 2" },
        { variable: "z", predicate: "z === 3" },
      ];

      const result = await plugin.prove("x + y * z === 7", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle deeply nested parentheses", async () => {
      if (!z3Available) return;

      // ((((x)))) === 5 should work
      const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];
      const result = await plugin.prove("((((x)))) === 5", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle chained comparisons correctly", async () => {
      if (!z3Available) return;

      // Parser doesn't support chained comparisons like "1 < x < 10"
      // This should fail to parse (only first comparison is parsed)
      const result = await plugin.prove("1 < x < 10", []);
      // Since the parser doesn't consume the entire input, it should fail
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 2: Variable Naming Edge Cases
  // ==========================================================================
  describe("Variable naming edge cases", () => {
    it("should handle property access with deep nesting", async () => {
      if (!z3Available) return;

      // obj.prop.subprop gets flattened to obj_prop_subprop
      const facts: TypeFact[] = [
        { variable: "obj_prop_subprop", predicate: "obj.prop.subprop === 42" },
      ];
      const result = await plugin.prove("obj.prop.subprop === 42", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle underscore-heavy variable names", async () => {
      if (!z3Available) return;

      // Names like __proto__, _private, name__with__underscores
      const facts: TypeFact[] = [
        { variable: "__proto__", predicate: "__proto__ === 1" },
        { variable: "_private", predicate: "_private === 2" },
      ];
      const result = await plugin.prove("__proto__ + _private === 3", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle dollar sign in variable names", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [{ variable: "$value", predicate: "$value === 10" }];
      const result = await plugin.prove("$value === 10", facts);
      expect(result.proven).toBe(true);
    });

    it("should NOT parse Unicode variable names", async () => {
      if (!z3Available) return;

      // The regex only matches [a-zA-Z_$][a-zA-Z0-9_$]*
      // Unicode names like π, α, δ should fail to parse
      const result = await plugin.prove("π === 3", []);
      expect(result.proven).toBe(false);
      expect(result.reason).toContain("parse");
    });

    it("should handle JavaScript reserved words as variable names", async () => {
      if (!z3Available) return;

      // Z3 doesn't care about JS reserved words
      const facts: TypeFact[] = [
        { variable: "class", predicate: "class === 1" },
        { variable: "function", predicate: "function === 2" },
      ];
      const result = await plugin.prove("class + function === 3", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle collision between flattened property access and regular names", async () => {
      if (!z3Available) return;

      // obj.x flattens to obj_x, which could collide with a variable named obj_x
      // Both refer to the same Z3 variable, so they should be equal
      const facts: TypeFact[] = [
        { variable: "obj_x", predicate: "obj.x === 5" }, // Creates obj_x = 5
      ];
      // Using obj_x directly should see the same variable
      const result = await plugin.prove("obj_x === 5", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Arithmetic Edge Cases
  // ==========================================================================
  describe("Arithmetic edge cases", () => {
    it("should handle division by variable that could be zero", async () => {
      if (!z3Available) return;

      // x / y where y could be 0 - Z3 should handle this
      // In Z3, division by zero is typically undefined behavior
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 10" },
        { variable: "y", predicate: "y === 0" },
      ];

      // This is mathematically undefined, Z3 may return unknown or unsat
      const result = await plugin.prove("x / y === 0", facts);
      // We just verify it doesn't throw
      expect(typeof result.proven).toBe("boolean");
    });

    it("should handle modulo operations", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 17" },
        { variable: "y", predicate: "y === 5" },
      ];
      const result = await plugin.prove("x % y === 2", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle negative modulo", async () => {
      if (!z3Available) return;

      // -7 % 3 behavior varies between languages
      // Z3's behavior may differ from JavaScript's
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === -7" },
        { variable: "y", predicate: "y === 3" },
      ];
      // Just verify it doesn't throw
      const result = await plugin.prove("x % y >= -3 && x % y <= 3", facts);
      expect(typeof result.proven).toBe("boolean");
    });

    it("should handle mixing Int and Real types", async () => {
      if (!z3Available) return;

      // 5 is Int, 3.14 is Real - Z3 needs to handle type coercion
      const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];
      // Adding Int to Real might cause type issues
      const result = await plugin.prove("x + 3.14 > 8", facts);
      // Just verify it handles this gracefully
      expect(typeof result.proven).toBe("boolean");
    });

    it("should handle very large numbers", async () => {
      if (!z3Available) return;

      const bigNum = Number.MAX_SAFE_INTEGER;
      const facts: TypeFact[] = [{ variable: "x", predicate: `x === ${bigNum}` }];
      const result = await plugin.prove(`x === ${bigNum}`, facts);
      expect(result.proven).toBe(true);
    });

    it("should handle scientific notation", async () => {
      if (!z3Available) return;

      // Parser uses parseFloat, so 1e10 should work
      // But the regex only matches -?\d+(\.\d+)?, not scientific notation
      const result = await plugin.prove("x === 1e10", []);
      // This should fail to parse because the regex doesn't match 'e'
      expect(result.proven).toBe(false);
    });

    it("should handle unary negation", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];
      const result = await plugin.prove("-x === -5", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle double negation", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];
      const result = await plugin.prove("--x === 5", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: Solver Behavior Edge Cases
  // ==========================================================================
  describe("Solver behavior edge cases", () => {
    it("should handle contradictory facts", async () => {
      if (!z3Available) return;

      // x === 5 AND x === 10 is unsatisfiable
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 5" },
        { variable: "x", predicate: "x === 10" },
      ];
      // Any goal should be provable from a contradiction (ex falso quodlibet)
      // But our prover negates the goal, so contradictory facts make negation unsat
      const result = await plugin.prove("false", facts);
      // With contradictory facts, even "false" becomes provable
      expect(result.proven).toBe(true);
    });

    it("should handle tautologies", async () => {
      if (!z3Available) return;

      // x === x is always true
      const result = await plugin.prove("x === x", []);
      expect(result.proven).toBe(true);
    });

    it("should handle contradictions in goal", async () => {
      if (!z3Available) return;

      // x !== x is always false, cannot be proven
      const result = await plugin.prove("x !== x", []);
      expect(result.proven).toBe(false);
    });

    it("should handle very short timeout", async () => {
      // Create a new plugin with 1ms timeout
      const shortTimeoutPlugin = z3ProverPlugin({ timeout: 1 });
      try {
        await shortTimeoutPlugin.init();
        if (!shortTimeoutPlugin.isReady()) return;

        // Simple proof should still work even with short timeout
        const result = await shortTimeoutPlugin.prove("x === x", []);
        // May succeed or timeout - just verify no throw
        expect(typeof result.proven).toBe("boolean");
      } catch {
        // Z3 not available
      }
    });

    it("should handle timeout override", async () => {
      if (!z3Available) return;

      // Override the default timeout in prove call
      const result = await plugin.prove("x === x", [], 100);
      expect(result.proven).toBe(true);
    });

    it("should handle empty facts array", async () => {
      if (!z3Available) return;

      // No facts, just prove a tautology
      const result = await plugin.prove("5 > 3", []);
      expect(result.proven).toBe(true);
    });

    it("should handle facts with no variables", async () => {
      if (!z3Available) return;

      // Facts that are just constants
      const facts: TypeFact[] = [{ variable: "", predicate: "5 === 5" }];
      const result = await plugin.prove("true", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 5: Non-linear Arithmetic (Z3 Limitations)
  // ==========================================================================
  describe("Non-linear arithmetic limitations", () => {
    it("should handle variable multiplication", async () => {
      if (!z3Available) return;

      // x * y where both are variables is non-linear
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 3" },
        { variable: "y", predicate: "y === 4" },
      ];
      const result = await plugin.prove("x * y === 12", facts);
      // Z3 can handle this when variables have fixed values
      expect(result.proven).toBe(true);
    });

    it("should handle quadratic expressions", async () => {
      if (!z3Available) return;

      // x * x = x^2
      const facts: TypeFact[] = [{ variable: "x", predicate: "x === 5" }];
      const result = await plugin.prove("x * x === 25", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle unconstrained variable multiplication", async () => {
      if (!z3Available) return;

      // x * y === 12 with no constraints - many solutions exist
      // Z3 should return SAT (meaning it can't prove the goal must be true)
      const result = await plugin.prove("x * y === 12", []);
      // Since x and y are unconstrained, the negation (x * y !== 12) is satisfiable
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 6: Initialization Edge Cases
  // ==========================================================================
  describe("Initialization edge cases", () => {
    it("should handle double initialization gracefully", async () => {
      const p = z3ProverPlugin({ timeout: 1000 });
      try {
        await p.init();
        await p.init(); // Second init should be a no-op
        expect(p.isReady()).toBe(true);
      } catch {
        // Z3 not available - that's okay for this test
        expect(p.isReady()).toBe(false);
      }
    });

    it("should handle concurrent initialization", async () => {
      const p = z3ProverPlugin({ timeout: 1000 });
      try {
        // Start multiple inits concurrently
        await Promise.all([p.init(), p.init(), p.init()]);
        expect(p.isReady()).toBe(true);
      } catch {
        // Z3 not available
        expect(p.isReady()).toBe(false);
      }
    });

    it("should handle eager initialization", async () => {
      const p = z3ProverPlugin({ timeout: 1000, eagerInit: true });
      // Give it time to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));
      // May or may not be ready depending on Z3 availability
      expect(typeof p.isReady()).toBe("boolean");
    });

    it("should handle prove before explicit init", async () => {
      const p = z3ProverPlugin({ timeout: 1000 });
      // Don't call init(), just prove directly
      const result = await p.prove("true", []);
      // prove() should auto-initialize
      expect(typeof result.proven).toBe("boolean");
    });

    it("should report isReady correctly", () => {
      const p = z3ProverPlugin({ timeout: 1000 });
      // Before any init, should not be ready
      expect(p.isReady()).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 7: Logical Operator Edge Cases
  // ==========================================================================
  describe("Logical operator edge cases", () => {
    it("should handle complex boolean expressions", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [
        { variable: "a", predicate: "a === 1" },
        { variable: "b", predicate: "b === 2" },
        { variable: "c", predicate: "c === 3" },
      ];
      // (a > 0 && b > 1) || c < 0 should be true
      const result = await plugin.prove("(a > 0 && b > 1) || c < 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle De Morgan's laws", async () => {
      if (!z3Available) return;

      // !(a && b) === !a || !b
      // !(a || b) === !a && !b
      const facts: TypeFact[] = [
        { variable: "a", predicate: "a > 0" },
        { variable: "b", predicate: "b > 0" },
      ];
      // If a > 0 and b > 0, then !(a > 0 && b > 0) should be false
      const result = await plugin.prove("!(a > 0 && b > 0)", facts);
      expect(result.proven).toBe(false);
    });

    it("should handle boolean literals", async () => {
      if (!z3Available) return;

      const result1 = await plugin.prove("true", []);
      expect(result1.proven).toBe(true);

      const result2 = await plugin.prove("false", []);
      expect(result2.proven).toBe(false);

      const result3 = await plugin.prove("true && true", []);
      expect(result3.proven).toBe(true);

      const result4 = await plugin.prove("true && false", []);
      expect(result4.proven).toBe(false);
    });

    it("should handle double negation in logic", async () => {
      if (!z3Available) return;

      // !!true === true
      const result = await plugin.prove("!!true", []);
      expect(result.proven).toBe(true);
    });

    it("should handle mixed arithmetic and logical", async () => {
      if (!z3Available) return;

      const facts: TypeFact[] = [
        { variable: "x", predicate: "x === 5" },
        { variable: "y", predicate: "y === 10" },
      ];
      // (x > 0 && y > 0) && x + y === 15
      const result = await plugin.prove("(x > 0 && y > 0) && x + y === 15", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 8: Standalone proveWithZ3Async Function
  // ==========================================================================
  describe("proveWithZ3Async standalone function", () => {
    it("should work without pre-initialization", async () => {
      try {
        const result = await proveWithZ3Async("x === x", [], { timeout: 5000 });
        expect(result.proven).toBe(true);
      } catch {
        // Z3 not available
      }
    });

    it("should respect timeout option", async () => {
      try {
        const result = await proveWithZ3Async("x === x", [], { timeout: 100 });
        expect(typeof result.proven).toBe("boolean");
      } catch {
        // Z3 not available
      }
    });

    it("should handle facts in standalone function", async () => {
      try {
        const facts: TypeFact[] = [
          { variable: "x", predicate: "x === 5" },
          { variable: "y", predicate: "y === 3" },
        ];
        const result = await proveWithZ3Async("x > y", facts, { timeout: 5000 });
        expect(result.proven).toBe(true);
      } catch {
        // Z3 not available
      }
    });
  });
});
