/**
 * `extend(value).method(args)` through the REAL pipeline, executed (round-2
 * docs findings):
 *
 * - When no typeclass instance and no registered standalone extension
 *   matched, extend() emitted `value.method(args)` as a SYNTHETIC node, which
 *   the visitor never rewrites: `extend(150).clamp(0, 100)` with std's
 *   import-scoped `clamp` became `150..clamp(0, 100)` and threw "is not a
 *   function" at run time, with no diagnostic.
 * - On a type parameter (`function f<T>(x: T) { extend(x).show() }`) it also
 *   emitted a bare `x.show()` silently.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { standaloneExtensionRegistry } from "@typesugar/core";
import { transformAndRun } from "./match-exec-helpers.js";

// The process-wide standalone-extension registry may already hold std's
// extensions (dist self-registration, earlier tests); empty it so the
// import-scoped resolution -- what a fresh build sees -- is what runs.
beforeEach(() => {
  standaloneExtensionRegistry.length = 0;
});

describe("extend(value).method() falls back to the method-call rewrite", () => {
  it("extend(150).clamp(0, 100) uses std's import-scoped clamp and runs", () => {
    const r = transformAndRun(`import { extend } from "typesugar";
import { clamp, capitalize } from "@typesugar/std";
export const a = extend(150).clamp(0, 100);
const n: number = -5;
export const b = extend(n).clamp(0, 100);
export const c = extend("hello").capitalize();`);
    if (r.runError) throw new Error(`${String(r.runError)}\n--- emitted ---\n${r.code}`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toMatch(/\.clamp\(|\.capitalize\(/);
    expect(r.exports).toMatchObject({ a: 100, b: 0, c: "Hello" });
  });

  it("extend(x).show() on a type parameter is an error that says to take the instance as a parameter", () => {
    const r = transformAndRun(`import { extend } from "typesugar";
/** @typeclass */
interface Show<A> { show(a: A): string }
export function f<T>(x: T): string { return extend(x).show(); }`);
    const msg = r.errors.join("\n");
    expect(msg).toContain("extend(x).show()");
    expect(msg).toContain("type parameter");
    expect(msg).toContain("implicit()");
  });
});
