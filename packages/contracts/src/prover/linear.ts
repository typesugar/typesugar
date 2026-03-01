/**
 * Linear Arithmetic Solver (Coq-inspired)
 *
 * Fast built-in solver for linear inequalities using Fourier-Motzkin
 * variable elimination.
 *
 * ## Algorithm: Fourier-Motzkin Elimination
 *
 * To prove that a goal follows from constraints:
 * 1. Negate the goal and add to constraints
 * 2. Eliminate variables one by one
 * 3. If we derive a contradiction (0 > 0), the goal is proven
 *
 * ## Supported Patterns
 *
 * - Linear inequalities: a*x + b*y op c where op ∈ {<, <=, >, >=, ==}
 * - Transitivity: x > y, y > z → x > z
 * - Bounds propagation: x > 0, y >= 0 → x + y > 0
 * - Simple arithmetic: constants and variable sums/differences
 *
 * ## Limitations
 *
 * - Only handles linear constraints (no multiplication of variables)
 * - May not scale well with many variables (exponential in worst case)
 * - Does not handle modular arithmetic or floor/ceil
 */

import type { TypeFact } from "./type-facts.js";
import type { ProofResult } from "./index.js";
import type { ProofStep } from "./certificate.js";

/**
 * Shared regex patterns for parsing.
 * Finding #10: Support scientific notation in numbers
 * Finding #11: Support unicode variable names
 */
const NUM_PATTERN = "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
const VAR_PATTERN = "[\\p{L}\\p{N}_$]+";

/**
 * A linear constraint in normalized form: sum(coeff[i] * var[i]) op constant
 */
interface LinearConstraint {
  /** Coefficients for each variable (sparse representation) */
  coefficients: Map<string, number>;
  /** The comparison operator */
  operator: "<" | "<=" | ">" | ">=" | "==";
  /** The constant (right-hand side) */
  constant: number;
  /** Human-readable source of this constraint */
  source: string;
}

/**
 * Extended proof result with proof step for certificates.
 */
export interface LinearProofResult extends ProofResult {
  step?: ProofStep;
}

/**
 * Parse a predicate string into a linear constraint, if possible.
 * Returns undefined if the predicate is not a linear constraint.
 */
