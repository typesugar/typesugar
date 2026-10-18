/**
 * @typesugar/contracts end-to-end: source → transformer → JS → EXECUTE.
 *
 * Deep review 2026-10 (effect-contracts #1, #4, #5, #7, #9, #23, #24, #25,
 * #34). Every test runs the generated code against the real runtime error
 * classes rather than grepping output text.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
// The transformer is a sibling workspace package (not a dependency of
// contracts); import its pipeline from source, as its own tests do.
import { transformCode } from "../../transformer/src/pipeline.js";
import "@typesugar/contracts/macros";
import * as contracts from "@typesugar/contracts";
import { setContractConfig } from "@typesugar/contracts";

let counter = 0;

function transform(code: string) {
  // A repo-relative file name so `@typesugar/contracts/syntax` etc. resolve
  // through the workspace node_modules.
  return transformCode(code, { fileName: `contracts-e2e-${counter++}.ts` });
}

/** Transpile to CJS and evaluate; `@typesugar/contracts` is the real runtime. */
function load(tsCode: string): Record<string, any> {
  const js = ts.transpileModule(tsCode, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: false,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  const req = (id: string) => {
    if (id === "@typesugar/contracts") return contracts;
    return {};
  };
  new Function("require", "exports", "module", js)(req, exports, { exports });
  return exports;
}

function errorsOf(r: ReturnType<typeof transform>) {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
}

afterEach(() => {
  setContractConfig({ mode: "full", proveAtCompileTime: false });
});

describe('#1 (cond, "message") contract conditions are checked', () => {
  const SRC = `
import "@typesugar/contracts/syntax";
export function divide(a: number, b: number): number {
  requires: {
    (b !== 0, "divisor must not be zero");
  }
  ensures: (r) => {
    (Number.isFinite(r), "result must be finite");
  }
  return a / b;
}
`;
  it("throws the precondition with the custom message", () => {
    const r = transform(SRC);
    expect(errorsOf(r)).toEqual([]);
    const m = load(r.code);
    expect(m.divide(6, 3)).toBe(2);
    expect(() => m.divide(1, 0)).toThrow("divisor must not be zero");
  });

  it("warns when the message is not a string literal", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
const msg = "m";
export function f(a: number): number {
  requires: { (a > 0, msg); }
  return a;
}
`);
    expect(r.diagnostics.some((d) => /must be a string literal/.test(d.message))).toBe(true);
    expect(() => load(r.code).f(-1)).toThrow(contracts.PreconditionError);
  });

  it("reports non-expression statements in a contract block", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export function f(a: number): number {
  requires: {
    const limit = 3;
    a > limit;
  }
  return a;
}
`);
    expect(errorsOf(r).some((m) => /Only expression statements/.test(m))).toBe(true);
  });
});

describe("#5 implicit `result` in ensures: { ... }", () => {
  it("binds result for the block form", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export function abs(x: number): number {
  ensures: { result >= 0; }
  return x < 0 ? -x : x;
}
export function bad(x: number): number {
  ensures: { result >= 0; }
  return x;
}
`);
    expect(errorsOf(r)).toEqual([]);
    const m = load(r.code);
    expect(m.abs(-3)).toBe(3);
    expect(() => m.bad(-1)).toThrow(contracts.PostconditionError);
  });

  it("a parameter named result keeps meaning the parameter", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export function f(result: number): number {
  ensures: { result === 1; }
  return 99;
}
`);
    const m = load(r.code);
    expect(m.f(1)).toBe(99);
    expect(() => m.f(2)).toThrow(contracts.PostconditionError);
  });
});

