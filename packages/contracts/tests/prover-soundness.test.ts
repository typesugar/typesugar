/**
 * Prover soundness (deep review 2026-10, effect-contracts #2/#3/#7/#34).
 *
 * A proven contract condition has its runtime check DELETED, so the prover
 * must never claim a goal that some value satisfying the facts falsifies.
 * The fuzz test below generates random facts and goals and checks every
 * proven goal against many assignments (including -0, ±Infinity, NaN,
 * subnormals, huge values and non-integers) that satisfy the facts.
 */

import { describe, it, expect } from "vitest";
import {
  tryAlgebraicProof,
  tryLinearArithmetic,
  verifyLaw,
  type TypeFact,
} from "@typesugar/contracts";
import { tryProve } from "@typesugar/contracts/macros";

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPECIAL = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  0.1,
  0.2,
  0.3,
  5,
  -5,
  10,
  255,
  255.5,
  256,
  300.5,
  65535,
  1e308,
  -1e308,
  5e-324,
  -5e-324,
  2 ** 53,
  2 ** 53 + 2,
  Infinity,
  -Infinity,
  NaN,
];

const VARS = ["x", "y", "z"];
const CONSTS = ["0", "1", "-1", "0.5", "-0.5", "5", "10", "255", "300.5", "0.1", "0.2", "0.3"];
const OPS = [">", ">=", "<", "<=", "==="];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function randomAtom(r: () => number): string {
  const v = pick(r, VARS);
  const op = pick(r, OPS);
  const kind = r();
  if (kind < 0.45) return `${v} ${op} ${pick(r, CONSTS)}`;
  if (kind < 0.6) return `${pick(r, CONSTS)} ${op} ${v}`;
  if (kind < 0.8) return `${v} ${op} ${pick(r, VARS)}`;
  if (kind < 0.9) return `Number.isFinite(${v})`;
  return `${v} ${pick(r, ["+", "-"])} ${pick(r, VARS)} ${op} ${pick(r, CONSTS)}`;
}

function randomGoal(r: () => number): string {
  const kind = r();
  if (kind < 0.5) return randomAtom(r);
  if (kind < 0.8) {
    return `${pick(r, VARS)} ${pick(r, ["+", "-"])} ${pick(r, [...VARS, ...CONSTS])} ${pick(
      r,
      OPS.slice(0, 4)
    )} ${pick(r, CONSTS)}`;
  }
  return `${randomAtom(r)} && ${randomAtom(r)}`;
}

const evalPred = (p: string, env: Record<string, number>): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  Boolean(Function(...VARS, `return (${p});`)(...VARS.map((v) => env[v])));

function assignments(r: () => number, n: number): Array<Record<string, number>> {
  const out: Array<Record<string, number>> = [];
  for (let i = 0; i < n; i++) {
    const env: Record<string, number> = {};
    for (const v of VARS) {
      const k = r();
      env[v] =
        k < 0.5
          ? pick(r, SPECIAL)
          : k < 0.8
            ? Math.round((r() * 40 - 20) * 2) / 2
            : (r() - 0.5) * 10 ** Math.floor(r() * 12 - 4);
    }
    out.push(env);
  }
  return out;
}

describe("prover soundness fuzz", () => {
  it("never proves a goal falsified by an assignment that satisfies the facts", () => {
    const r = mulberry32(0xc0ffee);
    const envs = assignments(r, 4000);
    // Exhaustive small cross product of the special values, too.
    for (const x of SPECIAL) for (const y of SPECIAL) envs.push({ x, y, z: pick(r, SPECIAL) });

    const unsound: string[] = [];
    let proven = 0;
    for (let i = 0; i < 2500; i++) {
      const nFacts = 1 + Math.floor(r() * 3);
      const facts: TypeFact[] = [];
      for (let j = 0; j < nFacts; j++) {
        const p = r() < 0.3 ? `${randomAtom(r)} && ${randomAtom(r)}` : randomAtom(r);
        facts.push({ variable: "x", predicate: p });
      }
      const goal = randomGoal(r);
      const results = [
        ["tryProve", tryProve(goal, facts)],
        ["tryLinearArithmetic", tryLinearArithmetic(goal, facts)],
        ["tryAlgebraicProof", tryAlgebraicProof(goal, facts)],
      ] as const;
      for (const [name, res] of results) {
        if (!res.proven) continue;
        proven++;
        const cex = envs.find(
          (env) => facts.every((f) => evalPred(f.predicate, env)) && !evalPred(goal, env)
        );
        if (cex) {
          unsound.push(
            `${name}: ${facts.map((f) => f.predicate).join(" ; ")} |- ${goal}  cex=${JSON.stringify(
              cex,
              (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v)
            )} (${res.reason})`
          );
        }
      }
    }
    expect(unsound.slice(0, 10)).toEqual([]);
    // Sanity: the fuzz is not vacuous — the prover does prove things.
    expect(proven).toBeGreaterThan(50);
  });
});

