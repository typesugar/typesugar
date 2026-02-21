import { defineAttributeMacro } from "@typesugar/core";

/**
 * Phase 1: macro stubs that register with the transformer but pass through unchanged.
 * Phase 2 will read type structure at compile time and generate optimized codecs.
 */

export const codecMacro = defineAttributeMacro({
  name: "codec",
  module: "@typesugar/codec",
  description: "Generate versioned codec for a type with schema evolution",
  validTargets: ["interface", "class"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const sinceMacro = defineAttributeMacro({
  name: "since",
  module: "@typesugar/codec",
  description: "Mark the version in which a field was introduced",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const removedMacro = defineAttributeMacro({
  name: "removed",
  module: "@typesugar/codec",
  description: "Mark the version in which a field was removed",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const renamedMacro = defineAttributeMacro({
  name: "renamed",
  module: "@typesugar/codec",
  description: "Mark that a field was renamed from an older name at a given version",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});

export const defaultValueMacro = defineAttributeMacro({
  name: "defaultValue",
  module: "@typesugar/codec",
  description: "Provide a default value for decoding older versions",
  validTargets: ["property"],
  expand(_ctx, _decorator, target, _args) {
    return target;
  },
});
