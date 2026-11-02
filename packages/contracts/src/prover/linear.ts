/**
 * Linear Arithmetic Solver (Coq-inspired)
 *
 * Built-in decision procedure for ORDER constraints over JavaScript numbers,
 * using Fourier-Motzkin variable elimination, plus a small set of
 * floating-point-aware rules for two-term sums and differences.
 *
 * ## Soundness contract (deep review 2026-10, effect-contracts #2)
 *
 * A proven goal has its runtime check DELETED, so this module must never
 * prove something that some JS value satisfying the facts can falsify. The
 * earlier version reasoned over the reals with regex-parsed constraints and
 * was unsound in several ways (double-flipped `c op x` parsing, combining
 * constraints by coefficient sign without normalising the operator, rules
 * keyed on `predicate.includes("> 0")`, ...). The rewrite is deliberately
 * narrow so the argument for soundness is short:
 *
 * 1. **Atoms.** A fact or goal conjunct is used only if it is a pure
 *    comparison `A op B` with `op ∈ {<, <=, >, >=, ===}` and each side either
 *    a numeric literal or a variable path (`x`, `s.length`). Facts are split
 *    on TOP-LEVEL `&&` only (parsed, never `split("&&")`); any other conjunct
 *    (disjunctions, `%`, calls, `*`, ...) is ignored — dropping a fact can
 *    only make the prover prove less.
 *
 * 2. **Fourier-Motzkin over these atoms only.** Every atom becomes a
 *    constraint with unit coefficients: either a bound `±v (<|<=) c` or a
 *    difference `v - w (<|<=) 0`. Eliminating a variable from two such
 *    constraints yields another one of these shapes (the engine is really
 *    order/difference reasoning), so every derivation is a chain of
 *    comparisons — valid in any total order, including the IEEE doubles with
 *    ±Infinity (and `-0 === 0`). No floating-point arithmetic is ever
 *    performed on user values; constants are only ever COMPARED (the sign of
 *    `c1 - c2` for doubles is exact).
 *
 * 3. **NaN.** Every comparison with NaN is false, so a variable that appears
 *    in at least one used fact atom is known not to be NaN. A goal is only
 *    attempted when every variable it mentions is mentioned by some used fact
 *    atom (otherwise e.g. `x <= x` would "normalise" to `0 <= 0` and be
 *    proven, but is false for NaN).
 *
 * 4. **Sums/differences** (`a + b op c`, `a - b op c`, one side a literal)
 *    are NOT fed to Fourier-Motzkin — `fl(a + b)` is not `a + b`, and
 *    `Infinity - Infinity` is NaN. They are proven only by rules that are
 *    valid for IEEE round-to-nearest addition, using bounds the order engine
 *    proved:
 *      - `a >= p, b >= q, fl(p + q) >= c  ⊢  a + b >= c`  (rounding is
 *        monotone; finite lower bounds exclude `-Infinity`, so no NaN) — and
 *        the `>` variant needs `fl(p + q) > c`;
 *      - `b >= 0, a > c  ⊢  a + b > c`  (`fl(a + b) >= a` when `b >= 0`);
 *      - `a > b  ⊢  a - b > 0`  (for doubles `a - b = 0` iff `a = b`; the
 *        infinite cases give `±Infinity`), and `a >= b ⊢ a - b >= 0` only when
 *        one side is known finite (`Infinity - Infinity` is NaN);
 *      - the mirror-image upper-bound versions.
 *
 * Variables are assumed to hold numbers (the facts come from refined NUMBER
 * types); a var-to-var comparison of two strings is lexicographic, which the
 * engine does not model.
 *
 * A property test (`tests/prover-soundness.test.ts`) fuzzes random facts and
 * goals and asserts no proven goal is falsified by a satisfying assignment.
 */

import type { TypeFact } from "./type-facts.js";
import type { ProofResult } from "./index.js";
import type { ProofStep } from "./certificate.js";
import {
  type Expr,
  parsePredicate,
  conjuncts,
  exprKey,
  variablePath,
  numericValue,
} from "./expr.js";

/**
 * Extended proof result with proof step for certificates.
 */
export interface LinearProofResult extends ProofResult {
  step?: ProofStep;
}

// ============================================================================
// Terms, atoms and constraints
// ============================================================================

/** A comparison operand: a variable path or a numeric literal. */
type Term = { kind: "var"; name: string } | { kind: "num"; value: number };

