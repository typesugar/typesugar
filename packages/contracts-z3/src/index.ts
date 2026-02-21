/**
 * @typesugar/contracts-z3 — Z3 SMT Solver Plugin for @typesugar/contracts
 *
 * Provides a ProverPlugin that uses the Z3 theorem prover to verify
 * contract conditions at compile time. For conditions that the built-in
 * algebraic rules can't handle, Z3 can prove complex arithmetic,
 * logical formulas, and array bounds.
 *
 * ## Usage
 *
 * ```typescript
 * import { registerProverPlugin } from "@typesugar/contracts";
 * import { z3ProverPlugin } from "@typesugar/contracts-z3";
 *
 * // Option 1: Auto-initialize (first proof may be slower)
 * registerProverPlugin(z3ProverPlugin({ timeout: 2000 }));
 *
 * // Option 2: Pre-initialize for faster first proof
 * const z3 = z3ProverPlugin({ timeout: 2000 });
 * await z3.init();
 * registerProverPlugin(z3);
 * ```
 *
 * ## How it works
 *
 * 1. Translates predicate strings + type facts into Z3 assertions
 * 2. Adds the negation of the goal
 * 3. If Z3 returns UNSAT, the goal is proven (negation is impossible)
 * 4. If Z3 returns SAT or UNKNOWN, the goal is not proven
 */

// Types are inlined to avoid build dependency issues
export interface ProofResult {
  proven: boolean;
  method?: "constant" | "type" | "algebra" | "plugin";
  reason?: string;
}

export interface TypeFact {
  variable: string;
  predicate: string;
}

export interface ProverPlugin {
  name: string;
  prove(goal: string, facts: TypeFact[], timeout?: number): ProofResult | Promise<ProofResult>;
}

export interface Z3PluginOptions {
  /** Timeout in milliseconds for Z3 solver (default: 1000) */
  timeout?: number;
  /** Initialize Z3 eagerly on plugin creation (default: false) */
  eagerInit?: boolean;
}

export interface Z3ProverPlugin extends ProverPlugin {
  /** Pre-initialize Z3 WASM module. Call this to avoid first-proof latency. */
  init(): Promise<void>;
  /** Check if Z3 is initialized and ready */
  isReady(): boolean;
}

// Z3 types are complex and vary by version, use any for internal implementation
type Z3Instance = any;
type Z3Context = any;
type Z3Expr = any;

/**
 * Create a Z3 prover plugin.
 */
