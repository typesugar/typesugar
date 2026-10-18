/**
 * Algebraic Proof Rules
 *
 * Equational rules for typeclass-style laws (identity, associativity,
 * commutativity) that fire ONLY when a fact explicitly asserts the property
 * for the exact operation in the goal.
 *
 * ## Soundness (deep review 2026-10, effect-contracts #3)
 *
 * A proven goal has its runtime check deleted, so a rule may only fire when
 * the facts justify the goal. The previous rule set "proved"
 * `a.concat(b) === b.concat(a)`, `sub(a, b) === sub(b, a)`,
 * `map(g, map(f, xs)) === map(anything, xs)` and `x === x` (false for NaN)
 * with no facts at all, and keyed numeric rules on
 * `predicate.includes("> 0")` (so `x * x > 0` "proved" `x >= 0`). Now:
 *
 * - goals and facts are PARSED (`./expr.ts`), never regex/substring matched;
 * - identity needs `identity(op)` with the fact's `variable` naming the
 *   identity element; associativity needs `associative(op)`; commutativity
 *   needs `commutative(op)` — with `op` structurally equal to the goal's
 *   operation (`combine(a, b)` → `combine`; `a.concat(b)` → `concat`);
 * - reflexivity (`a === a`, false for NaN), the functor identity/composition
 *   rules (which never checked `g . f`, and `===` on freshly mapped
 *   containers is false anyway) and the numeric rules (subsumed by the sound
 *   linear engine; `2 * x > x` is false for `x = Infinity`, `x * y > 0` is
 *   false on underflow) were removed.
 *
 * What a fact like `associative(combine)` MEANS is the caller's assertion;
 * the prover is sound relative to it. Nothing in this package fabricates
 * such facts from a law's own proof hint (that was circular — see
 * `laws/verify.ts`).
 */

import type { TypeFact } from "./type-facts.js";
import type { ProofResult } from "./index.js";
import type { ProofStep } from "./certificate.js";
import { type Expr, parsePredicate, exprKey, variablePath } from "./expr.js";

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
 * Extended result with proof step information.
 */
export interface AlgebraicProofResult extends ProofResult {
  /** Detailed proof step for certificates */
  step?: ProofStep;
}

// ============================================================================
// Structured helpers
// ============================================================================

/** A binary operation application: `op(a, b)` or `a.op(b)`. */
interface BinApp {
  /** Canonical key of the operation (callee key, or method name). */
  op: string;
  left: Expr;
  right: Expr;
}

function asBinApp(e: Expr): BinApp | undefined {
  if (e.kind !== "call") return undefined;
  if (e.args.length === 2) {
    const op = variablePath(e.callee);
    if (op === undefined) return undefined;
    return { op, left: e.args[0], right: e.args[1] };
  }
  if (e.args.length === 1 && e.callee.kind === "member") {
    return { op: e.callee.name, left: e.callee.object, right: e.args[0] };
  }
  return undefined;
}

/** `L === R`, `eqv(L, R)` or `E.eqv(L, R)`. */
function asEquality(goal: string): { left: Expr; right: Expr } | undefined {
  const e = parsePredicate(goal.trim());
  if (!e) return undefined;
  if (e.kind === "binary" && e.op === "===") return { left: e.left, right: e.right };
  if (e.kind === "call" && e.args.length === 2) {
    const callee = e.callee;
    const isEqv =
      (callee.kind === "id" && callee.name === "eqv") ||
      (callee.kind === "member" && callee.name === "eqv");
    if (isEqv) return { left: e.args[0], right: e.args[1] };
  }
  return undefined;
}

const same = (a: Expr, b: Expr) => exprKey(a) === exprKey(b);

/**
 * Find a fact `property(op)` (e.g. `associative(combine)`) for exactly `op`.
 * For `identity`, the fact's `variable` must also be the identity element.
 */
function findPropertyFact(
  facts: TypeFact[],
  property: "associative" | "commutative" | "identity",
  op: string,
  element?: Expr
): TypeFact | undefined {
  return facts.find((f) => {
    const e = parsePredicate(f.predicate.trim());
    if (!e || e.kind !== "call" || e.args.length < 1 || e.args.length > 2) return false;
    if (e.callee.kind !== "id" || e.callee.name !== property) return false;
    if (variablePath(e.args[0]) !== op) return false;
    if (property !== "identity") return e.args.length === 1;
    if (!element) return false;
    // identity(op, e) — or identity(op) with the element in `variable`.
    if (e.args.length === 2) return same(e.args[1], element);
    const v = parsePredicate(f.variable.trim());
    return v !== undefined && same(v, element);
  });
}