type CmpOp = "<" | "<=" | ">" | ">=" | "===";

/** `sum(coeffs[v] * v) op c`, op normalised to `<` / `<=`. */
interface Constraint {
  coeffs: Map<string, number>;
  strict: boolean;
  c: number;
  source: string;
}

function toTerm(e: Expr): Term | undefined {
  const n = numericValue(e);
  if (n !== undefined) return Number.isNaN(n) ? undefined : { kind: "num", value: n };
  const v = variablePath(e);
  if (v !== undefined) {
    // `NaN` / `Infinity` used as identifiers: `Infinity` behaves like any
    // other (non-NaN) totally-ordered value, but `NaN` must not be treated as
    // an ordinary variable.
    if (v === "NaN") return undefined;
    return { kind: "var", name: v };
  }
  return undefined;
}

const CMP_OPS = new Set<string>(["<", "<=", ">", ">=", "==="]);

interface Atom {
  left: Term;
  op: CmpOp;
  right: Term;
}

function toAtom(e: Expr): Atom | undefined {
  if (e.kind !== "binary") return undefined;
  const left = toTerm(e.left);
  const right = toTerm(e.right);
  if (!left || !right) return undefined;
  if (CMP_OPS.has(e.op)) return { left, op: e.op as CmpOp, right };
  // `v == 5`: loose equality with a NUMERIC LITERAL compares ToNumber(v), the
  // same coercion the relational operators apply against a literal, so it is
  // usable like `===` here. (`v == w` between two variables is not: strings
  // compare lexicographically under `<`.)
  if (e.op === "==" && (left.kind === "num" || right.kind === "num")) {
    return { left, op: "===", right };
  }
  return undefined;
}

function termVars(t: Term): string[] {
  return t.kind === "var" ? [t.name] : [];
}

/** `left - right (<|<=) 0` as a constraint. */
function diffConstraint(left: Term, right: Term, strict: boolean, source: string): Constraint {
  const coeffs = new Map<string, number>();
  let c = 0;
  const add = (t: Term, sign: number) => {
    if (t.kind === "var") coeffs.set(t.name, (coeffs.get(t.name) ?? 0) + sign);
    else c -= sign * t.value;
  };
  add(left, 1);
  add(right, -1);
  for (const [k, v] of coeffs) if (v === 0) coeffs.delete(k);
  return { coeffs, strict, c, source };
}

/** The constraints an atom asserts (as a fact). */
function atomConstraints(a: Atom, source: string): Constraint[] {
  switch (a.op) {
    case "<":
      return [diffConstraint(a.left, a.right, true, source)];
    case "<=":
      return [diffConstraint(a.left, a.right, false, source)];
    case ">":
      return [diffConstraint(a.right, a.left, true, source)];
    case ">=":
      return [diffConstraint(a.right, a.left, false, source)];
    case "===":
      return [
        diffConstraint(a.left, a.right, false, source),
        diffConstraint(a.right, a.left, false, source),
      ];
  }
}

/** Negation of `E (<|<=) c`, valid for non-NaN values: `-E (<=|<) -c`. */
function negate(k: Constraint): Constraint {
  const coeffs = new Map<string, number>();
  for (const [v, a] of k.coeffs) coeffs.set(v, -a);
  return { coeffs, strict: !k.strict, c: -k.c, source: `not(${k.source})` };
}

function isContradiction(k: Constraint): boolean {
  if (k.coeffs.size > 0) return false;
  // 0 < c  is false iff c <= 0;  0 <= c  is false iff c < 0.
  return k.strict ? !(0 < k.c) : !(0 <= k.c);
}

const MAX_CONSTRAINTS = 400;

/**
 * Fourier-Motzkin: is the conjunction of `constraints` unsatisfiable?
 * Only ever combines a constraint with a POSITIVE coefficient on the
 * eliminated variable with one with a NEGATIVE coefficient, scaling both by
 * positive multipliers, so each derived constraint is implied by its parents.
 */