describe("#4 async and generator functions", () => {
  it("checks the awaited value of an async function", async () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export async function load(x: number): Promise<number> {
  requires: { x > 0; }
  ensures: (r) => { r > 10; }
  const v = await Promise.resolve(x);
  return v * 2;
}
`);
    expect(errorsOf(r)).toEqual([]);
    const m = load(r.code);
    await expect(m.load(6)).resolves.toBe(12);
    await expect(m.load(2)).rejects.toBeInstanceOf(contracts.PostconditionError);
    await expect(m.load(-1)).rejects.toBeInstanceOf(contracts.PreconditionError);
  });

  it("rejects contracts on generators with an error", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export function* gen(n: number) {
  requires: { n > 0; }
  yield n;
}
`);
    expect(errorsOf(r).some((m) => /does not support generator/.test(m))).toBe(true);
  });
});

describe("#25 result binding does not rename properties", () => {
  it("result === o.result holds", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
export function prop(o: { result: number }): number {
  ensures: (result) => { result === o.result; }
  return o.result;
}
export function shorthand(o: { result: number }): { result: number } {
  ensures: (result) => { ({ result }).result.result === o.result; }
  return { result: o.result };
}
`);
    expect(errorsOf(r)).toEqual([]);
    const m = load(r.code);
    expect(m.prop({ result: 4 })).toBe(4);
    expect(m.shorthand({ result: 5 })).toEqual({ result: 5 });
  });
});

describe("#24 typed contract errors", () => {
  it("block form, inline requires()/ensures() and invariants throw the typed errors", () => {
    const r = transform(`
import "@typesugar/contracts/syntax";
import { requires, ensures, invariant } from "@typesugar/contracts";
export function pre(x: number) { requires: { x > 0; } return x; }
export function post(x: number): number { ensures: (r) => { r > 0; } return x; }
export function inlinePre(x: number) { requires(x > 0); return x; }
export function inlinePost(x: number) { ensures(x > 0); return x; }
@invariant((self) => self.n >= 0)
export class C { n = 0; dec() { this.n--; } }
`);
    expect(errorsOf(r)).toEqual([]);
    const m = load(r.code);
    expect(() => m.pre(-1)).toThrow(contracts.PreconditionError);
    expect(() => m.post(-1)).toThrow(contracts.PostconditionError);
    expect(() => m.inlinePre(-1)).toThrow(contracts.PreconditionError);
    expect(() => m.inlinePost(-1)).toThrow(contracts.PostconditionError);
    expect(() => new m.C().dec()).toThrow(contracts.InvariantError);
  });
});

describe("#9 @invariant", () => {
  const SRC = `
import { invariant } from "@typesugar/contracts";
@invariant((self) => self.balance >= 0, "Balance must be non-negative")
export class BankAccount {
  balance = 0;
  withdraw(amount: number): number {
    this.balance -= amount;
    return this.balance;
  }
  deposit(amount: number): void {
    if (amount === 0) return;
    this.balance += amount;
  }
  fail(): void { throw new RangeError("boom"); }
  static create(): BankAccount { return new BankAccount(); }
  static reset(): void {}
  set raw(v: number) { this.balance = v; }
  private hidden() { this.balance = -100; }
  breakViaHidden() { this.hidden(); this.balance = 1; }
}
@invariant((self) => self.size > 0, "size must be positive")
export class Bad { size = 0; }
`;
  it("checks after return, skips statics, checks setters and construction", () => {
    const r = transform(SRC);
    expect(errorsOf(r)).toEqual([]);
    const { BankAccount, Bad } = load(r.code);
    const acct = BankAccount.create(); // static: no check against the class
    BankAccount.reset();
    acct.deposit(10);
    expect(acct.withdraw(4)).toBe(6);
    expect(() => acct.withdraw(100)).toThrow(contracts.InvariantError);
    const acct2 = new BankAccount();
    expect(() => {
      acct2.raw = -1;
    }).toThrow("Balance must be non-negative");
    // An exception from the body is not masked by the invariant check.
    expect(() => new BankAccount().fail()).toThrow(RangeError);
    // Private helpers are not checked; the public caller is, on exit.
    const acct3 = new BankAccount();
    expect(() => acct3.breakViaHidden()).not.toThrow();
    // Field initializers are checked at construction.
    expect(() => new Bad()).toThrow("size must be positive");
  });

  it("checks construction of a derived class without its own constructor", () => {
    const r = transform(`
import { invariant } from "@typesugar/contracts";
class Base { constructor(public n: number) {} }
@invariant((self) => self.n > 0, "n must be positive")
export class Derived extends Base {}
`);
    expect(errorsOf(r)).toEqual([]);
    const { Derived } = load(r.code);
    expect(new Derived(3).n).toBe(3);
    expect(() => new Derived(-3)).toThrow("n must be positive");
  });
});

describe("#7 / #34 compile-time proofs with refined types", () => {
  const SRC = `
import "@typesugar/contracts/syntax";
import "@typesugar/contracts-refined";
import type { Positive, Byte } from "@typesugar/type-system";
export function proven(x: Positive): number {
  requires: { x > 0; }
  return x;
}
export function sum(x: Byte, y: Byte): number {
  requires: { x + y >= 0; }
  return x + y;
}
export function unproven(x: Positive): number {
  requires: { x > 1; }
  return x;
}
export function shadow(x: Positive): number {
  ensures: (x) => { x > 0; }
  return -1;
}
export function reassigned(x: Positive): number {
  ensures: { x > 0; }
  x = -5 as Positive;
  return 0;
}
`;
  it("elides proven checks and keeps the rest", () => {
    setContractConfig({ proveAtCompileTime: true });
    const r = transform(SRC);
    expect(errorsOf(r)).toEqual([]);
    const fn = (name: string) => {
      const start = r.code.indexOf(`function ${name}(`);
      const next = r.code.indexOf("export function", start + 1);
      return r.code.slice(start, next === -1 ? undefined : next);
    };
    expect(fn("proven")).not.toContain("PreconditionError");
    expect(fn("sum")).not.toContain("PreconditionError");
    expect(fn("unproven")).toContain("PreconditionError");
    const m = load(r.code);
    expect(() => m.unproven(0.5)).toThrow(contracts.PreconditionError);
    // The result parameter shadows the refined parameter: not "proven".
    expect(() => m.shadow(5)).toThrow(contracts.PostconditionError);
    // A reassigned parameter's entry facts are not used at exit.
    expect(() => m.reassigned(5)).toThrow(contracts.PostconditionError);
  });
});

describe("#8 contracts config is honoured", () => {
  it("mode none strips the checks", () => {
    setContractConfig({ mode: "none" });
    const r = transform(`
import "@typesugar/contracts/syntax";
export function f(x: number): number { requires: { x > 0; } return x; }
`);
    expect(r.code).not.toContain("PreconditionError");
    expect(load(r.code).f(-1)).toBe(-1);
  });
});

describe("#23 @laws property-test codegen (ts.factory)", () => {
  it("generates runnable describe/it law checks", () => {
    const r = transform(`
import { laws } from "@typesugar/contracts";
const arb = { arbitrary: () => Math.floor(Math.random() * 10) };
function addLaws(m: { add(a: number, b: number): number }) {
  return [{ name: "commutative", arity: 2, check: (a: number, b: number) => m.add(a, b) === m.add(b, a) }];
}
@laws(addLaws, { mode: "property-test", arbitrary: arb, iterations: 20 })
export class Adder { static add(a: number, b: number) { return a + b; } }
`);
    expect(errorsOf(r)).toEqual([]);
    // Run the generated describe/it with tiny stand-ins.
    const ran: string[] = [];
    const g = globalThis as Record<string, unknown>;
    const saved = { describe: g.describe, it: g.it };
    g.describe = (_name: string, fn: () => void) => fn();
    g.it = (name: string, fn: () => void) => {
      ran.push(name);
      fn();
    };
    try {
      load(r.code);
    } finally {
      g.describe = saved.describe;
      g.it = saved.it;
    }
    expect(ran).toEqual(["satisfies commutative"]);
  });
});
