/**
 * PEP-052 Wave 6 — operator/method marker fallback, legacy pipeline
 * (method sugar, tier 2, is legacy-transformer-only: `tryResolveTypeclassMethod`
 * has no transformer-core equivalent — `packages/transformer-core/src/rewriting.ts`
 * implements only the operator tier).
 *
 * Uses a host that serves ONLY the single input file — no `ts.sys` fallback —
 * so `@typesugar/fp/syntax/show`'s module genuinely cannot be checker-resolved
 * (isolating the activation gate from instance resolution, which needs its
 * own module access: the test's instance is declared IN-FILE via `@impl`, so
 * `resolveInstance`'s local-scope scan needs no module resolution either).
 *
 * NOTE: the local `Show<A>` interface below carries a `@typeclass` tag.
 * `tryResolveTypeclassMethod`'s method-candidate lookup
 * (`getMethodCandidates`/`buildIndex` in `@typesugar/macros/typeclass-index.ts`)
 * only recognizes a typeclass name that is either in the static
 * `STANDARD_TYPECLASS_DEFS` seed or a source `interface` tagged `@typeclass` —
 * "Show" is not seeded, so without the tag the method tier never activates,
 * independent of the Wave 6 fallback (which only gates *syntax activation*,
 * i.e. whether method-sugar lookup is attempted at all).
 */
import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import "@typesugar/fp"; // registers the @typesugar/fp/syntax/show fallback

function onlyServeInputFile(fileName: string, content: string) {
  return {
    readFile: (f: string) => (f === fileName ? content : undefined),
    fileExists: (f: string) => f === fileName,
  };
}

describe("PEP-052 Wave 6: fp Show marker fallback, legacy pipeline (method sugar)", () => {
  it("activates .show() method sugar with a module the host cannot resolve at all", () => {
    const code = `
import "@typesugar/fp/syntax/show";

class Money {
  constructor(public cents: number) {}
}
/** @typeclass */
interface Show<A> { show(a: A): string; }
/** @impl Show<Money> */
const moneyShow: Show<Money> = {
  show: (m) => \`$\${(m.cents / 100).toFixed(2)}\`,
};

declare const m: Money;
export const r = m.show();
`.trim();

    const fileName = "/tmp/pep052-wave6-legacy-fixture/unreachable.ts";
    const result = transformCode(code, { fileName, ...onlyServeInputFile(fileName, code) });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/[^.]m\.show\(\)/);
    expect(result.code).toContain("moneyShow.show(m)");
  });

  it("leaves .show() untouched in the same unresolvable host without the marker import", () => {
    const code = `
class Money {
  constructor(public cents: number) {}
}
interface Show<A> { show(a: A): string; }
/** @impl Show<Money> */
const moneyShow: Show<Money> = {
  show: (m) => \`$\${(m.cents / 100).toFixed(2)}\`,
};

declare const m: Money;
export const r = m.show();
`.trim();

    const fileName = "/tmp/pep052-wave6-legacy-fixture/unreachable-off.ts";
    const result = transformCode(code, { fileName, ...onlyServeInputFile(fileName, code) });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("m.show()");
    expect(result.code).not.toContain("moneyShow.show");
  });
});
