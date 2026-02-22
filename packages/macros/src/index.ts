/**
 * @typesugar/macros - Built-in Macros
 *
 * This module exports all built-in macros and ensures they're registered
 * with the global registry when imported.
 */

// Import to register all built-in macros
import "./comptime.js";
import "./derive.js";
import "./operators.js";
import "./reflect.js";
import "./typeclass.js";
import "./specialize.js";
import "./implicit.js";
import "./implicits.js"; // @implicits decorator with automatic propagation
import "./coverage.js"; // Coverage checking - must load before primitives
import "./primitives.js"; // Primitive typeclass instances for derivation
import "./generic.js"; // Generic programming (Product/Sum) for structural derivation
import "./auto-derive.js"; // Scala 3-style typeclass derivation via Mirror/Generic
import "./static-assert.js";
import "./cfg.js";
import "./config-when.js";
import "./include.js";
import "./module-graph.js";
import "./tailrec.js";
import "./hkt.js"; // Higher-Kinded Type F<_> syntax support
import "./verify-laws.js"; // Typeclass law verification
import "./extension.js"; // Standalone extension methods for concrete types

// --- Testing macros ---
// NOTE: @typesugar/testing/macros is NOT imported here to avoid duplicate
// registration of typeInfo macro. Import it separately when needed.

// Re-export for programmatic use
export { comptimeMacro, jsToComptimeValue, type ComptimePermissions } from "./comptime.js";
export {
  EqDerive,
  OrdDerive,
  CloneDerive,
  DebugDerive,
  HashDerive,
  DefaultDerive,
  JsonDerive,
  BuilderDerive,
  TypeGuardDerive,
  // Derive name symbols for use in @derive() decorators
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  Builder,
  TypeGuard,
  // Additional exports for testing
  deriveMacros,
  createDerivedFunctionName,
} from "./derive.js";
export {
  operatorsAttribute,
  opsMacro,
  pipeMacro,
  composeMacro,
  registerOperators,
  getOperatorMethod,
  getOperatorString,
  clearOperatorMappings,
} from "./operators.js";
export {
  reflectAttribute,
  typeInfoMacro,
  fieldNamesMacro,
  validatorMacro,
  type TypeInfo,
  type FieldInfo,
  type MethodInfo,
  type ParameterInfo,
  type ValidationResult,
} from "./reflect.js";
export {
  typeclassAttribute,
  instanceAttribute,
  derivingAttribute,
  summonMacro,
  extendMacro,
  typeclassRegistry,
  instanceRegistry,
  extensionMethodRegistry,
  builtinDerivations,
  findInstance,
  getTypeclass,
  findExtensionMethod,
  getExtensionMethodsForType,
  getAllExtensionMethods,
  registerExtensionMethods,
  clearRegistries,
  getTypeclasses,
  getInstances,
  instanceVarName,
  createTypeclassDeriveMacro,
  generateStandardTypeclasses,
  tryExtractSumType,
  syntaxRegistry,
  getSyntaxForOperator,
  registerTypeclassSyntax,
  clearSyntaxRegistry,
  extractOpFromReturnType,
  registerTypeclassDef,
  registerInstanceWithMeta,
  getInstanceMeta,
  getFlatMapMethodNames,
  registerParCombineBuilder,
  getParCombineBuilderFromRegistry,
  hasFlatMapInstance,
  hasParCombineInstance,
  parCombineBuilderRegistry,
  type TypeclassInfo,
  type TypeclassMethod,
  type InstanceInfo,
  type InstanceMeta,
  type ExtensionMethodInfo,
  type BuiltinTypeclassDerivation,
  type SyntaxEntry,
  type ParCombineBuilder,
} from "./typeclass.js";
export {
  specializeMacro,
  specializeInlineMacro,
  monoMacro,
  inlineCallMacro,
  registerInstanceMethods,
  getInstanceMethods,
  isRegisteredInstance,
  classifyInlineFailure,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  inlineMethod,
  createSpecializedFunction,
  flattenReturnsToExpression,
  analyzeForFlattening,
  canFlattenToExpression,
  SpecializationCache,
  createHoistedSpecialization,
  getResultAlgebra,
  hasResultAlgebra,
  getAllResultAlgebras,
  registerResultAlgebra,
  optionResultAlgebra,
  eitherResultAlgebra,
  promiseResultAlgebra,
  unsafeResultAlgebra,
  type ResultAlgebra,
  type DictMethodMap,
  type DictMethod,
  type InlineFailureReason,
  type InlineClassification,
  type FlattenAnalysis,
  type SpecializeOptions,
} from "./specialize.js";
export {
  summonHKTMacro,
  deriveMacro as deriveHKTMacro,
  deriveMacro,
  implicitMacro,
  registerInstance as registerHKTInstance,
  registerInstance,
  lookupInstance as lookupHKTInstance,
  lookupInstance,
} from "./implicit.js";

// --- @implicits decorator with automatic propagation ---
export {
  implicitsAttribute,
  summonAllMacro,
  resolveImplicit,
  registerImplicitsFunction,
  getImplicitsFunction,
  transformImplicitsCall,
  buildImplicitScope,
  implicitsFunctions,
  type ImplicitParamInfo,
  type ImplicitsFunctionInfo,
  type ImplicitScope,
} from "./implicits.js";

// --- Coverage checking for derivation ---
export {
  registerPrimitive,
  hasPrimitive,
  getPrimitivesFor,
  checkCoverage,
  validateCoverageOrError,
  configureCoverage,
  getCoverageConfig,
  type CoverageConfig,
  type CoverageResult,
  type FieldInfo as CoverageFieldInfo,
} from "./coverage.js";