function parseLinearConstraint(pred: string): LinearConstraint | undefined {
  const coefficients = new Map<string, number>();

  // Match patterns like: x > 0, x + y >= 0, 2*x - y <= 10, x == y, etc.
  // Using shared patterns for unicode vars (Finding #11) and scientific notation (Finding #10)

  // Simple patterns
  const patterns: Array<{
    regex: RegExp;
    parse: (m: RegExpMatchArray) => LinearConstraint | undefined;
  }> = [
    // x > 0, x >= 0, x < 0, x <= 0
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*0$`, "u"),
      parse: (m) => ({
        coefficients: new Map([[m[1], 1]]),
        operator: m[2] as LinearConstraint["operator"],
        constant: 0,
        source: pred,
      }),
    },
    // x > y, x >= y, x < y, x <= y
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*(${VAR_PATTERN})$`, "u"),
      parse: (m) => ({
        coefficients: new Map([
          [m[1], 1],
          [m[3], -1],
        ]),
        operator: m[2] as LinearConstraint["operator"],
        constant: 0,
        source: pred,
      }),
    },
    // x + y > 0, x + y >= 0
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*\\+\\s*(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*0$`, "u"),
      parse: (m) => ({
        coefficients: new Map([
          [m[1], 1],
          [m[2], 1],
        ]),
        operator: m[3] as LinearConstraint["operator"],
        constant: 0,
        source: pred,
      }),
    },
    // x - y > 0, x - y >= 0
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*-\\s*(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*0$`, "u"),
      parse: (m) => ({
        coefficients: new Map([
          [m[1], 1],
          [m[2], -1],
        ]),
        operator: m[3] as LinearConstraint["operator"],
        constant: 0,
        source: pred,
      }),
    },
    // x > c, x >= c, x < c, x <= c (numeric constant with scientific notation)
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*(${NUM_PATTERN})$`, "u"),
      parse: (m) => ({
        coefficients: new Map([[m[1], 1]]),
        operator: m[2] as LinearConstraint["operator"],
        constant: parseFloat(m[3]),
        source: pred,
      }),
    },
    // c > x, c >= x, etc.
    {
      regex: new RegExp(`^(${NUM_PATTERN})\\s*(>|>=|<|<=)\\s*(${VAR_PATTERN})$`, "u"),
      parse: (m) => ({
        coefficients: new Map([[m[3], -1]]),
        operator: flipOperator(m[2] as LinearConstraint["operator"]),
        constant: -parseFloat(m[1]),
        source: pred,
      }),
    },
    // x == y
    {
      regex: new RegExp(`^(${VAR_PATTERN})\\s*===?\\s*(${VAR_PATTERN})$`, "u"),
      parse: (m) => ({
        coefficients: new Map([
          [m[1], 1],
          [m[2], -1],
        ]),
        operator: "==" as const,
        constant: 0,
        source: pred,
      }),
    },
    // x + y > c
    {
      regex: new RegExp(
        `^(${VAR_PATTERN})\\s*\\+\\s*(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*(${NUM_PATTERN})$`,
        "u"
      ),
      parse: (m) => ({
        coefficients: new Map([
          [m[1], 1],
          [m[2], 1],
        ]),
        operator: m[3] as LinearConstraint["operator"],
        constant: parseFloat(m[4]),
        source: pred,
      }),
    },
    // Bounded: x >= a && x <= b
    {
      regex: new RegExp(
        `^(${VAR_PATTERN})\\s*>=\\s*(${NUM_PATTERN})\\s*&&\\s*\\1\\s*<=\\s*(${NUM_PATTERN})$`,
        "u"
      ),
      parse: () => undefined, // Handle as two separate constraints
    },
  ];

  for (const { regex, parse } of patterns) {
    const match = pred.match(regex);
    if (match) {
      return parse(match);
    }
  }

  return undefined;
}

/**
 * Flip a comparison operator (for moving terms across the inequality).
 */
function flipOperator(op: LinearConstraint["operator"]): LinearConstraint["operator"] {
  switch (op) {
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    case "==":
      return "==";
  }
}

/**
 * Negate a constraint (for proof by contradiction).
 */
function negateConstraint(c: LinearConstraint): LinearConstraint {
  switch (c.operator) {
    case "<":
      return { ...c, operator: ">=" };
    case "<=":
      return { ...c, operator: ">" };
    case ">":
      return { ...c, operator: "<=" };
    case ">=":
      return { ...c, operator: "<" };
    case "==":
      // Negation of == is != which we can't directly represent
      // Instead, we try both < and > separately
      return { ...c, operator: "<" }; // Partial
  }
}

/**
 * Check if a constraint is trivially true (e.g., 0 <= 5).
 */
function isTriviallyTrue(c: LinearConstraint): boolean {
  if (c.coefficients.size > 0) return false;
  const lhs = 0;
  const rhs = c.constant;
  switch (c.operator) {
    case "<":
      return lhs < rhs;
    case "<=":
      return lhs <= rhs;
    case ">":
      return lhs > rhs;
    case ">=":
      return lhs >= rhs;
    case "==":
      return lhs === rhs;
  }
}

/**
 * Check if a constraint is trivially false (contradiction).
 */
function isTriviallyFalse(c: LinearConstraint): boolean {
  if (c.coefficients.size > 0) return false;
  const lhs = 0;
  const rhs = c.constant;
  switch (c.operator) {
    case "<":
      return lhs >= rhs;
    case "<=":
      return lhs > rhs;
    case ">":
      return lhs <= rhs;
    case ">=":
      return lhs < rhs;
    case "==":
      return lhs !== rhs;
  }
}

/**
 * Eliminate a variable from a set of constraints using Fourier-Motzkin.
 */
function eliminateVariable(constraints: LinearConstraint[], variable: string): LinearConstraint[] {
  const lower: LinearConstraint[] = []; // coefficient > 0 (x >= ...)
  const upper: LinearConstraint[] = []; // coefficient < 0 (x <= ...)
  const noVar: LinearConstraint[] = []; // doesn't contain variable

  for (const c of constraints) {
    const coeff = c.coefficients.get(variable) ?? 0;
    if (coeff === 0) {
      noVar.push(c);
    } else if (coeff > 0) {
      lower.push(c);
    } else {
      upper.push(c);
    }
  }

  const result = [...noVar];

  // Combine lower and upper bounds
  for (const lo of lower) {
    for (const up of upper) {
      const combined = combineConstraints(lo, up, variable);
      if (combined) {
        result.push(combined);
      }
    }
  }

  return result;
}

/**
 * Combine two constraints to eliminate a variable.
 * Given: c1 * x + ... op1 const1 (c1 > 0)
 *        c2 * x + ... op2 const2 (c2 < 0)
 * We can eliminate x by multiplying and adding.
 */
function combineConstraints(
  lower: LinearConstraint,
  upper: LinearConstraint,
  variable: string
): LinearConstraint | undefined {
  const c1 = lower.coefficients.get(variable) ?? 0;
  const c2 = upper.coefficients.get(variable) ?? 0;

  if (c1 <= 0 || c2 >= 0) return undefined;

  // Normalize: multiply lower by |c2| and upper by c1
  const m1 = Math.abs(c2);
  const m2 = c1;

  const newCoeffs = new Map<string, number>();

  for (const [v, c] of lower.coefficients) {
    if (v !== variable) {
      newCoeffs.set(v, (newCoeffs.get(v) ?? 0) + c * m1);
    }
  }

  for (const [v, c] of upper.coefficients) {
    if (v !== variable) {
      newCoeffs.set(v, (newCoeffs.get(v) ?? 0) + c * m2);
    }
  }

  // Remove zero coefficients
  for (const [v, c] of newCoeffs) {
    if (c === 0) newCoeffs.delete(v);
  }

  // Combine operators (conservatively)
  let operator: LinearConstraint["operator"];
  if (lower.operator === "<" || upper.operator === ">") {
    operator = "<";
  } else if (lower.operator === "<=" || upper.operator === ">=") {
    operator = "<=";
  } else {
    operator = "<="; // Conservative
  }

  return {
    coefficients: newCoeffs,
    operator,
    constant: lower.constant * m1 + upper.constant * m2,
    source: `Eliminated ${variable} from: ${lower.source}, ${upper.source}`,
  };
}

/**
 * Get all variables in a set of constraints.
 */
function getVariables(constraints: LinearConstraint[]): Set<string> {
  const vars = new Set<string>();
  for (const c of constraints) {
    for (const v of c.coefficients.keys()) {
      vars.add(v);
    }
  }
  return vars;
}

/**
 * Try to prove a goal using Fourier-Motzkin elimination.
 *
 * Algorithm:
 * 1. Parse facts into linear constraints
 * 2. Parse and negate the goal
 * 3. Add negated goal to constraints
 * 4. Eliminate all variables
 * 5. Check for contradiction
 */
export function tryLinearProof(goal: string, facts: TypeFact[]): LinearProofResult {
  // Parse facts into constraints
  const constraints: LinearConstraint[] = [];

  for (const fact of facts) {
    // Handle compound facts (x >= 0 && x <= 255)
    const parts = fact.predicate.split("&&").map((p) => p.trim());
    for (const part of parts) {
      const constraint = parseLinearConstraint(part);
      if (constraint) {
        constraints.push(constraint);
      }
    }
  }

  if (constraints.length === 0) {
    return { proven: false };
  }

  // Parse and negate the goal
  const goalConstraint = parseLinearConstraint(goal.trim());
  if (!goalConstraint) {
    return { proven: false };
  }

  // Add negated goal (proof by contradiction)
  const negatedGoal = negateConstraint(goalConstraint);
  const allConstraints = [...constraints, negatedGoal];

  // Eliminate all variables
  let current = allConstraints;
  const variables = getVariables(current);

  for (const variable of variables) {
    current = eliminateVariable(current, variable);

    // Check for early contradiction
    for (const c of current) {
      if (isTriviallyFalse(c)) {
        const usedFacts = facts.filter((f) => {
          const parsed = parseLinearConstraint(f.predicate);
          return parsed !== undefined;
        });

        return {
          proven: true,
          method: "linear",
          reason: `Linear arithmetic: contradiction found after eliminating ${variable}`,
          step: {
            rule: "fourier_motzkin",
            description: `Fourier-Motzkin variable elimination found contradiction`,
            justification: `Eliminated ${variable}, derived: ${c.source}`,
            usedFacts,
            subgoals: [],
          },
        };
      }
    }
  }

  // Check final constraints for contradiction
  for (const c of current) {
    if (isTriviallyFalse(c)) {
      const usedFacts = facts.filter((f) => {
        const parsed = parseLinearConstraint(f.predicate);
        return parsed !== undefined;
      });

      return {
        proven: true,
        method: "linear",
        reason: "Linear arithmetic: contradiction in constraints",
        step: {
          rule: "fourier_motzkin",
          description: `Fourier-Motzkin elimination derived contradiction`,
          justification: `Final constraint: ${c.source}`,
          usedFacts,
          subgoals: [],
        },
      };
    }
  }

  return { proven: false };
}

/**
 * Quick check for simple linear proofs without full elimination.
 * Handles common patterns directly.
 */
export function trySimpleLinearProof(goal: string, facts: TypeFact[]): LinearProofResult {
  // Pattern: Direct match - goal exactly matches a fact's predicate
  const normalizedGoal = goal.trim();
  const directMatch = facts.find((f) => f.predicate.trim() === normalizedGoal);
  if (directMatch) {
    return {
      proven: true,
      method: "linear",
      reason: `Linear arithmetic: direct match`,
      step: {
        rule: "linear_direct_match",
        description: `Goal directly matches a known fact`,
        justification: `${normalizedGoal} is directly stated`,
        usedFacts: [directMatch],
        subgoals: [],
      },
    };
  }

  // Pattern: Stricter bound implies weaker bound
  // e.g., x > 5 implies x > 0, x >= 10 implies x >= 0
  const boundRegex = new RegExp(`^(${VAR_PATTERN})\\s*(>|>=|<|<=)\\s*(${NUM_PATTERN})$`, "u");
  const boundMatch = goal.match(boundRegex);
  if (boundMatch) {
    const [, varName, goalOp, goalBoundStr] = boundMatch;
    const goalBound = parseFloat(goalBoundStr);

    // Find facts about this variable with bounds (including equality)
    for (const fact of facts) {
      // Check inequality facts
      const factMatch = fact.predicate.match(boundRegex);
      if (factMatch && factMatch[1] === varName) {
        const [, , factOp, factBoundStr] = factMatch;
        const factBound = parseFloat(factBoundStr);

        // Check if fact implies goal
        let implies = false;
        let justification = "";

        if (goalOp === ">" || goalOp === ">=") {
          // Goal: x > c or x >= c
          // Fact x > f implies goal if f >= c (for >) or f > c (for >=)
          // Fact x >= f implies goal if f > c (for >) or f >= c (for >=)
          if (factOp === ">" && factBound >= goalBound) {
            implies = true;
            justification = `${varName} > ${factBound} implies ${varName} ${goalOp} ${goalBound}`;
          } else if (factOp === ">=" && factBound > goalBound) {
            implies = true;
            justification = `${varName} >= ${factBound} implies ${varName} ${goalOp} ${goalBound}`;
          } else if (goalOp === ">=" && factOp === ">=" && factBound >= goalBound) {
            implies = true;
            justification = `${varName} >= ${factBound} implies ${varName} >= ${goalBound}`;
          }
        } else if (goalOp === "<" || goalOp === "<=") {
          // Goal: x < c or x <= c
          // Fact x < f implies goal if f <= c (for <) or f < c (for <=)
          // Fact x <= f implies goal if f < c (for <) or f <= c (for <=)
          if (factOp === "<" && factBound <= goalBound) {
            implies = true;
            justification = `${varName} < ${factBound} implies ${varName} ${goalOp} ${goalBound}`;
          } else if (factOp === "<=" && factBound < goalBound) {
            implies = true;
            justification = `${varName} <= ${factBound} implies ${varName} ${goalOp} ${goalBound}`;
          } else if (goalOp === "<=" && factOp === "<=" && factBound <= goalBound) {
            implies = true;
            justification = `${varName} <= ${factBound} implies ${varName} <= ${goalBound}`;
          }
        }

        if (implies) {
          return {
            proven: true,
            method: "linear",
            reason: `Linear arithmetic: stricter bound implies weaker bound`,
            step: {
              rule: "linear_bound_implication",
              description: `A stricter bound implies a weaker bound`,
              justification,
              usedFacts: [fact],
              subgoals: [],
            },
          };
        }
      }

      // Finding #12: Check equality facts (x == c implies x > d if c > d, etc.)
      const eqRegex = new RegExp(`^(${VAR_PATTERN})\\s*===?\\s*(${NUM_PATTERN})$`, "u");
      const eqMatch = fact.predicate.match(eqRegex);
      if (eqMatch && eqMatch[1] === varName) {
        const eqVal = parseFloat(eqMatch[2]);

        let implies = false;
        let justification = "";

        if (goalOp === ">=" && eqVal >= goalBound) {
          implies = true;
          justification = `${varName} === ${eqVal} implies ${varName} >= ${goalBound}`;
        } else if (goalOp === ">" && eqVal > goalBound) {
          implies = true;
          justification = `${varName} === ${eqVal} implies ${varName} > ${goalBound}`;
        } else if (goalOp === "<=" && eqVal <= goalBound) {
          implies = true;
          justification = `${varName} === ${eqVal} implies ${varName} <= ${goalBound}`;
        } else if (goalOp === "<" && eqVal < goalBound) {
          implies = true;
          justification = `${varName} === ${eqVal} implies ${varName} < ${goalBound}`;
        }

        if (implies) {
          return {
            proven: true,
            method: "linear",
            reason: `Linear arithmetic: equality implies inequality`,
            step: {
              rule: "linear_eq_implies_ineq",
              description: `Equality implies all bounds satisfied by the value`,
              justification,
              usedFacts: [fact],
              subgoals: [],
            },
          };
        }
      }
    }
  }

  // Pattern: x >= 0 given x > 0 (positive implies non-negative)
  const nonNegMatch = goal.match(/^(\w+)\s*>=\s*0$/);
  if (nonNegMatch) {
    const [, a] = nonNegMatch;
    const aPos = facts.find((f) => f.variable === a && f.predicate.includes("> 0"));
    if (aPos) {
      return {
        proven: true,
        method: "linear",
        reason: `Linear arithmetic: positive implies non-negative`,
        step: {
          rule: "linear_pos_implies_nonneg",
          description: `Any positive number is also non-negative`,
          justification: `${a} >= 0 because ${a} > 0`,
          usedFacts: [aPos],
          subgoals: [],
        },
      };
    }
  }

  // Pattern: x + y > 0 given x > 0, y >= 0
  const sumPos = goal.match(/^(\w+)\s*\+\s*(\w+)\s*>\s*0$/);
  if (sumPos) {
    const [, a, b] = sumPos;
    const aPos = facts.find(
      (f) => f.variable === a && (f.predicate.includes("> 0") || f.predicate.includes(">= 0"))
    );
    const bPos = facts.find(
      (f) => f.variable === b && (f.predicate.includes("> 0") || f.predicate.includes(">= 0"))
    );

    // Need at least one strictly positive
    const aStrict = facts.some((f) => f.variable === a && f.predicate.includes("> 0"));
    const bStrict = facts.some((f) => f.variable === b && f.predicate.includes("> 0"));

    if (aPos && bPos && (aStrict || bStrict)) {
      return {
        proven: true,
        method: "linear",
        reason: `Linear arithmetic: sum of positive and non-negative is positive`,
        step: {
          rule: "linear_sum_positive",
          description: `Sum of positive and non-negative numbers is positive`,
          justification: `${a} + ${b} > 0 because ${aStrict ? `${a} > 0` : `${a} >= 0`} and ${bStrict ? `${b} > 0` : `${b} >= 0`}`,
          usedFacts: [aPos, bPos].filter(Boolean) as TypeFact[],
          subgoals: [],
        },
      };
    }
  }

  // Pattern: x + y >= 0 given x >= 0 (or x > 0) and y >= 0 (or y > 0)
  const sumNonNeg = goal.match(/^(\w+)\s*\+\s*(\w+)\s*>=\s*0$/);
  if (sumNonNeg) {
    const [, a, b] = sumNonNeg;
    // Both must be non-negative (>= 0) or positive (> 0)
    const aNonNeg = facts.find(
      (f) => f.variable === a && (f.predicate.includes("> 0") || f.predicate.includes(">= 0"))
    );
    const bNonNeg = facts.find(
      (f) => f.variable === b && (f.predicate.includes("> 0") || f.predicate.includes(">= 0"))
    );

    if (aNonNeg && bNonNeg) {
      return {
        proven: true,
        method: "linear",
        reason: `Linear arithmetic: sum of non-negative numbers is non-negative`,
        step: {
          rule: "linear_sum_nonneg",
          description: `Sum of non-negative numbers is non-negative`,
          justification: `${a} + ${b} >= 0 because ${a} >= 0 and ${b} >= 0`,
          usedFacts: [aNonNeg, bNonNeg],
          subgoals: [],
        },
      };
    }
  }

  // Pattern: x + y >= c given x >= a, y >= b where a + b >= c
  const sumBoundMatch = goal.match(/^(\w+)\s*\+\s*(\w+)\s*(>=|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (sumBoundMatch) {
    const [, a, b, op, targetStr] = sumBoundMatch;
    const target = parseFloat(targetStr);

    // Find bounds for a and b
    const aBound = facts.find((f) => {
      const m = f.predicate.match(/^(\w+)\s*>=\s*(-?\d+(?:\.\d+)?)$/);
      return m && m[1] === a;
    });
    const bBound = facts.find((f) => {
      const m = f.predicate.match(/^(\w+)\s*>=\s*(-?\d+(?:\.\d+)?)$/);
      return m && m[1] === b;
    });

    if (aBound && bBound) {
      const aVal = parseFloat(aBound.predicate.match(/>=\s*(-?\d+(?:\.\d+)?)$/)?.[1] ?? "0");
      const bVal = parseFloat(bBound.predicate.match(/>=\s*(-?\d+(?:\.\d+)?)$/)?.[1] ?? "0");

      if ((op === ">=" && aVal + bVal >= target) || (op === ">" && aVal + bVal > target)) {
        return {
          proven: true,
          method: "linear",
          reason: `Linear arithmetic: sum of bounds`,
          step: {
            rule: "linear_sum_bounds",
            description: `Sum of lower bounds gives lower bound on sum`,
            justification: `${a} + ${b} ${op} ${target} because ${a} >= ${aVal} and ${b} >= ${bVal}`,
            usedFacts: [aBound, bBound],
            subgoals: [],
          },
        };
      }
    }
  }

  // Pattern: transitivity x > z given x > y, y > z
  const transMatch = goal.match(/^(\w+)\s*(>|>=)\s*(\w+)$/);
  if (transMatch) {
    const [, a, op, c] = transMatch;

    // Look for chain: a > b and b > c (or a >= b and b >= c)
    for (const f1 of facts) {
      const m1 = f1.predicate.match(/^(\w+)\s*(>|>=)\s*(\w+)$/);
      if (m1 && m1[1] === a) {
        const b = m1[3];
        const op1 = m1[2];
        // Look for b > c
        const f2 = facts.find((f) => {
          const m2 = f.predicate.match(/^(\w+)\s*(>|>=)\s*(\w+)$/);
          return m2 && m2[1] === b && m2[3] === c;
        });

        if (f2) {
          const m2 = f2.predicate.match(/^(\w+)\s*(>|>=)\s*(\w+)$/);
          const op2 = m2?.[2];
          // Can prove a > c if either is strict
          const canProveStrict = (op1 === ">" || op2 === ">") && (op === ">" || op === ">=");
          const canProveWeak = op1 === ">=" && op2 === ">=" && op === ">=";

          if (canProveStrict || canProveWeak) {
            return {
              proven: true,
              method: "linear",
              reason: `Linear arithmetic: transitivity`,
              step: {
                rule: "linear_transitivity",
                description: `Transitivity of ${op1}/${op2}`,
                justification: `${a} ${op} ${c} because ${a} ${op1} ${b} and ${b} ${op2} ${c}`,
                usedFacts: [f1, f2],
                subgoals: [],
              },
            };
          }
        }

        // Also check: a > b and b > 0, goal is a > 0
        if (c === "0") {
          const bPos = facts.find((f) => {
            const m = f.predicate.match(/^(\w+)\s*(>|>=)\s*0$/);
            return m && m[1] === b;
          });
          if (bPos) {
            const bOp = bPos.predicate.match(/^(\w+)\s*(>|>=)\s*0$/)?.[2];
            const canProve = (op1 === ">" || bOp === ">") && (op === ">" || op === ">=");

            if (canProve) {
              return {
                proven: true,
                method: "linear",
                reason: `Linear arithmetic: transitivity with zero`,
                step: {
                  rule: "linear_transitivity_zero",
                  description: `Transitivity through zero bound`,
                  justification: `${a} ${op} 0 because ${a} ${op1} ${b} and ${b} ${bOp} 0`,
                  usedFacts: [f1, bPos],
                  subgoals: [],
                },
              };
            }
          }
        }
      }
    }

    // Pattern: x > y given x > 0, y < 0
    const aPos = facts.find((f) => f.variable === a && f.predicate.includes("> 0"));
    const cNeg = facts.find((f) => f.variable === c && f.predicate.includes("< 0"));

    if (aPos && cNeg) {
      return {
        proven: true,
        method: "linear",
        reason: `Linear arithmetic: positive > negative`,
        step: {
          rule: "linear_pos_gt_neg",
          description: `Any positive number is greater than any negative number`,
          justification: `${a} > ${c} because ${a} > 0 > ${c}`,
          usedFacts: [aPos, cNeg],
          subgoals: [],
        },
      };
    }
  }

  // Pattern: x >= c given x === c (equality implies bounds)
  const eqBoundMatch = goal.match(/^(\w+)\s*(>=|<=)\s*(-?\d+(?:\.\d+)?)$/);
  if (eqBoundMatch) {
    const [, varName, op, boundStr] = eqBoundMatch;
    const bound = parseFloat(boundStr);

    // Look for equality fact
    const eqFact = facts.find((f) => {
      const m = f.predicate.match(/^(\w+)\s*===?\s*(-?\d+(?:\.\d+)?)$/);
      return m && m[1] === varName;
    });

    if (eqFact) {
      const eqVal = parseFloat(eqFact.predicate.match(/===?\s*(-?\d+(?:\.\d+)?)$/)?.[1] ?? "0");
      const proves = (op === ">=" && eqVal >= bound) || (op === "<=" && eqVal <= bound);

      if (proves) {
        return {
          proven: true,
          method: "linear",
          reason: `Linear arithmetic: equality implies bound`,
          step: {
            rule: "linear_eq_bound",
            description: `Equality implies both upper and lower bounds`,
            justification: `${varName} ${op} ${bound} because ${varName} === ${eqVal}`,
            usedFacts: [eqFact],
            subgoals: [],
          },
        };
      }
    }
  }

  return { proven: false };
}

/**
 * Split compound predicates (e.g., "x >= 0 && x <= 255") into individual facts.
 * This ensures both simple pattern matching and Fourier-Motzkin see atomic constraints.
 */
function splitFacts(facts: TypeFact[]): TypeFact[] {
  const result: TypeFact[] = [];
  for (const fact of facts) {
    const parts = fact.predicate.split("&&").map((p) => p.trim());
    for (const part of parts) {
      if (part) {
        result.push({ ...fact, predicate: part });
      }
    }
  }
  return result;
}

/**
 * Combined linear arithmetic proof.
 * Tries simple patterns first, then full Fourier-Motzkin.
 */
export function tryLinearArithmetic(goal: string, facts: TypeFact[]): LinearProofResult {
  // Normalize compound predicates before either proof strategy runs
  const normalizedFacts = splitFacts(facts);

  // Try simple patterns first (fast)
  const simple = trySimpleLinearProof(goal, normalizedFacts);
  if (simple.proven) return simple;

  // Try full Fourier-Motzkin (slower but more complete)
  return tryLinearProof(goal, normalizedFacts);
}
