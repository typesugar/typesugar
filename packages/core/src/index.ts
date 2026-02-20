/**
 * Core module exports for @ttfx/core
 *
 * This package provides:
 * - Macro system infrastructure (types, registry, context)
 * - Runtime safety primitives (invariant, unreachable, debugOnly)
 */

export * from "./types.js";
export * from "./registry.js";
export * from "./context.js";

// Runtime Safety Primitives
export {
  invariant,
  unreachable,
  debugOnly,
  invariantMacro,
  unreachableMacro,
  debugOnlyMacro,
} from "./safety.js";

// Configuration System
export {
  config,
  defineConfig,
  type TtfxConfig,
  type ContractsConfig,
} from "./config.js";

// Re-export commonly used types for convenience
export type {
  MacroKind,
  MacroContext,
  ComptimeValue,
  MacroDefinition,
  ExpressionMacro,
  AttributeMacro,
  DeriveMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  LabeledBlockMacro,
  MacroRegistry,
  DeriveTypeInfo,
  DeriveFieldInfo,
  ExtensionMethodInfo,
  ExtensionMethodRegistry,
  StandaloneExtensionInfo,
} from "./types.js";

// Standalone extension utilities
export {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
} from "./registry.js";
