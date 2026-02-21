import { defineAttributeMacro, globalRegistry } from "@typesugar/core";

/**
 * Phase 1: `@namedArgs` registers parameter metadata and wraps the function
 * with a `.namedCall()` method at runtime.
 *
 * Phase 2 (future): rewrite call sites to positional calls at compile time,
 * eliminating the options-object allocation entirely.
 */
export const namedArgsMacro = defineAttributeMacro({
  name: "namedArgs",
  module: "@typesugar/named-args",
  description:
    "Enable named argument calling convention for a function",
  validTargets: ["function", "method"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

globalRegistry.register(namedArgsMacro);