function unsatisfiable(constraints: Constraint[]): Constraint | undefined {
  let current = constraints;
  for (const k of current) if (isContradiction(k)) return k;
  for (;;) {
    const vars = new Set<string>();
    for (const k of current) for (const v of k.coeffs.keys()) vars.add(v);
    if (vars.size === 0) return undefined;
    const variable = vars.values().next().value as string;
    const pos: Constraint[] = [];
    const neg: Constraint[] = [];
    const rest: Constraint[] = [];
    for (const k of current) {
      const a = k.coeffs.get(variable) ?? 0;
      if (a > 0) pos.push(k);
      else if (a < 0) neg.push(k);
      else rest.push(k);
    }
    const next = [...rest];
    for (const p of pos) {
      for (const n of neg) {
        const ap = p.coeffs.get(variable)!;
        const an = -n.coeffs.get(variable)!;
        // an * p + ap * n eliminates `variable` (both multipliers > 0).
        const coeffs = new Map<string, number>();
        for (const [v, a] of p.coeffs) if (v !== variable) coeffs.set(v, a * an);
        for (const [v, a] of n.coeffs) {
          if (v === variable) continue;
          coeffs.set(v, (coeffs.get(v) ?? 0) + a * ap);
        }
        for (const [v, a] of coeffs) if (a === 0) coeffs.delete(v);
        const derived: Constraint = {
          coeffs,
          strict: p.strict || n.strict,
          c: p.c * an + n.c * ap,
          source: `${p.source} + ${n.source}`,
        };
        if (isContradiction(derived)) return derived;
        next.push(derived);
      }
    }
    if (next.length > MAX_CONSTRAINTS) return undefined; // give up (unproven)
    current = next;
  }
}

// ============================================================================
// Fact analysis
// ============================================================================

interface FactBase {
  constraints: Constraint[];
  /** Variables appearing in a used comparison atom (hence not NaN). */
  mentioned: Set<string>;
  /** Variables known finite (`Number.isFinite(v)`, `Number.isInteger(v)`, ...). */
  finite: Set<string>;
  /** Numeric literals appearing in used atoms — candidate bounds. */
  constants: Set<number>;
  usedFacts: TypeFact[];
  /** Canonical keys of every fact conjunct (for direct matching). */
  conjunctKeys: Map<string, TypeFact>;
}

const FINITE_PREDICATES = new Set(["Number.isFinite", "Number.isInteger", "Number.isSafeInteger"]);

function analyzeFacts(facts: TypeFact[]): FactBase {
  const base: FactBase = {
    constraints: [],
    mentioned: new Set(),
    finite: new Set(),
    constants: new Set([0]),
    usedFacts: [],
    conjunctKeys: new Map(),
  };
  for (const fact of facts) {
    const e = parsePredicate(fact.predicate);
    if (!e) continue;
    let used = false;
    for (const part of conjuncts(e)) {
      base.conjunctKeys.set(exprKey(part), fact);
      const atom = toAtom(part);
      if (atom) {
        base.constraints.push(...atomConstraints(atom, fact.predicate));
        for (const t of [atom.left, atom.right]) {
          if (t.kind === "var") base.mentioned.add(t.name);
          else if (Number.isFinite(t.value)) base.constants.add(t.value);
        }
        used = true;
        continue;
      }
      if (part.kind === "call" && part.args.length === 1) {
        const callee = variablePath(part.callee);
        const arg = variablePath(part.args[0]);
        if (callee && arg && FINITE_PREDICATES.has(callee)) {
          base.finite.add(arg);
          base.mentioned.add(arg);
          used = true;
        }
      }
    }
    if (used) base.usedFacts.push(fact);
  }
  return base;
}

/** Prove `left op right` (an atom) from the fact base by refutation. */
function proveAtom(base: FactBase, atom: Atom): Constraint | undefined {
  for (const v of [...termVars(atom.left), ...termVars(atom.right)]) {
    if (!base.mentioned.has(v)) return undefined; // might be NaN
  }
  // `===` goal: prove both `<=` directions.
  const goals: Atom[] =
    atom.op === "==="
      ? [
          { left: atom.left, op: "<=", right: atom.right },
          { left: atom.left, op: ">=", right: atom.right },
        ]
      : [atom];
  let witness: Constraint | undefined;
  for (const g of goals) {
    const [k] = atomConstraints(g, "goal");
    const w = unsatisfiable([...base.constraints, negate(k)]);
    if (!w) return undefined;
    witness = w;
  }
  return witness;
}

// ---------------------------------------------------------------------------
// Two-term sums and differences (floating-point-aware rules)
// ---------------------------------------------------------------------------

/** A term with a sign: `sign * term`. Negation of a double is exact. */
interface Signed {
  term: Term;
  sign: 1 | -1;
}

