/**
 * Tests for @typesugar/contracts-z3 — Z3 SMT Solver Plugin
 *
 * These tests verify that the Z3 integration properly proves
 * arithmetic and logical formulas that the algebraic rules cannot handle.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  z3ProverPlugin,
  proveWithZ3Async,
  type Z3ProverPlugin,
  type TypeFact,
} from "../packages/contracts-z3/src/index.js";
import {
  setContractConfig,
  tryAlgebraicProof,
  type ProverPlugin,
} from "../packages/contracts/src/index.js";

// Local version of proveGoalWithPlugins since it may not be exported yet
async function proveGoalWithPlugins(
  goal: string,
  facts: TypeFact[],
  plugins: ProverPlugin[]
): Promise<{ proven: boolean; method?: string; reason?: string }> {
  // First try algebraic rules
  const algebraResult = tryAlgebraicProof(goal, facts);
  if (algebraResult.proven) return algebraResult;

  // Then try plugins
  for (const plugin of plugins) {
    try {
      const pluginResult = await plugin.prove(goal, facts);
      if (pluginResult.proven) {
        return {
          proven: true,
          method: "plugin",
          reason: `${plugin.name}: ${pluginResult.reason ?? "proven"}`,
        };
      }
    } catch {
      // Plugin error, continue to next
    }
  }

  return { proven: false };
}

// ============================================================================
// Test Setup
// ============================================================================

describe("@typesugar/contracts-z3", () => {
  let z3Plugin: Z3ProverPlugin;

  beforeAll(async () => {
    // Create and initialize Z3 plugin once for all tests
    z3Plugin = z3ProverPlugin({ timeout: 5000 });
    await z3Plugin.init();

    // Register with contracts config for integration tests
    setContractConfig({
      mode: "full",
      proveAtCompileTime: true,
      strip: {},
      proverPlugins: [z3Plugin],
    });
  }, 30000); // Z3 WASM can take a while to load

  afterAll(() => {
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  // ==========================================================================
  // Plugin Lifecycle
  // ==========================================================================

  describe("plugin lifecycle", () => {
    it("should report ready after init", () => {
      expect(z3Plugin.isReady()).toBe(true);
    });

    it("should have correct name", () => {
      expect(z3Plugin.name).toBe("z3");
    });

    it("should handle eager init option", async () => {
      const eager = z3ProverPlugin({ eagerInit: true, timeout: 1000 });
      // Give it time to initialize
      await new Promise((r) => setTimeout(r, 100));
      // May or may not be ready depending on timing, but shouldn't throw
      expect(typeof eager.isReady()).toBe("boolean");
    });
  });

  // ==========================================================================
  // Basic Arithmetic Proofs
  // ==========================================================================

  describe("basic arithmetic proofs", () => {
    it("should prove simple comparison from facts", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("x > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove x >= 0 from x > 0", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("x >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove x > -1 from x >= 0", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0" }];
      const result = await z3Plugin.prove("x > -1", facts);
      expect(result.proven).toBe(true);
    });

    it("should NOT prove x > 0 from x >= 0 (counterexample: x=0)", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0" }];
      const result = await z3Plugin.prove("x > 0", facts);
      expect(result.proven).toBe(false);
    });

    it("should prove sum of positives is positive", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
      ];
      const result = await z3Plugin.prove("x + y > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove sum of non-negatives is non-negative", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0" },
        { variable: "y", predicate: "y >= 0" },
      ];
      const result = await z3Plugin.prove("x + y >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove product of positives is positive", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
      ];
      const result = await z3Plugin.prove("x * y > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove difference bounds", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 10" },
        { variable: "y", predicate: "y <= 5" },
      ];
      const result = await z3Plugin.prove("x - y >= 5", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Complex Arithmetic (beyond algebraic rules)
  // ==========================================================================

  describe("complex arithmetic (beyond algebraic rules)", () => {
    it("should prove (x + y) * 2 > x + y when both positive", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
      ];
      const result = await z3Plugin.prove("(x + y) * 2 > x + y", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove x * x >= 0 (always true)", async () => {
      const facts: TypeFact[] = [];
      const result = await z3Plugin.prove("x * x >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove bounded arithmetic", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0 && x <= 100" },
        { variable: "y", predicate: "y >= 0 && y <= 100" },
      ];
      const result = await z3Plugin.prove("x + y <= 200", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove modular arithmetic", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0" }];
      const result = await z3Plugin.prove("x % 10 >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove division bounds", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 100" }];
      const result = await z3Plugin.prove("x / 10 >= 10", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Logical Operators
  // ==========================================================================

  describe("logical operators", () => {
    it("should prove conjunction from facts", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
      ];
      const result = await z3Plugin.prove("x > 0 && y > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove disjunction when one side is known", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("x > 0 || y > 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove negation", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("!(x <= 0)", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove complex logical formula", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0" },
        { variable: "y", predicate: "y >= 0" },
      ];
      // If both non-negative, at least one is >= 0
      const result = await z3Plugin.prove("x >= 0 || y >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle nested logical operators", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
        { variable: "z", predicate: "z > 0" },
      ];
      const result = await z3Plugin.prove("(x > 0 && y > 0) || z > 0", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Equality and Inequality
  // ==========================================================================

  describe("equality and inequality", () => {
    it("should prove equality from assignment", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x == 5" }];
      const result = await z3Plugin.prove("x === 5", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove inequality", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 5" }];
      const result = await z3Plugin.prove("x != 5", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove strict inequality implies weak", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x !== 0" }];
      // This is NOT provable - x could be positive or negative
      // Just checking it doesn't crash
      const result = await z3Plugin.prove("x > 0", facts);
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Property Access (flattened)
  // ==========================================================================

  describe("property access", () => {
    it("should handle simple property access", async () => {
      const facts: TypeFact[] = [
        { variable: "account_balance", predicate: "account_balance >= 0" },
      ];
      const result = await z3Plugin.prove("account.balance >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle nested property access", async () => {
      const facts: TypeFact[] = [
        {
          variable: "user_account_balance",
          predicate: "user_account_balance > 0",
        },
      ];
      const result = await z3Plugin.prove("user.account.balance > 0", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Parentheses and Precedence
  // ==========================================================================

  describe("parentheses and precedence", () => {
    it("should respect parentheses in arithmetic", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x == 2" },
        { variable: "y", predicate: "y == 3" },
      ];
      // (2 + 3) * 2 = 10
      const result = await z3Plugin.prove("(x + y) * 2 == 10", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle nested parentheses", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("((x > 0))", facts);
      expect(result.proven).toBe(true);
    });

    it("should handle mixed parentheses", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0" },
        { variable: "y", predicate: "y >= 0" },
      ];
      const result = await z3Plugin.prove("(x + y) >= 0 && (x * y) >= 0", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Boolean Literals
  // ==========================================================================

  describe("boolean literals", () => {
    it("should prove true is true", async () => {
      const result = await z3Plugin.prove("true", []);
      expect(result.proven).toBe(true);
    });

    it("should not prove false", async () => {
      const result = await z3Plugin.prove("false", []);
      expect(result.proven).toBe(false);
    });

    it("should handle boolean in expressions", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
      const result = await z3Plugin.prove("x > 0 || false", facts);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe("edge cases and error handling", () => {
    it("should handle empty facts", async () => {
      // x > 0 with no facts is not provable
      const result = await z3Plugin.prove("x > 0", []);
      expect(result.proven).toBe(false);
    });

    it("should handle unparseable predicates gracefully", async () => {
      const result = await z3Plugin.prove("@#$%^&", []);
      expect(result.proven).toBe(false);
      expect(result.reason).toContain("Could not parse");
    });

    it("should handle mismatched parentheses", async () => {
      const result = await z3Plugin.prove("(x > 0", []);
      expect(result.proven).toBe(false);
    });

    it("should handle invalid operators", async () => {
      const result = await z3Plugin.prove("x <> y", []);
      expect(result.proven).toBe(false);
    });
  });

  // ==========================================================================
  // Standalone Helper Function
  // ==========================================================================

  describe("proveWithZ3Async helper", () => {
    it("should prove simple goals", async () => {
      const result = await proveWithZ3Async("x > 0", [{ variable: "x", predicate: "x > 0" }], {
        timeout: 2000,
      });
      expect(result.proven).toBe(true);
    });

    it("should handle initialization internally", async () => {
      // New plugin created internally
      const result = await proveWithZ3Async("true", [], { timeout: 2000 });
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Integration with Proof Engine
  // ==========================================================================

  describe("integration with proof engine", () => {
    it("algebraic rules should handle simple cases first", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x > 0" },
        { variable: "y", predicate: "y > 0" },
      ];

      // This case IS handled by algebraic rules
      const algebraResult = tryAlgebraicProof("x + y > 0", facts);
      expect(algebraResult.proven).toBe(true);
      expect(algebraResult.method).toBe("algebra");
    });

    it("Z3 should handle cases algebraic rules cannot", async () => {
      const facts: TypeFact[] = [
        { variable: "x", predicate: "x >= 0 && x <= 100" },
        { variable: "y", predicate: "y >= 0 && y <= 100" },
      ];

      // Algebraic rules don't handle bounded arithmetic
      const algebraResult = tryAlgebraicProof("x + y <= 200", facts);
      expect(algebraResult.proven).toBe(false);

      // But Z3 can
      const z3Result = await z3Plugin.prove("x + y <= 200", facts);
      expect(z3Result.proven).toBe(true);
    });

    it("proveGoalWithPlugins should use Z3 as fallback", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0 && x <= 255" }];

      const result = await proveGoalWithPlugins("x < 256", facts, [z3Plugin]);
      expect(result.proven).toBe(true);
    });

    it("should prove Byte range constraint", async () => {
      const facts: TypeFact[] = [{ variable: "x", predicate: "x >= 0 && x <= 255" }];

      const result = await proveGoalWithPlugins("x >= 0 && x < 256", facts, [z3Plugin]);
      expect(result.proven).toBe(true);
    });

    it("should prove Port range constraint", async () => {
      const facts: TypeFact[] = [{ variable: "port", predicate: "port >= 1 && port <= 65535" }];

      const result = await proveGoalWithPlugins("port > 0", facts, [z3Plugin]);
      expect(result.proven).toBe(true);
    });
  });

  // ==========================================================================
  // Real-world Contract Scenarios
  // ==========================================================================

  describe("real-world contract scenarios", () => {
    it("should prove withdraw precondition satisfaction", async () => {
      // Scenario: withdraw(amount) where amount <= balance
      const facts: TypeFact[] = [
        { variable: "balance", predicate: "balance >= 0" },
        { variable: "amount", predicate: "amount > 0" },
        { variable: "amount", predicate: "amount <= balance" },
      ];

      // Postcondition: new balance >= 0
      const result = await z3Plugin.prove("balance - amount >= 0", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove array index bounds", async () => {
      const facts: TypeFact[] = [
        { variable: "i", predicate: "i >= 0" },
        { variable: "i", predicate: "i < length" },
        { variable: "length", predicate: "length > 0" },
      ];

      // i is a valid index
      const result = await z3Plugin.prove("i >= 0 && i < length", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove percentage bounds", async () => {
      const facts: TypeFact[] = [{ variable: "p", predicate: "p >= 0 && p <= 100" }];

      const result = await z3Plugin.prove("p / 100 <= 1", facts);
      expect(result.proven).toBe(true);
    });

    it("should prove midpoint calculation stays in bounds", async () => {
      // Classic binary search midpoint: mid = low + (high - low) / 2
      const facts: TypeFact[] = [
        { variable: "low", predicate: "low >= 0" },
        { variable: "high", predicate: "high >= low" },
      ];

      // mid should be >= low
      const result1 = await z3Plugin.prove("low + (high - low) / 2 >= low", facts);
      expect(result1.proven).toBe(true);

      // mid should be <= high
      const result2 = await z3Plugin.prove("low + (high - low) / 2 <= high", facts);
      expect(result2.proven).toBe(true);
    });
  });
});
