/**
 * `extend()` macro regression tests (backlog item found during the PEP-052
 * confidence audit, not part of any wave).
 *
 * Two independent bugs in the same macro:
 *
 * 1. Double-invocation codegen: `extend(value).method(args)` is a two-call
 *    chain. Without `chainable: true`, the transformer only handed `expand()`
 *    the inner `extend(value)` call — but `expand()` already generated the
 *    FULL `TC.summon(...).method(...)` call, so the untouched outer
 *    `.method(args)` from the original source applied the method a second
 *    time on top of it.
 * 2. Blind first-candidate dispatch: when more than one `@typeclass` declares
 *    a method with the same name, the macro picked whichever came first from
 *    `getTypeclassesDeclaringMethod` (arbitrary order) without checking
 *    whether that typeclass actually has an instance for the value's type —
 *    so a typeclass with no instance could win over one that does.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/pipeline.js";

describe("extend() macro", () => {
  it("does not invoke the method twice (chainable dispatch)", () => {
    const code = `
import { extend } from "@typesugar/typeclass";

/** @typeclass */
interface Greet<A> {
  greet(a: A): string;
}

/** @impl("Greet<number>") */
const greetNumber = {
  greet: (n: number) => \`hello \${n}\`,
};

declare const n: number;
export const r = extend(n).greet();
`.trim();

    const result = transformCode(code, { fileName: "extend-no-double-invoke.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toContain("extend(");
    // Exactly one `.greet(` call — the pre-fix bug left a second, outer
    // `.greet()` wrapping the macro's own fully-formed replacement.
    expect(result.code.match(/\.greet\(/g)).toHaveLength(1);
    expect(result.code).toContain('Greet.summon<number>("number").greet(n)');
  });

  it("picks the candidate typeclass that actually has an instance, not just the first declared", () => {
    // A user-defined type, not a primitive — `hasPrimitiveOrInstance` treats
    // every typeclass as having an instance for a primitive, which would
    // mask this bug (any candidate would "pass"). Widget forces the
    // instance-in-scope check to actually run.
    const code = `
import { extend } from "@typesugar/typeclass";

interface Widget {
  id: number;
}

/** @typeclass */
interface NoInstance<A> {
  label(a: A): string;
}

/** @typeclass */
interface HasInstance<A> {
  label(a: A): string;
}

/** @impl("HasInstance<Widget>") */
const hasInstanceWidget = {
  label: (w: Widget) => \`widget \${w.id}\`,
};

declare const w: Widget;
export const r = extend(w).label();
`.trim();

    const result = transformCode(code, { fileName: "extend-instance-existence-check.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain('HasInstance.summon<Widget>("Widget").label(w)');
    expect(result.code).not.toContain("NoInstance.summon");
  });
});