// --- Generic programming (Product/Sum) ---
export {
  type Product,
  type Sum,
  type Field,
  type Variant,
  type Generic,
  type Rep,
  type GenericMeta,
  genericDerive,
  registerGeneric,
  getGeneric,
  getGenericMeta,
  registerGenericMeta,
  showProduct,
  showSum,
  eqProduct,
  eqSum,
  ordProduct,
  hashProduct,
  deriveShowViaGeneric,
  deriveEqViaGeneric,
} from "./generic.js";

// --- Scala 3-style typeclass derivation via Mirror/Generic ---
export {
  type GenericDerivation,
  type DerivationResult,
  registerGenericDerivation,
  getGenericDerivation,
  hasGenericDerivation,
  tryDeriveViaGeneric,
  canDeriveViaGeneric,
  clearDerivationCaches,
  makePrimitiveChecker,
} from "./auto-derive.js";

// --- Primitive typeclass instances ---
export {
  // Show
  showNumber,
  showString,
  showBoolean,
  showBigint,
  showArray,
  // Eq
  eqNumber,
  eqString,
  eqBoolean,
  eqBigint,
  eqArray,
  // Ord
  ordNumber,
  ordString,
  ordBoolean,
  ordBigint,
  ordArray,
  // Hash
  hashNumber,
  hashString,
  hashBoolean,
  hashBigint,
  hashArray,
  // Semigroup
  semigroupNumber,
  semigroupString,
  semigroupArray,
  // Monoid
  monoidNumber,
  monoidString,
  monoidArray,
  // Grouped exports
  Show as ShowPrimitives,
  Eq as EqPrimitives,
  Ord as OrdPrimitives,
  Hash as HashPrimitives,
  Semigroup as SemigroupPrimitives,
  Monoid as MonoidPrimitives,
} from "./primitives.js";

// --- Phase 1.1: Quasiquoting ---
export {
  quote,
  quoteStatements,
  quoteType,
  quoteBlock,
  quoteCall,
  quotePropAccess,
  quoteMethodCall,
  quoteConst,
  quoteLet,
  quoteReturn,
  quoteIf,
  quoteArrow,
  quoteFunction,
  ident,
  raw,
  spread,
  SpreadSplice,
  IdentSplice,
  RawSplice,
  type QuoteSplice,
} from "./quote.js";

// --- Phase 1.2: Pattern-based macros ---
export {
  defineSyntaxMacro,
  defineRewrite,
  type PatternCapture,
  type PatternArm,
  type SyntaxMacroOptions,
} from "./syntax-macro.js";

// --- Phase 1.3: Simplified custom derive ---
export {
  defineCustomDerive,
  defineCustomDeriveAst,
  defineFieldDerive,
  defineTypeFunctionDerive,
  type SimpleFieldInfo,
  type SimpleTypeInfo,
} from "./custom-derive.js";

// --- Phase 2.1: Compile-time file I/O ---
export {
  includeStrMacro,
  includeBytesMacro,
  includeJsonMacro,
  getFileDependencies,
  clearFileDependencies,
} from "./include.js";

// --- Phase 2.2: Conditional compilation ---
export { cfgMacro, cfgAttrMacro, setCfgConfig, getCfgConfig, evaluateCfgCondition } from "./cfg.js";

// --- Phase 2.3: Module-graph reflection ---
export { collectTypesMacro, moduleIndexMacro } from "./module-graph.js";

// --- Phase 3.2: Enhanced diagnostics ---
export { staticAssertMacro, compileErrorMacro, compileWarningMacro } from "./static-assert.js";

// --- Tail-call optimization ---
export { tailrecAttribute } from "./tailrec.js";

// --- Typeclass law verification ---
export { verifyLawsAttribute, getVerifyLawsConfig } from "./verify-laws.js";

// --- Standalone extension methods for concrete types ---
export {
  registerExtensionsMacro,
  registerExtensionMacro,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
  standaloneExtensionRegistry,
  type StandaloneExtensionInfo,
} from "./extension.js";

// --- Higher-Kinded Types (part of typeclass system) ---
// HKT enables typeclasses parameterized by type constructors (F[_]).
// Use @instance("Monad<Option>") for HKT typeclass instances.

// From typeclass.ts - canonical HKT registration
export {
  registerHKTExpansion,
  registerHKTTypeclass,
  hktExpansionRegistry,
  hktTypeclassNames,
} from "./typeclass.js";

// From hkt.ts - type-level utilities only
export {
  hktAttribute,
  transformHKTDeclaration,
  isKindAnnotation,
  getKindArity,
  kindParamRegistry,
  type KindParamInfo,
} from "./hkt.js";

// --- Testing macros ---
// NOTE: Testing macros (powerAssertMacro, comptimeAssertMacro, etc.) are
// available from @typesugar/testing/macros but are NOT re-exported here
// to avoid duplicate registration of the typeInfo macro.

// ============================================================================
// Runtime Stubs
// ============================================================================
// These are placeholder functions that the transformer replaces at compile time.
// They provide type information and give meaningful errors if transformer isn't configured.

export {
  // Typeclass stubs
  typeclass,
  instance,
  deriving,
  summon,
  extend,
  // Extension registration stubs
  registerExtensions,
  registerExtension,
  // Comptime stub
  comptime,
  // Derive stub
  derive,
  // Operator stubs
  operators,
  ops,
  pipe,
  compose,
  flow,
  // Specialize stubs
  specialize,
  mono,
  inlineCall,
  // Reflect stubs
  reflect,
  typeInfo,
  fieldNames,
  validator,
  // Conditional compilation
  cfg,
  // File include stubs
  includeStr,
  includeJson,
  // Static assert
  static_assert,
  // Tail recursion
  tailrec,
  // HKT
  hkt,
} from "./runtime-stubs.js";
