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
import "./implicits.js"; // = implicit() parameter resolution + summonAll
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
import "./opaque.js"; // @opaque type macro (PEP-012)

// --- SFINAE rules ---
// NOTE: sfinae-rules.ts is NOT imported as a side-effect module.
// Rules are registered explicitly during transformer/language-service init.
// See createExtensionMethodCallRule() export below.

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
  typeclassMacro,
  // Primary names (preferred)
  implAttribute,
  implMacro,
  // Deprecated aliases for backwards compatibility
  instanceAttribute,
  instanceMacro,
  derivingAttribute,
  summonMacro,
  extendMacro,
  typeclassRegistry,
  instanceRegistry,
  builtinDerivations,
  findInstance,
  getTypeclass,
  clearRegistries,
  registerStandardTypeclasses,
  getTypeclasses,
  getInstances,
  instanceVarName,
  createTypeclassDeriveMacro,
  generateStandardTypeclasses,
  tryExtractSumType,
  getSyntaxForOperator,
  clearSyntaxRegistry, // deprecated, no-op
  updateTypeclassSyntax,
  extractOpFromReturnType,
  extractOpFromJSDoc,
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
  type BuiltinTypeclassDerivation,
  type SyntaxEntry,
  type ParCombineBuilder,
} from "./typeclass.js";
export {
  specializeMacro,
  specializeInlineMacro,
  monoMacro,
  inlineCallMacro,
  // Internal: registerInstanceMethodsFromAST is used by @impl macro, not public API
  registerInstanceMethodsFromAST,
  extractMethodsFromObjectLiteral,
  getInstanceMethods,
  isRegisteredInstance,
  getRegisteredInstanceNames,
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
// --- Implicit parameter resolution (= implicit() default pattern) ---
export {
  summonAllMacro,
  resolveImplicit,
  isImplicitDefault,
  hasImplicitParams,
  getImplicitParamIndices,
  buildImplicitScopeFromDecl,
  transformImplicitsCall,
  isRegisteredTypeclass,
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
  extensionAttribute,
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

// --- Opaque type macro (PEP-012) ---
export { opaqueAttribute } from "./opaque.js";

// --- SFINAE Rules ---
export {
  createExtensionMethodCallRule,
  createNewtypeAssignmentRule,
  createTypeRewriteAssignmentRule,
} from "./sfinae-rules.js";

// --- Higher-Kinded Types (part of typeclass system) ---
// HKT enables typeclasses parameterized by type constructors (F<_>).
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
  // Extension method decorator
  extension,
  // Extension registration stubs (deprecated, use @extension instead)
  registerExtensions,
  registerExtension,
  // Implicit parameter resolution stub
  implicit,
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
  staticAssert,
  // Tail recursion
  tailrec,
  // HKT
  hkt,
} from "./runtime-stubs.js";

// ============================================================================
// Deprecated APIs (backwards compatibility)
// ============================================================================
import { updateTypeclassSyntax as _updateTypeclassSyntax } from "./typeclass.js";

let _deprecationWarningShown = false;

/**
 * @deprecated Use @op annotations on typeclass method signatures instead.
 * This function is provided for backwards compatibility only.
 *
 * @param tcName - Typeclass name
 * @param syntax - Operator to method name mappings
 * @param _internal - If true, suppress deprecation warning (for internal transformer use)
 */
export function registerTypeclassSyntax(
  tcName: string,
  syntax: Map<string, string>,
  _internal?: boolean
): void {
  if (!_internal && !_deprecationWarningShown) {
    console.warn(
      `[typesugar] DEPRECATION WARNING: registerTypeclassSyntax() is deprecated.
Use @op JSDoc annotations on typeclass method signatures instead:

  /** @typeclass */
  interface ${tcName}<A> {
    /** @op + */ add(a: A, b: A): A;
  }

See: https://typesugar.dev/guides/typeclasses#operator-syntax`
    );
    _deprecationWarningShown = true;
  }
  _updateTypeclassSyntax(tcName, syntax);
}

// Deprecated: syntaxRegistry is no longer used, syntax is stored in typeclassRegistry.syntax
// Provide empty Map for backwards compatibility with imports
export const syntaxRegistry = new Map<string, unknown>();
