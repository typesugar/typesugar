/**
 * PEP-052 Wave 6 — operator/method marker fallback, legacy pipeline
 * (method sugar, tier 2, is legacy-transformer-only: `tryResolveTypeclassMethod`
 * has no transformer-core equivalent — `packages/transformer-core/src/rewriting.ts`
 * implements only the operator tier).
 *
 * Uses a host that serves ONLY two local files — no `ts.sys` fallback — so
 * `@typesugar/fp/syntax/show`'s module genuinely cannot be checker-resolved
 * (isolating the activation gate from instance resolution, which needs its
 * own module access: the test's instance is declared IN-FILE via `@impl`, so
 * `resolveInstance`'s local-scope scan needs no module resolution either).
 *
 * The `@typeclass`-tagged `Show<A>` interface lives in a SEPARATE file
 * (`show-decl.ts`, included via `extraRootFiles` so `getMethodCandidates`/
 * `buildIndex` — which scans the whole program — can see its tag) rather
 * than in the consumer file itself. `ResolutionScopeTracker.definedTypeclasses`
 * treats a typeclass declared IN a file as always in scope for THAT file,
 * with no import needed ("you don't need to import what you define" —
 * `resolution-scope.ts`), so keeping the declaration out of the consumer
 * file is required for the "off" test to actually isolate the Wave 6
 * fallback: with the tag in the same file, method sugar would self-activate
 * regardless of any marker import, and the negative control would prove
 * nothing. The consumer only needs a local, checker-resolvable `import type`
 * for `Show<Money>` to type-check — unrelated to Wave 6, since it never
 * touches `@typesugar/fp/syntax/show`.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { transformCode } from "@typesugar/transformer/pipeline";
import "@typesugar/fp"; // registers the @typesugar/fp/syntax/show fallback

function twoFileHost(files: Record<string, string>) {
  return {
    readFile: (f: string) => files[f],
    fileExists: (f: string) => f in files,
  };
}

const SHOW_DECL = `
/** @typeclass */
export interface Show<A> { show(a: A): string; }
`.trim();

describe("PEP-052 Wave 6: fp Show marker fallback, legacy pipeline (method sugar)", () => {
  it("activates .show() method sugar with a module the host cannot resolve at all", () => {
    const declFile = path.resolve("/tmp/pep052-wave6-legacy-fixture/show-decl.ts");
    const fileName = path.resolve("/tmp/pep052-wave6-legacy-fixture/unreachable.ts");
    const code = `
import "@typesugar/fp/syntax/show";
import type { Show } from "./show-decl.js";

class Money {
  constructor(public cents: number) {}
}
/** @impl Show<Money> */
const moneyShow: Show<Money> = {
  show: (m) => \`$\${(m.cents / 100).toFixed(2)}\`,
};

declare const m: Money;
export const r = m.show();
`.trim();

    const result = transformCode(code, {
      fileName,
      extraRootFiles: [declFile],
      ...twoFileHost({ [fileName]: code, [declFile]: SHOW_DECL }),
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/[^.]m\.show\(\)/);
    expect(result.code).toContain("moneyShow.show(m)");
  });

  it("leaves .show() untouched in the same unresolvable host without the marker import", () => {
    const declFile = path.resolve("/tmp/pep052-wave6-legacy-fixture/show-decl-off.ts");
    const fileName = path.resolve("/tmp/pep052-wave6-legacy-fixture/unreachable-off.ts");
    const code = `
import type { Show } from "./show-decl-off.js";

class Money {
  constructor(public cents: number) {}
}
/** @impl Show<Money> */
const moneyShow: Show<Money> = {
  show: (m) => \`$\${(m.cents / 100).toFixed(2)}\`,
};

declare const m: Money;
export const r = m.show();
`.trim();

    const result = transformCode(code, {
      fileName,
      extraRootFiles: [declFile],
      ...twoFileHost({ [fileName]: code, [declFile]: SHOW_DECL }),
    });

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("m.show()");
    expect(result.code).not.toContain("moneyShow.show");
  });
});