export function z3ProverPlugin(options: Z3PluginOptions = {}): Z3ProverPlugin {
  const timeout = options.timeout ?? 1000;
  let z3: Z3Instance | null = null;
  let initPromise: Promise<void> | null = null;
  let initError: Error | null = null;

  async function doInit(): Promise<void> {
    if (z3) return;
    if (initError) throw initError;

    try {
      const { init } = await import("z3-solver");
      z3 = await init();
    } catch (error) {
      initError = error instanceof Error ? error : new Error(String(error));
      throw initError;
    }
  }

  async function ensureInit(): Promise<void> {
    if (z3) return;
    if (initPromise) {
      await initPromise;
      return;
    }
    initPromise = doInit();
    await initPromise;
  }

  // Kick off eager init if requested
  if (options.eagerInit) {
    ensureInit().catch(() => {});
  }

  const plugin: Z3ProverPlugin = {
    name: "z3",

    async init(): Promise<void> {
      await ensureInit();
    },

    isReady(): boolean {
      return z3 !== null;
    },

    async prove(goal: string, facts: TypeFact[], overrideTimeout?: number): Promise<ProofResult> {
      try {
        // Ensure Z3 is initialized
        if (!z3) {
          await ensureInit();
        }

        if (!z3) {
          return { proven: false, reason: "Z3 initialization failed" };
        }

        return await proveWithZ3(z3, goal, facts, overrideTimeout ?? timeout);
      } catch (error) {
        return {
          proven: false,
          reason: `Z3 error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return plugin;
}

/**
 * Prove a goal using Z3.
 *
 * Strategy: assert all facts, then assert the negation of the goal.
 * If UNSAT, the goal must be true given the facts.
 */
async function proveWithZ3(
  z3: Z3Instance,
  goal: string,
  facts: TypeFact[],
  timeout: number
): Promise<ProofResult> {
  const ctx = z3.Context("proof");

  try {
    const solver = new ctx.Solver();
    solver.set("timeout", timeout);

    // Track variables with their types
    const variables = new Map<string, Z3Expr>();
    const parser = new PredicateParser(ctx, variables);

    // Parse and assert facts
    for (const fact of facts) {
      const assertion = parser.parse(fact.predicate);
      if (assertion) {
        solver.add(assertion);
      }
    }

    // Parse and negate the goal
    const goalAssertion = parser.parse(goal);
    if (!goalAssertion) {
      return { proven: false, reason: `Could not parse goal: ${goal}` };
    }
    solver.add(ctx.Not(goalAssertion));

    // Check satisfiability (async in z3-solver)
    const result = await solver.check();
    if (result === "unsat") {
      return {
        proven: true,
        method: "plugin",
        reason: "Z3: negation is unsatisfiable",
      };
    }

    return {
      proven: false,
      reason: `Z3: ${result}`,
    };
  } catch (error) {
    return {
      proven: false,
      reason: `Z3 error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Predicate Parser
// ============================================================================

/**
 * Parser for predicate expressions into Z3 assertions.
 *
 * Supports:
 * - Arithmetic: +, -, *, /, %
 * - Comparisons: >, >=, <, <=, ===, !==, ==, !=
 * - Logical: &&, ||, !
 * - Parentheses for grouping
 * - Property access: obj.prop (flattened to obj_prop)
 * - Integer and floating-point literals
 * - Boolean literals: true, false
 */
class PredicateParser {
  private pos = 0;
  private input = "";

  constructor(
    private ctx: Z3Context,
    private variables: Map<string, Z3Expr>
  ) {}

  parse(predicate: string): Z3Expr | null {
    this.input = predicate.trim();
    this.pos = 0;

    try {
      const result = this.parseOr();
      this.skipWhitespace();
      if (this.pos < this.input.length) {
        // Didn't consume entire input
        return null;
      }
      return result;
    } catch {
      return null;
    }
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private peek(n = 1): string {
    return this.input.slice(this.pos, this.pos + n);
  }

  private consume(expected: string): boolean {
    this.skipWhitespace();
    if (this.input.slice(this.pos, this.pos + expected.length) === expected) {
      this.pos += expected.length;
      return true;
    }
    return false;
  }

  // Precedence: || (lowest)
  private parseOr(): Z3Expr | null {
    let left = this.parseAnd();
    if (!left) return null;

    while (this.consume("||")) {
      const right = this.parseAnd();
      if (!right) return null;
      left = this.ctx.Or(left, right);
    }

    return left;
  }

  // Precedence: &&
  private parseAnd(): Z3Expr | null {
    let left = this.parseNot();
    if (!left) return null;

    while (this.consume("&&")) {
      const right = this.parseNot();
      if (!right) return null;
      left = this.ctx.And(left, right);
    }

    return left;
  }

  // Precedence: !
  private parseNot(): Z3Expr | null {
    this.skipWhitespace();
    if (this.consume("!")) {
      const expr = this.parseNot();
      if (!expr) return null;
      return this.ctx.Not(expr);
    }
    return this.parseComparison();
  }

  // Precedence: >, >=, <, <=, ===, !==, ==, !=
  private parseComparison(): Z3Expr | null {
    const left = this.parseAddSub();
    if (!left) return null;

    this.skipWhitespace();

    // Check for comparison operators (longest first)
    const ops = ["===", "!==", ">=", "<=", "==", "!=", ">", "<"];
    for (const op of ops) {
      if (this.consume(op)) {
        const right = this.parseAddSub();
        if (!right) return null;

        switch (op) {
          case ">":
            return left.gt(right);
          case ">=":
            return left.ge(right);
          case "<":
            return left.lt(right);
          case "<=":
            return left.le(right);
          case "===":
          case "==":
            return left.eq(right);
          case "!==":
          case "!=":
            return left.neq(right);
        }
      }
    }

    return left;
  }

  // Precedence: +, -
  private parseAddSub(): Z3Expr | null {
    let left = this.parseMulDivMod();
    if (!left) return null;

    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) {
        const right = this.parseMulDivMod();
        if (!right) return null;
        left = left.add(right);
      } else if (this.consume("-")) {
        const right = this.parseMulDivMod();
        if (!right) return null;
        left = left.sub(right);
      } else {
        break;
      }
    }

    return left;
  }

  // Precedence: *, /, %
  private parseMulDivMod(): Z3Expr | null {
    let left = this.parseUnary();
    if (!left) return null;

    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) {
        const right = this.parseUnary();
        if (!right) return null;
        left = left.mul(right);
      } else if (this.consume("/")) {
        const right = this.parseUnary();
        if (!right) return null;
        left = left.div(right);
      } else if (this.consume("%")) {
        const right = this.parseUnary();
        if (!right) return null;
        left = left.mod(right);
      } else {
        break;
      }
    }

    return left;
  }

  // Precedence: unary - (negation)
  private parseUnary(): Z3Expr | null {
    this.skipWhitespace();
    if (this.consume("-")) {
      const expr = this.parseUnary();
      if (!expr) return null;
      return expr.neg();
    }
    return this.parsePrimary();
  }

  // Precedence: atoms (highest)
  private parsePrimary(): Z3Expr | null {
    this.skipWhitespace();

    // Parenthesized expression
    if (this.consume("(")) {
      const expr = this.parseOr();
      if (!expr || !this.consume(")")) return null;
      return expr;
    }

    // Boolean literals
    if (this.consume("true")) {
      return this.ctx.Bool.val(true);
    }
    if (this.consume("false")) {
      return this.ctx.Bool.val(false);
    }

    // Number literal
    const numMatch = this.input.slice(this.pos).match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      this.pos += numMatch[0].length;
      const value = parseFloat(numMatch[0]);
      if (numMatch[1]) {
        // Floating point
        return this.ctx.Real.val(value);
      }
      return this.ctx.Int.val(value);
    }

    // Identifier (variable or property access)
    const idMatch = this.input.slice(this.pos).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (idMatch) {
      this.pos += idMatch[0].length;
      let name = idMatch[0];

      // Handle property access: obj.prop.subprop -> obj_prop_subprop
      while (this.consume(".")) {
        const propMatch = this.input.slice(this.pos).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
        if (!propMatch) return null;
        this.pos += propMatch[0].length;
        name += "_" + propMatch[0];
      }

      return this.getOrCreateVariable(name);
    }

    return null;
  }

  private getOrCreateVariable(name: string): Z3Expr {
    if (this.variables.has(name)) {
      return this.variables.get(name)!;
    }
    // Default to Int for now - could be smarter with type info
    const v = this.ctx.Int.const(name);
    this.variables.set(name, v);
    return v;
  }
}

// ============================================================================
// Standalone Proof Function
// ============================================================================

/**
 * Standalone function to prove a goal with Z3.
 * Useful for one-off proofs or testing.
 */
export async function proveWithZ3Async(
  goal: string,
  facts: TypeFact[],
  options: Z3PluginOptions = {}
): Promise<ProofResult> {
  const plugin = z3ProverPlugin(options);
  await plugin.init();
  const result = plugin.prove(goal, facts);
  return result instanceof Promise ? result : result;
}