function rule(
  name: string,
  description: string,
  matchWithFacts: (goal: string, facts: TypeFact[]) => MatchResult
): AlgebraicRule {
  return {
    name,
    description,
    matchWithFacts,
    match(goal, facts) {
      return matchWithFacts(goal, facts).matched;
    },
  };
}

const NO: MatchResult = { matched: false, usedFacts: [] };

// ============================================================================
// Built-in Algebraic Rules
// ============================================================================

const RULES: AlgebraicRule[] = [
  rule(
    "left_identity",
    "combine(empty, a) === a, given identity(combine) for empty",
    (goal, facts) => {
      const eq = asEquality(goal);
      if (!eq) return NO;
      for (const [l, r] of [
        [eq.left, eq.right],
        [eq.right, eq.left],
      ] as const) {
        const app = asBinApp(l);
        if (!app || !same(app.right, r)) continue;
        const f = findPropertyFact(facts, "identity", app.op, app.left);
        if (f) return { matched: true, usedFacts: [f] };
      }
      return NO;
    }
  ),
  rule(
    "right_identity",
    "combine(a, empty) === a, given identity(combine) for empty",
    (goal, facts) => {
      const eq = asEquality(goal);
      if (!eq) return NO;
      for (const [l, r] of [
        [eq.left, eq.right],
        [eq.right, eq.left],
      ] as const) {
        const app = asBinApp(l);
        if (!app || !same(app.left, r)) continue;
        const f = findPropertyFact(facts, "identity", app.op, app.right);
        if (f) return { matched: true, usedFacts: [f] };
      }
      return NO;
    }
  ),
  rule(
    "associativity",
    "combine(combine(a, b), c) === combine(a, combine(b, c)), given associative(combine)",
    (goal, facts) => {
      const eq = asEquality(goal);
      if (!eq) return NO;
      const L = asBinApp(eq.left);
      const R = asBinApp(eq.right);
      if (!L || !R || L.op !== R.op) return NO;
      const check = (outerL: BinApp, outerR: BinApp): boolean => {
        // (a op b) op c  ===  a op (b op c)
        const li = asBinApp(outerL.left);
        const ri = asBinApp(outerR.right);
        return (
          li !== undefined &&
          ri !== undefined &&
          li.op === outerL.op &&
          ri.op === outerL.op &&
          same(li.left, outerR.left) &&
          same(li.right, ri.left) &&
          same(outerL.right, ri.right)
        );
      };
      if (!check(L, R) && !check(R, L)) return NO;
      const f = findPropertyFact(facts, "associative", L.op);
      return f ? { matched: true, usedFacts: [f] } : NO;
    }
  ),
  rule(
    "commutativity",
    "combine(a, b) === combine(b, a), given commutative(combine)",
    (goal, facts) => {
      const eq = asEquality(goal);
      if (!eq) return NO;
      const L = asBinApp(eq.left);
      const R = asBinApp(eq.right);
      if (!L || !R || L.op !== R.op) return NO;
      if (!same(L.left, R.right) || !same(L.right, R.left)) return NO;
      const f = findPropertyFact(facts, "commutative", L.op);
      return f ? { matched: true, usedFacts: [f] } : NO;
    }
  ),
  rule("tautology_true", "true is always true", (goal) => {
    const e = parsePredicate(goal.trim());
    return e && e.kind === "bool" && e.value ? { matched: true, usedFacts: [] } : NO;
  }),
];

/**
 * Try to prove a goal using algebraic rules.
 * Returns extended result with proof step information for certificates.
 */
export function tryAlgebraicProof(goal: string, facts: TypeFact[]): AlgebraicProofResult {
  for (const r of RULES) {
    const result = r.matchWithFacts
      ? r.matchWithFacts(goal, facts)
      : { matched: r.match(goal, facts), usedFacts: [] };
    if (result.matched) {
      return {
        proven: true,
        method: "algebra",
        reason: `${r.name}: ${r.description}`,
        step: {
          rule: r.name,
          description: r.description,
          justification: `Applied algebraic rule: ${r.description}`,
          usedFacts: result.usedFacts,
          subgoals: [],
        },
      };
    }
  }
  return { proven: false };
}

/**
 * Register a custom algebraic rule. The rule is responsible for its own
 * soundness: a match deletes the runtime check for the goal.
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
