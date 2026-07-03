/**
 * PEP-052 Wave 5 — `Show` method-sugar activation through the real package.
 *
 * `Show` was deliberately left untagged through Phase E (its `.show()` sugar
 * was already unreachable, so tagging it was deferred to its own pass with
 * export-shape verification — see PEP-052 "Implementation status"). This
 * wires it up the same way Eq/Ord's method syntax was gated: a
 * `@typesugar/fp/syntax/show` import activates `.show()` method sugar, which
 * then resolves `showNumber` purely from scope (PEP-052: an `@impl`-tagged
 * export of an imported module — no name-import required).
 *
 * The fixtures deliberately do NOT name-import `showNumber` itself: doing so
 * would additionally satisfy the OLDER, gate-independent "Scala 3-style"
 * standalone-extension-import mechanism (any named import whose value has a
 * same-named, same-shaped method is treated as an extension regardless of
 * `@syntax-methods` activation), which would make both the "on" and "off"
 * fixtures rewrite and defeat the point of this test. A side-effect import
 * of the instance module is enough for scope-based instance resolution and
 * carries no named binding for the extension scanner to match.
 *
 * `Show` has no operator form, so — unlike Eq/Ord — there is only one tier
 * to test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import { clearResolverCache, instanceScanner } from "@typesugar/macros";

beforeEach(() => {
  clearResolverCache();
  instanceScanner.clearCache();
});

describe("PEP-052 Wave 5: fp Show method-sugar activation", () => {
  it("rewrites `n.show()` when @typesugar/fp/syntax/show is imported", () => {
    const code = `
import "@typesugar/fp/typeclasses/show";
import "@typesugar/fp/syntax/show";

declare const n: number;
export const r = n.show();
`.trim();

    const result = transformCode(code, { fileName: "consumer-show.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/n\.show\(\)/);
    expect(result.code).toContain("showNumber.show(n)");
  });

  it("leaves `n.show()` untouched without the @syntax-methods marker import", () => {
    const code = `
import "@typesugar/fp/typeclasses/show";

declare const n: number;
export const r = n.show();
`.trim();

    const result = transformCode(code, { fileName: "consumer-show-off.ts" });
    expect(result.code).toContain("n.show()");
    expect(result.code).not.toContain("showNumber.show");
  });
});
