/**
 * PEP-033 N4: @contract old() pre-state snapshot, end-to-end through the
 * transformer pipeline.
 *
 * Covers:
 *  - explicit @contract + ensures: block with old()
 *  - implicit @contract via `requires:`/`ensures:` trigger labels (no decorator)
 *  - standalone ensures(old(...)) reports a diagnostic (cannot capture pre-state)
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "../src/pipeline.js";
import "@typesugar/macros";
import "@typesugar/contracts/macros";

function transform(code: string) {
  return transformCode(code, { fileName: "/virtual/contract-old.ts" });
}

/** Transpile transformed TS to JS, run __run__, return its result (or throw). */
function execRun(tsCode: string): unknown {
  const js = ts.transpileModule(tsCode.replace(/^\s*import .*$/gm, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const fn = new Function(js + "\n;return __run__();");
  return fn();
}

const EXPLICIT = `
import { contract, old } from "@typesugar/contracts";
@contract
function withdraw(account: { balance: number }, amount: number): number {
  ensures: (result) => { result === old(account.balance) - amount; }
  account.balance -= amount;
  return account.balance;
}
function __run__() { return withdraw({ balance: 100 }, 30); }
`;

const IMPLICIT = `
import { old } from "@typesugar/contracts";
function withdraw(account: { balance: number }, amount: number): number {
  ensures: { account.balance === old(account.balance) - amount; }
  account.balance -= amount;
  return account.balance;
}
function __run__() { return withdraw({ balance: 100 }, 30); }
`;

const IMPLICIT_VIOLATION = `
import { old } from "@typesugar/contracts";
function buggyWithdraw(account: { balance: number }, amount: number): number {
  ensures: { account.balance === old(account.balance) - amount; }
  account.balance -= amount + 1; // off-by-one: violates the postcondition
  return account.balance;
}
function __run__() { return buggyWithdraw({ balance: 100 }, 30); }
`;

describe("PEP-033 N4: @contract old() pre-state snapshot", () => {
  it("explicit @contract hoists old() to a pre-state snapshot before the body", () => {
    const { code, diagnostics } = transform(EXPLICIT);
    expect(diagnostics).toHaveLength(0);
    // old(account.balance) must be captured BEFORE the mutation, not inline.
    expect(code).toMatch(/const __typesugar_old_\w+ = account\.balance;/);
    // The captured snapshot — not the live current value — is used in the check.
    expect(code).toMatch(/=== __typesugar_old_\w+ - amount/);
  });

  it("explicit @contract: a satisfied postcondition does not throw", () => {
    expect(execRun(transform(EXPLICIT).code)).toBe(70);
  });

  it("implicit @contract: bare requires:/ensures: blocks work without a decorator", () => {
    const { code, diagnostics } = transform(IMPLICIT);
    expect(diagnostics).toHaveLength(0);
    expect(code).toMatch(/const __typesugar_old_\w+ = account\.balance;/);
    // ensures: label must be consumed, not left as a no-op labeled statement.
    expect(code).not.toMatch(/ensures:/);
    expect(execRun(code)).toBe(70);
  });

  it("implicit @contract: a violated postcondition throws at runtime", () => {
    const { code } = transform(IMPLICIT_VIOLATION);
    expect(() => execRun(code)).toThrow(/Postcondition failed/);
  });

  it("standalone ensures(old(...)) reports a diagnostic (cannot capture pre-state)", () => {
    const { diagnostics } = transform(`
import { ensures, old } from "@typesugar/contracts";
function withdraw(account: { balance: number }, amount: number): number {
  account.balance -= amount;
  ensures(account.balance === old(account.balance) - amount);
  return account.balance;
}
`);
    expect(diagnostics.some((d) => /old\(\) can only be used/.test(d.message ?? ""))).toBe(true);
  });
});
