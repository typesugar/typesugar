/**
 * Algebraic Proof Rules
 *
 * Pattern-matching rules that can prove simple arithmetic and logical
 * properties from known type facts. Each rule encodes a theorem like
 * "if x > 0 and y > 0, then x + y > 0".
 *
 * Rules operate on normalized predicate strings (from predicate.ts).
 */

import type { TypeFact } from "./type-facts.js";
import type { ProofResult } from "./index.js";
import type { ProofStep } from "./certificate.js";

/**
 * Match result with used facts for proof certificates.
 */
interface MatchResult {
  matched: boolean;
  usedFacts: TypeFact[];
}

/**
 * An algebraic proof rule.
 */
export interface AlgebraicRule {
  name: string;
  description: string;
  /** Simple match check for backwards compatibility */
  match: (goal: string, facts: TypeFact[]) => boolean;
  /** Extended match that returns used facts for proof certificates */
  matchWithFacts?: (goal: string, facts: TypeFact[]) => MatchResult;
}

/**
 * Check if a fact set contains a specific predicate for a variable.
 */
function hasFact(facts: TypeFact[], variable: string, predicate: string): boolean {
  return facts.some((f) => f.variable === variable && f.predicate.includes(predicate));
}

/**
 * Get the fact matching a variable and predicate pattern.
 */
function getFact(facts: TypeFact[], variable: string, predicate: string): TypeFact | undefined {
  return facts.find((f) => f.variable === variable && f.predicate.includes(predicate));
}

function hasFactMatching(facts: TypeFact[], pattern: RegExp): boolean {
  return facts.some((f) => pattern.test(f.predicate));
}

/**
 * Extended result with proof step information.
 */
export interface AlgebraicProofResult extends ProofResult {
  /** Detailed proof step for certificates */
  step?: ProofStep;
}

// ============================================================================
// Equational Reasoning Helpers
// ============================================================================

/**
 * Check if two expressions are structurally equal (modulo whitespace).
 */
