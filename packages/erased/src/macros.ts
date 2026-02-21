/**
 * Expression macro for automatic vtable resolution.
 *
 * Phase 1 (current): the `erased()` call is a pass-through — vtables
 * must be supplied explicitly at call sites.
 *
 * Phase 2 (future): the macro will resolve vtables from the typeclass
 * registry at compile time, eliminating manual vtable construction.
 *
 * @module
 */

import { defineExpressionMacro } from "@typesugar/core";

/** Expression macro stub for `erased()`. Currently a no-op pass-through. */
export const erasedMacro = defineExpressionMacro({
  name: "erased",
  module: "@typesugar/erased",
  description:
    "Erase a value's type, keeping only specified capabilities. " +
    "Phase 1: pass-through. Phase 2: auto-resolve vtable from typeclass registry.",
  expand(_ctx, call, _args) {
    return call;
  },
});