/** Prove `s op k` for a signed term (op ∈ >, >=). */
function proveSignedLower(base: FactBase, s: Signed, strict: boolean, k: number): boolean {
  if (s.term.kind === "num") {
    const v = s.sign * s.term.value;
    return strict ? v > k : v >= k;
  }
  const kTerm: Term = { kind: "num", value: s.sign * k };
  const op: CmpOp = s.sign === 1 ? (strict ? ">" : ">=") : strict ? "<" : "<=";
  return proveAtom(base, { left: s.term, op, right: kTerm }) !== undefined;
}

/** Best (largest) provable finite lower bound of a signed term. */
function lowerBound(base: FactBase, s: Signed): number | undefined {
  if (s.term.kind === "num") {
    const v = s.sign * s.term.value;
    return Number.isFinite(v) ? v : undefined;
  }
  let best: number | undefined;
  for (const c of base.constants) {
    if (best !== undefined && c <= best) continue;
    if (proveSignedLower(base, s, false, c)) best = c;
  }
  return best;
}

function knownFinite(base: FactBase, t: Term): boolean {
  if (t.kind === "num") return Number.isFinite(t.value);
  if (base.finite.has(t.name)) return true;
  const lo = lowerBound(base, { term: t, sign: 1 });
  const hi = lowerBound(base, { term: t, sign: -1 });
  return lo !== undefined && hi !== undefined;
}

/**
 * Prove `a + b (>|>=) k` where `a`, `b` are signed terms, valid for IEEE
 * round-to-nearest addition (see module header).
 */
function proveSumLower(
  base: FactBase,
  a: Signed,
  b: Signed,
  strict: boolean,
  k: number
): string | undefined {
  const la = lowerBound(base, a);
  const lb = lowerBound(base, b);
  if (la !== undefined && lb !== undefined) {
    const sum = la + lb; // fl(la + lb) — exactly what fl(a + b) is bounded by
    if (strict ? sum > k : sum >= k) return `lower bounds ${la} and ${lb}`;
  }
  // b >= 0 ⇒ fl(a + b) >= a  (and symmetric)
  if (proveSignedLower(base, b, false, 0) && proveSignedLower(base, a, strict, k)) {
    return `second term is non-negative and first term ${strict ? ">" : ">="} ${k}`;
  }
  if (proveSignedLower(base, a, false, 0) && proveSignedLower(base, b, strict, k)) {
    return `first term is non-negative and second term ${strict ? ">" : ">="} ${k}`;
  }
  // a - b with k = 0: compare directly.
  if (k === 0 && a.sign === 1 && b.sign === -1 && a.term.kind === "var") {
    const cmp: Atom = { left: a.term, op: strict ? ">" : ">=", right: b.term };
    if (proveAtom(base, cmp)) {
      if (strict) return "difference of strictly ordered values";
      if (knownFinite(base, a.term) || knownFinite(base, b.term)) {
        return "difference of ordered values (one finite)";
      }
    }
  }
  if (k === 0 && a.sign === -1 && b.sign === 1 && b.term.kind === "var") {
    return proveSumLower(base, b, a, strict, k);
  }
  return undefined;
}

interface SumGoal {
  a: Signed;
  b: Signed;
  op: "<" | "<=" | ">" | ">=";
  k: number;
}

function toSumGoal(e: Expr): SumGoal | undefined {
  if (e.kind !== "binary" || !["<", "<=", ">", ">="].includes(e.op)) return undefined;
  const flip: Record<string, "<" | "<=" | ">" | ">="> = {
    "<": ">",
    "<=": ">=",
    ">": "<",
    ">=": "<=",
  };
  const asSum = (x: Expr): [Signed, Signed] | undefined => {
    if (x.kind !== "binary" || (x.op !== "+" && x.op !== "-")) return undefined;
    const l = toTerm(x.left);
    const r = toTerm(x.right);
    if (!l || !r) return undefined;
    return [
      { term: l, sign: 1 },
      { term: r, sign: x.op === "+" ? 1 : -1 },
    ];
  };
  // Only FINITE literal bounds: with `k = -Infinity`, `a >= k` holds for
  // `a = -Infinity`, and `-Infinity + Infinity` is NaN.
  const leftSum = asSum(e.left);
  const rightK = numericValue(e.right);
  if (leftSum && rightK !== undefined && Number.isFinite(rightK)) {
    return { a: leftSum[0], b: leftSum[1], op: e.op as SumGoal["op"], k: rightK };
  }
  const rightSum = asSum(e.right);
  const leftK = numericValue(e.left);
  if (rightSum && leftK !== undefined && Number.isFinite(leftK)) {
    return { a: rightSum[0], b: rightSum[1], op: flip[e.op], k: leftK };
  }
  return undefined;
}