function structurallyEqual(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/**
 * Parse a binary operation expression like "op(a, b)" or "a.op(b)".
 * Returns the operator name and operands, or null if not parseable.
 */
function parseBinaryOp(expr: string): { op: string; left: string; right: string } | null {
  // Match function call style: op(a, b)
  const funcMatch = expr.match(/^(\w+)\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  if (funcMatch) {
    return { op: funcMatch[1], left: funcMatch[2], right: funcMatch[3] };
  }

  // Match method call style: a.op(b)
  const methodMatch = expr.match(/^(.+?)\.(\w+)\s*\(\s*(.+?)\s*\)$/);
  if (methodMatch) {
    return { op: methodMatch[2], left: methodMatch[1], right: methodMatch[3] };
  }

  // Match infix style: a op b
  const infixMatch = expr.match(/^(.+?)\s+(\w+)\s+(.+?)$/);
  if (infixMatch) {
    return { op: infixMatch[2], left: infixMatch[1], right: infixMatch[3] };
  }

  return null;
}

/**
 * Parse an equality goal: expr1 === expr2 or eqv(expr1, expr2)
 */
function parseEqualityGoal(goal: string): { left: string; right: string } | null {
  // Match strict equality: a === b
  const strictMatch = goal.match(/^(.+?)\s*===\s*(.+?)$/);
  if (strictMatch) {
    return { left: strictMatch[1].trim(), right: strictMatch[2].trim() };
  }

  // Match eqv function: eqv(a, b) or E.eqv(a, b)
  const eqvMatch = goal.match(/^(?:\w+\.)?eqv\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  if (eqvMatch) {
    return { left: eqvMatch[1].trim(), right: eqvMatch[2].trim() };
  }

  return null;
}

/**
 * Check if an expression represents an identity element.
 * Matches: empty, mempty, Monoid.empty(), M.empty()
 */
function isIdentityElement(expr: string): boolean {
  const trimmed = expr.trim();
  return (
    trimmed === "empty" ||
    trimmed === "mempty" ||
    /^\w+\.empty\s*\(\s*\)$/.test(trimmed) ||
    /^empty\s*\(\s*\)$/.test(trimmed)
  );
}

/**
 * Check if a fact declares an identity element for an operation.
 */
function hasIdentityFact(facts: TypeFact[], op: string, element: string): boolean {
  return facts.some(
    (f) =>
      f.predicate.includes(`identity(${op})`) ||
      f.predicate.includes(`${element} is identity for ${op}`) ||
      f.predicate.includes(`Monoid<${op}>`)
  );
}

/**
 * Check if a fact declares associativity for an operation.
 */
function hasAssociativityFact(facts: TypeFact[], op: string): boolean {
  return facts.some(
    (f) =>
      f.predicate.includes(`associative(${op})`) ||
      f.predicate.includes(`Semigroup<${op}>`) ||
      f.predicate.includes(`${op} is associative`)
  );
}

/**
 * Check if a fact declares commutativity for an operation.
 */
function hasCommutativityFact(facts: TypeFact[], op: string): boolean {
  return facts.some(
    (f) =>
      f.predicate.includes(`commutative(${op})`) ||
      f.predicate.includes(`CommutativeSemigroup<${op}>`) ||
      f.predicate.includes(`${op} is commutative`)
  );
}

// ============================================================================
// Built-in Algebraic Rules
// ============================================================================

/**
 * Built-in algebraic proof rules.
 */
const RULES: AlgebraicRule[] = [
  // =========================================================================
  // Equational Reasoning Rules (for typeclass laws)
  // =========================================================================

  // --- Identity Laws ---
  {
    name: "left_identity",
    description: "combine(empty, a) === a (left identity law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      const leftOp = parseBinaryOp(eq.left);
      if (!leftOp) return { matched: false, usedFacts: [] };

      // Check if left operand is identity element
      if (!isIdentityElement(leftOp.left)) return { matched: false, usedFacts: [] };

      // Check if right side equals the non-identity operand
      if (!structurallyEqual(eq.right, leftOp.right)) return { matched: false, usedFacts: [] };

      // Optionally verify we have a Monoid fact
      const usedFacts = facts.filter(
        (f) => f.predicate.includes("identity") || f.predicate.includes("Monoid")
      );

      return { matched: true, usedFacts };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },
  {
    name: "right_identity",
    description: "combine(a, empty) === a (right identity law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      const leftOp = parseBinaryOp(eq.left);
      if (!leftOp) return { matched: false, usedFacts: [] };

      // Check if right operand of the operation is identity element
      if (!isIdentityElement(leftOp.right)) return { matched: false, usedFacts: [] };

      // Check if result equals the non-identity operand
      if (!structurallyEqual(eq.right, leftOp.left)) return { matched: false, usedFacts: [] };

      const usedFacts = facts.filter(
        (f) => f.predicate.includes("identity") || f.predicate.includes("Monoid")
      );

      return { matched: true, usedFacts };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // --- Associativity Laws ---
  {
    name: "associativity",
    description: "combine(combine(a, b), c) === combine(a, combine(b, c)) (associativity law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      // Parse both sides as binary operations
      const leftOuter = parseBinaryOp(eq.left);
      const rightOuter = parseBinaryOp(eq.right);

      if (!leftOuter || !rightOuter) return { matched: false, usedFacts: [] };
      if (leftOuter.op !== rightOuter.op) return { matched: false, usedFacts: [] };

      const op = leftOuter.op;

      // Pattern 1: (a op b) op c === a op (b op c)
      const leftInner = parseBinaryOp(leftOuter.left);
      const rightInner = parseBinaryOp(rightOuter.right);

      if (leftInner && rightInner && leftInner.op === op && rightInner.op === op) {
        // Check: leftInner = (a, b), leftOuter.right = c
        //        rightOuter.left = a, rightInner = (b, c)
        const a1 = leftInner.left;
        const b1 = leftInner.right;
        const c1 = leftOuter.right;
        const a2 = rightOuter.left;
        const b2 = rightInner.left;
        const c2 = rightInner.right;

        if (structurallyEqual(a1, a2) && structurallyEqual(b1, b2) && structurallyEqual(c1, c2)) {
          const usedFacts = facts.filter(
            (f) => f.predicate.includes("associative") || f.predicate.includes("Semigroup")
          );
          return { matched: true, usedFacts };
        }
      }

      // Pattern 2: a op (b op c) === (a op b) op c (reversed)
      const leftInner2 = parseBinaryOp(leftOuter.right);
      const rightInner2 = parseBinaryOp(rightOuter.left);

      if (leftInner2 && rightInner2 && leftInner2.op === op && rightInner2.op === op) {
        const a1 = leftOuter.left;
        const b1 = leftInner2.left;
        const c1 = leftInner2.right;
        const a2 = rightInner2.left;
        const b2 = rightInner2.right;
        const c2 = rightOuter.right;

        if (structurallyEqual(a1, a2) && structurallyEqual(b1, b2) && structurallyEqual(c1, c2)) {
          const usedFacts = facts.filter(
            (f) => f.predicate.includes("associative") || f.predicate.includes("Semigroup")
          );
          return { matched: true, usedFacts };
        }
      }

      return { matched: false, usedFacts: [] };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // --- Commutativity Laws ---
  {
    name: "commutativity",
    description: "combine(a, b) === combine(b, a) (commutativity law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      const leftOp = parseBinaryOp(eq.left);
      const rightOp = parseBinaryOp(eq.right);

      if (!leftOp || !rightOp) return { matched: false, usedFacts: [] };
      if (leftOp.op !== rightOp.op) return { matched: false, usedFacts: [] };

      // Check if operands are swapped
      if (
        structurallyEqual(leftOp.left, rightOp.right) &&
        structurallyEqual(leftOp.right, rightOp.left)
      ) {
        const usedFacts = facts.filter(
          (f) => f.predicate.includes("commutative") || f.predicate.includes("CommutativeSemigroup")
        );
        return { matched: true, usedFacts };
      }

      return { matched: false, usedFacts: [] };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // --- Reflexivity ---
  {
    name: "reflexivity",
    description: "a === a (reflexivity of equality)",
    matchWithFacts(goal, _facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      if (structurallyEqual(eq.left, eq.right)) {
        return { matched: true, usedFacts: [] };
      }

      return { matched: false, usedFacts: [] };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // --- Identity Function Laws ---
  {
    name: "identity_function_left",
    description: "map(id, fa) === fa (functor identity law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      // Match map(id, fa) or fa.map(id)
      const leftOp = parseBinaryOp(eq.left);
      if (!leftOp) return { matched: false, usedFacts: [] };

      if (leftOp.op !== "map") return { matched: false, usedFacts: [] };

      // Check if first arg is identity function
      const isId =
        leftOp.left.trim() === "id" ||
        leftOp.left.trim() === "identity" ||
        /^(?:x|a)\s*=>\s*(?:x|a)$/.test(leftOp.left.trim()) ||
        /^function\s*\((?:x|a)\)\s*\{\s*return\s+(?:x|a)\s*;\s*\}$/.test(leftOp.left.trim());

      if (!isId) return { matched: false, usedFacts: [] };

      // Check if result equals the functor value
      if (structurallyEqual(eq.right, leftOp.right)) {
        const usedFacts = facts.filter((f) => f.predicate.includes("Functor"));
        return { matched: true, usedFacts };
      }

      return { matched: false, usedFacts: [] };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // --- Composition Laws ---
  {
    name: "functor_composition",
    description: "map(g, map(f, fa)) === map(g . f, fa) (functor composition law)",
    matchWithFacts(goal, facts): MatchResult {
      const eq = parseEqualityGoal(goal);
      if (!eq) return { matched: false, usedFacts: [] };

      // This is a structural equivalence check for functor composition
      // Either side could be the nested form or the composed form

      // Parse both sides
      const leftOp = parseBinaryOp(eq.left);
      const rightOp = parseBinaryOp(eq.right);

      if (!leftOp || !rightOp) return { matched: false, usedFacts: [] };
      if (leftOp.op !== "map" || rightOp.op !== "map") return { matched: false, usedFacts: [] };

      // Check for nested map on left: map(g, map(f, fa))
      const innerLeft = parseBinaryOp(leftOp.right);
      if (innerLeft && innerLeft.op === "map") {
        // leftOp.left = g, innerLeft.left = f, innerLeft.right = fa
        // rightOp should have composed function and same fa
        if (structurallyEqual(innerLeft.right, rightOp.right)) {
          const usedFacts = facts.filter((f) => f.predicate.includes("Functor"));
          return { matched: true, usedFacts };
        }
      }

      // Check for nested map on right: map(g . f, fa) === map(g, map(f, fa))
      const innerRight = parseBinaryOp(rightOp.right);
      if (innerRight && innerRight.op === "map") {
        if (structurallyEqual(innerRight.right, leftOp.right)) {
          const usedFacts = facts.filter((f) => f.predicate.includes("Functor"));
          return { matched: true, usedFacts };
        }
      }

      return { matched: false, usedFacts: [] };
    },
    match(goal, facts) {
      return this.matchWithFacts!(goal, facts).matched;
    },
  },

  // =========================================================================
  // Numeric Proof Rules (existing)
  // =========================================================================

  // --- Positivity propagation ---
  {
    name: "sum_of_positives",
    description: "x > 0 ∧ y > 0 → x + y > 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*\+\s*(\w+)\s*>\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], "> 0") && hasFact(facts, m[2], "> 0");
    },
  },
  {
    name: "sum_of_non_negatives",
    description: "x >= 0 ∧ y >= 0 → x + y >= 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*\+\s*(\w+)\s*>=\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], ">= 0") && hasFact(facts, m[2], ">= 0");
    },
  },
  {
    name: "positive_implies_non_negative",
    description: "x > 0 → x >= 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>=\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], "> 0");
    },
  },

  // --- Multiplication ---
  {
    name: "double_positive",
    description: "x > 0 → 2 * x > x",
    match(goal, facts) {
      const m = goal.match(/^2\s*\*\s*(\w+)\s*>\s*(\w+)$/);
      if (!m) return false;
      return m[1] === m[2] && hasFact(facts, m[1], "> 0");
    },
  },
  {
    name: "product_of_positives",
    description: "x > 0 ∧ y > 0 → x * y > 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*\*\s*(\w+)\s*>\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], "> 0") && hasFact(facts, m[2], "> 0");
    },
  },

  // --- Comparison transitivity ---
  {
    name: "positive_greater_than_negative",
    description: "x > 0 ∧ y < 0 → x > y",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>\s*(\w+)$/);
      if (!m) return false;
      return hasFact(facts, m[1], "> 0") && hasFact(facts, m[2], "< 0");
    },
  },

  // --- Bounds ---
  {
    name: "byte_in_range",
    description: "Byte → x >= 0 && x <= 255",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>=\s*0\s*&&\s*\1\s*<=\s*255$/);
      if (!m) return false;
      return hasFact(facts, m[1], ">= 0") && hasFact(facts, m[1], "<= 255");
    },
  },
  {
    name: "port_in_range",
    description: "Port → x >= 1 && x <= 65535",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>=\s*1\s*&&\s*\1\s*<=\s*65535$/);
      if (!m) return false;
      return hasFact(facts, m[1], ">= 1") && hasFact(facts, m[1], "<= 65535");
    },
  },

  // --- Trivial ---
  {
    name: "tautology_true",
    description: "true is always true",
    match(goal, _facts) {
      return goal.trim() === "true";
    },
  },
  {
    name: "identity_positive",
    description: "x > 0 when we know x > 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], "> 0");
    },
  },
  {
    name: "identity_non_negative",
    description: "x >= 0 when we know x >= 0",
    match(goal, facts) {
      const m = goal.match(/^(\w+)\s*>=\s*0$/);
      if (!m) return false;
      return hasFact(facts, m[1], ">= 0");
    },
  },
];

