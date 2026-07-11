/**
 * Standard Library Macros
 *
 * This module exports macros provided by @typesugar/std.
 *
 * ## Available Macros
 *
 * - `registerStdInstances()` - Deprecated no-op stub (instances are scope-resolved, PEP-052)
 * - `let:/yield:` - Monadic do-notation for Promise, Array, Option, etc.
 * - `par:/yield:` - Applicative (parallel) comprehensions with Promise.all / .map().ap()
 */

import { registerSyntaxMarkerFallback } from "@typesugar/core";
import { registerResultAlgebra, type ResultAlgebra } from "@typesugar/macros";

// Side-effect import: register the ParCombine builders/instances used by the
// par:/yield: macro. This compile-time registration lives in `par-combine.ts`
// (which imports `typescript`); loading it here ensures it runs when the
// transformer loads this `./macros` entry (PEP-050 Case-1). The runtime
// instances are re-exported separately from the `typescript`-free
// `typeclasses/par-combine-instances.ts` by the `.` entry.
import "../typeclasses/par-combine.js";

/**
 * Promise algebra: ok(v) -> Promise.resolve(v), err(e) -> Promise.reject(e)
 *
 * Specializes Result<E, T> to Promise<T>. Useful for async error handling.
 * Relocated here from `@typesugar/macros`'s `specialize.ts` (PEP-055 Phase
 * D) — `std` always loads first whenever any `@typesugar/*` package is
 * imported (see `macro-loader.ts`), so this registers unconditionally for
 * any typesugar project, same guarantee the old builtin seed made.
 */
export const promiseResultAlgebra: ResultAlgebra = {
  name: "Promise",
  targetTypes: ["Promise"],
  rewriteOk: (ctx, value) =>
    ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(
        ctx.factory.createIdentifier("Promise"),
        "resolve"
      ),
      undefined,
      [value]
    ),
  rewriteErr: (ctx, error) =>
    ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(ctx.factory.createIdentifier("Promise"), "reject"),
      undefined,
      [error]
    ),
  preservesError: true,
};

registerResultAlgebra(promiseResultAlgebra);

export * from "./comprehension-utils.js";
export * from "./let-yield.js";
export * from "./par-yield.js";
export * from "./match.js";
export { registerStdInstances } from "./register-instances-runtime.js";

// ============================================================================
// PEP-052 Wave 6: resolution-free fallback for std's syntax-activation
// markers, so operator/method syntax activates even in hosts that cannot
// resolve modules via the checker (the `@typesugar/playground` in-memory
// host, virtual file names). Checker-based marker discovery
// (`readSyntaxActivationMarkers`) remains the general mechanism and always
// takes precedence when it works; this only fills the gap. One row per
// `packages/std/src/syntax/*.ts` marker file — kept in exact sync with those
// files' own `@syntax-methods`/`@syntax-operators` JSDoc tags by
// `pep052-marker-fallback.test.ts`'s drift-protection test.
const STD_SYNTAX_TYPECLASSES: ReadonlyArray<{ path: string; typeclass: string; hasOps: boolean }> =
  [
    { path: "eq", typeclass: "Eq", hasOps: true },
    { path: "ord", typeclass: "Ord", hasOps: true },
    { path: "semigroup", typeclass: "Semigroup", hasOps: true },
    { path: "monoid", typeclass: "Monoid", hasOps: true },
    { path: "group", typeclass: "Group", hasOps: true },
    { path: "numeric", typeclass: "Numeric", hasOps: true },
    { path: "integral", typeclass: "Integral", hasOps: true },
    { path: "fractional", typeclass: "Fractional", hasOps: true },
    { path: "clone", typeclass: "Clone", hasOps: false },
    { path: "debug", typeclass: "Debug", hasOps: false },
    { path: "default", typeclass: "Default", hasOps: false },
    { path: "json", typeclass: "Json", hasOps: false },
    { path: "type-guard", typeclass: "TypeGuard", hasOps: false },
  ];

for (const { path, typeclass, hasOps } of STD_SYNTAX_TYPECLASSES) {
  registerSyntaxMarkerFallback(`@typesugar/std/syntax/${path}`, { methods: [typeclass] });
  if (hasOps) {
    registerSyntaxMarkerFallback(`@typesugar/std/syntax/${path}/ops`, { operators: [typeclass] });
  }
}
