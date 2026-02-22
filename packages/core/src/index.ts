/**
 * Core module exports for @typesugar/core
 *
 * This package provides:
 * - Macro system infrastructure (types, registry, context)
 * - Runtime safety primitives (invariant, unreachable, debugOnly)
 */

export * from "./types.js";
export * from "./registry.js";
export * from "./context.js";

// Macro Capabilities
export {
  resolveCapabilities,
  createRestrictedContext,
  DEFAULT_CAPABILITIES,
  type MacroCapabilities,
} from "./capabilities.js";

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
export { config, defineConfig, type TypesugarConfig, type ContractsConfig } from "./config.js";

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
  DeriveVariantInfo,
  ExtensionMethodInfo,
  ExtensionMethodRegistry,
  StandaloneExtensionInfo,
  OperatorSymbol,
  Op,
} from "./types.js";

// Re-export operator symbols constant
export { OPERATOR_SYMBOLS } from "./types.js";

// Standalone extension utilities
export {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
} from "./registry.js";

// Generic Registry<K, V> abstraction
export {
  createGenericRegistry,
  type GenericRegistry,
  type RegistryOptions,
  type DuplicateStrategy,
} from "./registry.js";

// Diagnostics System
export * from "./diagnostics.js";

// Resolution Scope Tracking
export {
  globalResolutionScope,
  scanImportsForScope,
  hasInlineOptOut,
  isInOptedOutScope,
  ResolutionScopeTracker,
  type FileResolutionScope,
  type ScopedTypeclass,
} from "./resolution-scope.js";

// Prelude System
export {
  DEFAULT_PRELUDE,
  getPreludeTypeclasses,
  getPreludeEntry,
  isPreludeMethod,
  isPreludeOperator,
  generatePreludeDeclaration,
  METHOD_TO_TYPECLASS,
  OPERATOR_TO_TYPECLASS,
  type PreludeEntry,
} from "./prelude.js";

// Resolution Tracing
export {
  globalResolutionTracer,
  ResolutionTracer,
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionKind,
  type ResolutionRecord,
  type FileSummary,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "./resolution-trace.js";

// Coherence Checking
export {
  globalCoherenceChecker,
  CoherenceChecker,
  createInstanceLocation,
  SOURCE_PRIORITY,
  type InstanceSource,
  type InstanceLocation,
  type InstanceConflict,
} from "./coherence.js";

// Library Manifest System
export {
  discoverManifests,
  loadManifest,
  validateManifest,
  createManifestRegistry,
  mergeManifestIntoRegistry,
  getManifestRegistry,
  resetManifestRegistry,
  type LibraryManifest,
  type ManifestTypeclass,
  type ManifestInstance,
  type ManifestExtension,
  type ManifestOperator,
  type ManifestDerive,
  type DiscoveredManifest,
  type ManifestDiscoveryOptions,
  type ManifestRegistry,
} from "./manifest.js";

// Import Suggestions System
export {
  getExportIndex,
  resetExportIndex,
  registerExport,
  getSuggestionsForSymbol,
  getSuggestionsForMethod,
  getSuggestionsForTypeclass,
  getSuggestionsForMacro,
  formatSuggestionsMessage,
  generateImportFix,
  createModuleExportIndex,
  type ModuleExportIndex,
  type ExportedSymbol,
  type ExportKind,
  type ImportSuggestion,
} from "./import-suggestions.js";

// Source Map Utilities
export {
  preserveSourceMap,
  ExpansionTracker,
  globalExpansionTracker,
  type RawSourceMap,
  type ExpansionRecord,
} from "./source-map.js";

// AST Utilities
export {
  stripDecorator,
  stripPositions,
  jsValueToExpression,
  getPrinter,
  getDummySourceFile,
  printNode,
  splitTopLevel,
  findMatchingParen,
  getNestedValue,
  evaluateConditionExpr,
  type JsValueContext,
} from "./ast-utils.js";

// Hygiene System
export { HygieneContext, globalHygiene } from "./hygiene.js";

// Re-export markPure from context
export { markPure } from "./context.js";

// Macro Expansion Cache
export { MacroExpansionCache, InMemoryExpansionCache } from "./cache.js";

// Macro Composition Pipeline
export {
  pipeline,
  parenthesize,
  voidify,
  awaitify,
  assertType,
  debugStep,
  MacroPipeline,
  type PipelineStep,
} from "./pipeline.js";