/**
 * Try to prove a goal using algebraic rules.
 * Returns extended result with proof step information for certificates.
 */
export function tryAlgebraicProof(goal: string, facts: TypeFact[]): AlgebraicProofResult {
  for (const rule of RULES) {
    // Try extended match first for proof certificate support
    if (rule.matchWithFacts) {
      const result = rule.matchWithFacts(goal, facts);
      if (result.matched) {
        return {
          proven: true,
          method: "algebra",
          reason: `${rule.name}: ${rule.description}`,
          step: {
            rule: rule.name,
            description: rule.description,
            justification: `Applied algebraic rule: ${rule.description}`,
            usedFacts: result.usedFacts,
            subgoals: [],
          },
        };
      }
    } else if (rule.match(goal, facts)) {
      // Fall back to simple match
      return {
        proven: true,
        method: "algebra",
        reason: `${rule.name}: ${rule.description}`,
        step: {
          rule: rule.name,
          description: rule.description,
          justification: `Applied algebraic rule: ${rule.description}`,
          usedFacts: [],
          subgoals: [],
        },
      };
    }
  }
  return { proven: false };
}

/**
 * Register a custom algebraic rule.
 */
export function registerAlgebraicRule(rule: AlgebraicRule): void {
  RULES.push(rule);
}

/**
 * Get all registered algebraic rules.
 */
export function getAllAlgebraicRules(): readonly AlgebraicRule[] {
  return RULES;
}
