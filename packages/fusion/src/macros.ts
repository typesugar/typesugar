/**
 * Expression macro registrations for @typesugar/fusion
 *
 * Phase 1: pass through to runtime LazyPipeline construction.
 * Phase 2 (future): analyze method chains at compile time and
 * emit fused single-pass loops directly.
 */

import { defineExpressionMacro } from "@typesugar/core";

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
