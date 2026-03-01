/**
 * Expression macro registrations for @typesugar/fusion
 *
 * **Phase 1 (current):** Pass through to runtime LazyPipeline construction.
 * The LazyPipeline class handles fusion at runtime (single-pass iteration,
 * no intermediate arrays).
 *
 * **Phase 2 (future):** Analyze method chains at compile time and emit
 * fused single-pass loops directly — no LazyPipeline object at runtime.
 */

import { defineExpressionMacro, globalRegistry } from "@typesugar/core";

/**
 * The `lazy` expression macro.
 *
 * Phase 1 behavior: pass-through (the runtime LazyPipeline handles fusion).
 * Phase 2 will analyze `.filter().map().reduce()` chains at compile time
 * and emit a fused `for` loop with no intermediate allocations.
 */
export const lazyMacro = defineExpressionMacro({
  name: "lazy",
  module: "@typesugar/fusion",
  description: "Create a lazy, fused iterator pipeline",
  expand(_ctx, callExpr, _args) {
    return callExpr;
  },
});

/**
 * The `fused` expression macro (placeholder for Phase 2).
 *
 * Will wrap array expressions and compile element-wise operations
 * into a single fused loop. For now, pass-through.
 */
export const fusedMacro = defineExpressionMacro({
  name: "fused",
  module: "@typesugar/fusion",
  description: "Fuse element-wise array/vector operations into a single loop",
  expand(_ctx, callExpr, _args) {
    return callExpr;
  },
});

/** Register fusion macros with the global registry. Called on package import. */
export function register(): void {
  globalRegistry.register(lazyMacro);
  globalRegistry.register(fusedMacro);
}