describe("prover: reviewer counterexamples are no longer proven", () => {
  const cases: Array<[string, string[]]> = [
    // #2 Fourier-Motzkin double flip / operator direction
    ["0.5 < x", ["x < 0 && Number.isFinite(x)"]],
    ["0 < x", ["x < 0 && Number.isFinite(x)"]],
    ["300.5 < x", ["x >= 0 && x <= 255"]],
    ["300 < x", ["x >= 0 && x <= 255"]],
    ["-1 > x", ["x >= 0 && x <= 255"]],
    ["y < x", ["x > 0", "x < y"]],
    ["x + y > 0", ["x >= 0", "y >= 0"]],
    ["x > y", ["x >= 0", "y >= 0"]],
    ["x - y > 0", ["x > 0", "y > 0"]],
    // substring-matching rules
    ["x >= 0", ["x * x > 0"]],
    ["x >= 0", ["x > 0 || x === -1"]],
    ["x > y", ["x > 0", "y.length < 0"]],
    // a || b && c is not a conjunction with c
    ["c", ["a || b && c"]],
    ["x > 0", ["x === -1 || y > 3 && x > 0"]],
    // NaN: tautology-shaped goals over unconstrained variables
    ["x <= x", []],
    ["x === x", []],
    ["x <= x", ["y > 0"]],
    // Infinity - Infinity is NaN
    ["x - y >= 0", ["x >= y"]],
    ["x + y >= 0", ["x >= 0", "y <= 0"]],
    // unsound legacy algebraic numeric rules
    ["2 * x > x", ["x > 0"]],
    ["x * y > 0", ["x > 0", "y > 0"]],
  ];
  for (const [goal, preds] of cases) {
    it(`does not prove ${goal} from ${JSON.stringify(preds)}`, () => {
      const facts = preds.map((predicate) => ({ variable: "x", predicate }));
      expect(tryProve(goal, facts).proven).toBe(false);
    });
  }
});

describe("prover: sound goals are still proven", () => {
  const cases: Array<[string, string[]]> = [
    ["x > 0", ["x > 0 && Number.isFinite(x)"]],
    ["x >= 0", ["x > 0"]],
    ["x > -1", ["x >= 0 && x <= 255"]],
    ["x <= 300", ["x >= 0 && x <= 255"]],
    ["0 <= x && x <= 255", ["x >= 0 && x <= 255"]],
    ["x > z", ["x > y", "y > z"]],
    ["x + y > 0", ["x > 0", "y >= 0"]],
    ["x + y >= 0", ["x >= 0", "y >= 0"]],
    ["x + y >= 2", ["x >= 1", "y >= 1"]],
    ["x - y > 0", ["x > y"]],
    ["x - y >= 0", ["x >= y", "Number.isFinite(x)"]],
    ["x - y < 0", ["x < y"]],
    ["x + 1 > 0", ["x >= 0"]],
    ["x > y", ["x > 0", "y < 0"]],
    ["x === 5", ["x >= 5 && x <= 5"]],
  ];
  for (const [goal, preds] of cases) {
    it(`proves ${goal} from ${JSON.stringify(preds)}`, () => {
      const facts = preds.map((predicate) => ({ variable: "x", predicate }));
      expect(tryProve(goal, facts).proven).toBe(true);
    });
  }
});

describe("algebraic rules require matching facts (#3)", () => {
  const noFacts: TypeFact[] = [];
  it.each([
    "a.concat(b) === b.concat(a)",
    "sub(a, b) === sub(b, a)",
    "map(g, map(f, xs)) === map(anything, xs)",
    "map(id, xs) === xs",
    "x === x",
    "combine(combine(a, b), c) === combine(a, combine(b, c))",
    "combine(empty, a) === a",
  ])("does not prove %s without facts", (goal) => {
    expect(tryAlgebraicProof(goal, noFacts).proven).toBe(false);
    expect(tryProve(goal, noFacts).proven).toBe(false);
  });

  it("proves commutativity only for the op the fact names", () => {
    const facts = [{ variable: "add", predicate: "commutative(add)" }];
    expect(tryAlgebraicProof("add(a, b) === add(b, a)", facts).proven).toBe(true);
    expect(tryAlgebraicProof("sub(a, b) === sub(b, a)", facts).proven).toBe(false);
  });

  it("proves associativity only with a matching associative() fact", () => {
    const goal = "combine(combine(a, b), c) === combine(a, combine(b, c))";
    expect(
      tryAlgebraicProof(goal, [{ variable: "combine", predicate: "associative(combine)" }]).proven
    ).toBe(true);
    expect(
      tryAlgebraicProof(goal, [{ variable: "concat", predicate: "associative(concat)" }]).proven
    ).toBe(false);
    // Misparenthesised "associativity" is not associativity.
    expect(
      tryAlgebraicProof("combine(combine(a, b), c) === combine(a, combine(c, b))", [
        { variable: "combine", predicate: "associative(combine)" },
      ]).proven
    ).toBe(false);
  });

  it("identity needs the fact to name the identity element", () => {
    const facts = [{ variable: "empty", predicate: "identity(combine)" }];
    expect(tryAlgebraicProof("combine(empty, a) === a", facts).proven).toBe(true);
    expect(tryAlgebraicProof("combine(other, a) === a", facts).proven).toBe(false);
  });

  it("verifyLaw does not prove a law from its own proof hint", () => {
    const result = verifyLaw(
      {
        name: "commutativity",
        arity: 2,
        description: "sub(a, b) === sub(b, a)",
        proofHint: "commutativity",
        check: () => true,
      } as never,
      []
    );
    expect(result.status).toBe("undecidable");
  });
});
