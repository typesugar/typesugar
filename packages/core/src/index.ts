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
export {
  config,
  defineConfig,
  type TypesugarConfig,
  type ContractsConfig,
  type SecurityConfig,
  type ConfigSnapshot,
} from "./config.js";
export { ConfigConditionError, evaluateConfigCondition } from "./config-condition.js";

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
  StandaloneExtensionInfo,
} from "./types.js";

// Standalone extension utilities
export {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  findStandaloneExtensions,
  withStandaloneExtensionFile,
  clearStandaloneExtensionsForFile,
  type StandaloneExtensionEntry,
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

// TypeScript-major guard (PEP-060 item 1): every host calls this once before
// its first compiler-API access, so TypeScript 7 fails with one clear message.
export {
  assertSupportedTypeScript,
  getUnsupportedTypeScriptReason,
  UnsupportedTypeScriptError,
  SUPPORTED_TYPESCRIPT_RANGE,
  TYPESCRIPT_SUPPORT_URL,
} from "./typescript-version.js";

// Resolution Scope Tracking
export {
  globalResolutionScope,
  scanImportsForScope,
  hasInlineOptOut,
  isInOptedOutScope,
  ResolutionScopeTracker,
  type FileResolutionScope,
} from "./resolution-scope.js";

// Syntax Marker Fallback (PEP-052 Wave 6)
// `clearSyntaxMarkerFallbackRegistry` is deliberately NOT re-exported here:
// it is test-only (see its doc comment), and clearing it in a process that
// already loaded a provider's registrations (std, fp) would permanently
// deactivate their fallbacks — those registrations run once, at module load,
// and never rerun. Internal tests import it directly from
// `./syntax-marker-fallback.js`.
export {
  registerSyntaxMarkerFallback,
  getSyntaxMarkerFallback,
  findSyntaxMarkerSpecifiers,
  type SyntaxMarkerFallbackEntry,
} from "./syntax-marker-fallback.js";

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

export { getOrCreateWeak } from "./weak-cache.js";

// AST Utilities
export {
  hasExportModifier,
  stripDecorator,
  isSyntheticNode,
  hasSourceText,
  stripPositions,
  stripCommentsDeep,
  cloneWithoutPositions,
  cloneWithoutComments,
  cloneNodeDeep,
  forEachDescendant,
  jsValueToExpression,
  numberToExpression,
  bigintToExpression,
  getPrinter,
  getDummySourceFile,
  printNode,
  splitTopLevel,
  findMatchingParen,
  getNestedValue,
  evaluateConditionExpr,
  createRemoveExpression,
  isRemoveExpression,
  getRemoveComment,
  isJSDocTagAtLineStart,
  deriveTagNames,
  parseDeriveList,
  opaqueTypesAsUnderlying,
  type JsValueContext,
} from "./ast-utils.js";

// Receiver vs. an extension function's first parameter (transformer + suppression)
export { receiverMatchesFirstParam } from "./extension-receiver.js";

// Type String Utilities (pure string, no TS dependency)
export {
  extractTypeArgumentsContent,
  stripTypeArguments,
  splitTopLevelTypeArgs,
  parseTypeInstantiation,
} from "./type-string-utils.js";

// Hygiene System
export {
  HygieneContext,
  globalHygiene,
  FileBindingCache,
  KNOWN_GLOBALS,
  type PendingAliasEntry,
  type ImportBinding,
  type ImportBindingKind,
} from "./hygiene.js";

// Re-export markPure and CreateMacroContextOptions from context
export { markPure, type CreateMacroContextOptions } from "./context.js";

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

// Diagnostic Suppression Rules
export {
  registerDiagnosticSuppressionRule,
  registerDiagnosticSuppressionRuleOnce,
  registerOrReplaceDiagnosticSuppressionRule,
  clearDiagnosticSuppressionRules,
  getDiagnosticSuppressionRules,
  getDiagnosticSuppressionAuditLog,
  clearDiagnosticSuppressionAuditLog,
  evaluateDiagnosticSuppression,
  filterDiagnostics,
  isDiagnosticSuppressionAuditEnabled,
  setDiagnosticSuppressionAuditMode,
  type DiagnosticSuppressionRule,
  type DiagnosticSuppressionContext,
  type DiagnosticSuppressionAuditEntry,
  type DiagnosticSuppressionEvalResult,
} from "./diagnostic-suppression.js";

// Built-in diagnostic suppression rules
export { createMacroGeneratedRule, type PositionMapFn } from "./diagnostic-suppression-rules.js";

// Type Rewrite Registry (populated by @opaque in PEP-012)
export {
  registerTypeRewrite,
  getTypeRewrite,
  hasTypeRewrite,
  getAllTypeRewrites,
  clearTypeRewrites,
  findTypeRewrite,
  getTypeRewritesByModule,
  getTypeRewriteBySymbol,
  typeRewriteEntryCoversFile,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type AccessorRewrite,
  type MethodInlinePattern,
} from "./type-rewrite-registry.js";

// A type as a type node a given file can contain (declaration annotations,
// match()'s scrutinee assertion)
export {
  typeToPortableTypeNode,
  portableTypeNode,
  PORTABLE_NODE_BUILDER_FLAGS,
  sourceSpecifierExtension,
  relativeImportStyleOf,
  type RelativeImportStyle,
} from "./portable-type-node.js";

// Performance profiling (moved from @typesugar/transformer in PEP-056 Wave 3 --
// shared by both the CLI/legacy pipeline and transformer-core, not just one)
export {
  profiler,
  PROFILING_ENABLED,
  type FileTimings,
  type AggregatedStats,
} from "./profiling.js";