function proveSum(base: FactBase, g: SumGoal): string | undefined {
  for (const s of [g.a, g.b]) {
    if (s.term.kind === "var" && !base.mentioned.has(s.term.name)) return undefined;
  }
  if (g.op === ">" || g.op === ">=") return proveSumLower(base, g.a, g.b, g.op === ">", g.k);
  // a + b < k  ⟺  (-a) + (-b) > -k   (round-to-nearest is sign-symmetric)
  const na: Signed = { term: g.a.term, sign: g.a.sign === 1 ? -1 : 1 };
  const nb: Signed = { term: g.b.term, sign: g.b.sign === 1 ? -1 : 1 };
  return proveSumLower(base, na, nb, g.op === "<", -g.k);
}

// ============================================================================
// Public API
// ============================================================================

function step(rule: string, description: string, justification: string, usedFacts: TypeFact[]) {
  return { rule, description, justification, usedFacts, subgoals: [] } satisfies ProofStep;
}

/** Prove one goal conjunct. Returns a justification, or undefined. */
function proveConjunct(base: FactBase, part: Expr): { rule: string; why: string } | undefined {
  if (part.kind === "bool" && part.value) return { rule: "constant", why: "true" };
  const atom = toAtom(part);
  if (atom) {
    const w = proveAtom(base, atom);
    if (w) return { rule: "fourier_motzkin", why: `contradiction derived: ${w.source}` };
    return undefined;
  }
  const sum = toSumGoal(part);
  if (sum) {
    const why = proveSum(base, sum);
    if (why) return { rule: "linear_sum_bounds", why };
  }
  return undefined;
}

/**
 * Try to prove a goal using Fourier-Motzkin elimination over the order
 * atoms of the facts (plus the floating-point-aware sum rules). Every
 * top-level conjunct of the goal must be proven.
 */
export function tryLinearProof(goal: string, facts: TypeFact[]): LinearProofResult {
  const g = parsePredicate(goal.trim());
  if (!g) return { proven: false };
  const base = analyzeFacts(facts);
  const reasons: string[] = [];
  let rule = "fourier_motzkin";
  for (const part of conjuncts(g)) {
    const r = proveConjunct(base, part);
    if (!r) return { proven: false };
    reasons.push(r.why);
    rule = r.rule;
  }
  return {
    proven: true,
    method: "linear",
    reason: `Linear arithmetic: ${reasons.join("; ")}`,
    step: step(
      rule,
      "Linear arithmetic over order constraints",
      reasons.join("; "),
      base.usedFacts
    ),
  };
}

/**
 * Direct match: every top-level conjunct of the goal is (structurally) a
 * top-level conjunct of some fact.
 */
export function tryDirectFactMatch(goal: string, facts: TypeFact[]): LinearProofResult {
  const g = parsePredicate(goal.trim());
  if (!g) return { proven: false };
  const base = analyzeFacts(facts);
  const used: TypeFact[] = [];
  for (const part of conjuncts(g)) {
    const f = base.conjunctKeys.get(exprKey(part));
    if (!f) return { proven: false };
    used.push(f);
  }
  return {
    proven: true,
    method: "linear",
    reason: "Linear arithmetic: direct match",
    step: step("linear_direct_match", "Goal directly matches known facts", goal.trim(), used),
  };
}

/**
 * Fast path kept for API compatibility: a direct match, else the (sound)
 * order engine. Same result as {@link tryLinearArithmetic}.
 */
export function trySimpleLinearProof(goal: string, facts: TypeFact[]): LinearProofResult {
  return tryLinearArithmetic(goal, facts);
}

/**
 * Combined linear arithmetic proof: direct match, then Fourier-Motzkin.
 */
export function tryLinearArithmetic(goal: string, facts: TypeFact[]): LinearProofResult {
  const simple = tryDirectFactMatch(goal, facts);
  if (simple.proven) return simple;
  return tryLinearProof(goal, facts);
}
