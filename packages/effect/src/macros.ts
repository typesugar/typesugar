/**
 * @typesugar/effect — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` (transitively, via the macro/derive modules)
 * and is loaded by the transformer at build time through the `./macros` subpath.
 * It must NOT be imported by application runtime code — the runtime placeholders,
 * typeclass instances and helpers live in the package's `.` entry. See PEP-050.
 *
 * Provides the macro definitions and compile-time utilities for `@service`,
 * `@layer`, `resolveLayer<R>()`, `layerMake<R>()`, `@compiled`/`compileGen()`,
 * `@fused`/`fusePipeline()`, `specializeSchema()` and the `@derive` macros for
 * Effect Schema/Equal/Hash, plus the FlatMap instance registration that powers
 * @typesugar/std's `let:/yield:` do-notation for Effect.
 *
 * @module
 */

import { globalRegistry } from "@typesugar/core";

// Importing the runtime entry registers the Effect `FlatMap` instance as a side
// effect (so @typesugar/std's let:/yield: do-notation can expand for Effect when
// the transformer loads this `./macros` entry at build time).
import "./index.js";

// Macro definitions (these import `typescript`).
import { serviceAttribute } from "./macros/service.js";
import { layerAttribute } from "./macros/layer.js";
import { resolveLayerMacro } from "./macros/resolve-layer.js";
import { layerMakeMacro } from "./macros/layer-make.js";
import { compiledAttribute, compileGenExpression } from "./macros/compiled.js";
import { fusedAttribute, fusePipelineExpression } from "./macros/fused.js";
import {
  specializeSchemaExpression,
  specializeSchemaUnsafeExpression,
} from "./macros/schema-specialize.js";
import { EffectSchemaDerive } from "./derive/schema.js";
import { EffectEqualDerive } from "./derive/equal.js";
import { EffectHashDerive } from "./derive/hash.js";

// Re-export the macro definitions, registries and compile-time utilities so the
// build-time entry exposes the full macro surface (attributes, expression macros,
// derive macros, the service/layer registries and the layer-graph helpers).
export * from "./macros/index.js";
export * from "./derive/index.js";

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all Effect adapter macros with the global registry. Called as a
 * side effect on import so the transformer's macro-loader picks them up.
 */
export function register(): void {
  // The Effect FlatMap instance (enables let:/yield: from @typesugar/std) is
  // registered as a side effect of importing the runtime `./index.js` entry above.

  // Register @service and @layer attribute macros
  globalRegistry.register(serviceAttribute);
  globalRegistry.register(layerAttribute);

  // Register resolveLayer<R>() expression macro
  globalRegistry.register(resolveLayerMacro);

  // Register layerMake<R>() expression macro (ZIO-style explicit wiring)
  globalRegistry.register(layerMakeMacro);

  // Register @compiled attribute and compileGen() expression macros
  globalRegistry.register(compiledAttribute);
  globalRegistry.register(compileGenExpression);

  // Register @fused attribute and fusePipeline() expression macros
  globalRegistry.register(fusedAttribute);
  globalRegistry.register(fusePipelineExpression);

  // Register schema specialization expression macros
  globalRegistry.register(specializeSchemaExpression);
  globalRegistry.register(specializeSchemaUnsafeExpression);

  // Register @derive macros for Effect Schema, Equal, Hash
  globalRegistry.register(EffectSchemaDerive);
  globalRegistry.register(EffectEqualDerive);
  globalRegistry.register(EffectHashDerive);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
