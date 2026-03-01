/**
 * Effect Macros
 *
 * Attribute macros for defining Effect services and layers,
 * and optimization macros for zero-cost abstraction.
 *
 * @module
 */

export {
  serviceAttribute,
  service,
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
  type ServiceMethodInfo,
} from "./service.js";

export {
  layerAttribute,
  layer,
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,
} from "./layer.js";

export { resolveLayerMacro, resolveLayer } from "./resolve-layer.js";

export { layerMakeMacro, layerMake } from "./layer-make.js";

export {
  buildDependencyGraph,
  topologicalSort,
  resolveGraph,
  generateLayerComposition,
  formatDebugTree,
  extractServiceNames,
  CircularDependencyError,
  type ResolvedLayer,
  type GraphResolution,
} from "./layer-graph.js";

export { compiledAttribute, compileGenExpression, compileGen, compiled } from "./compiled.js";

export { fusedAttribute, fusePipelineExpression, fusePipeline, fused } from "./fused.js";

export {
  specializeSchemaExpression,
  specializeSchemaUnsafeExpression,
  specializeSchema,
  specializeSchemaUnsafe,
} from "./schema-specialize.js";
