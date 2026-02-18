/**
 * typemacro Built-in Macros
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
import "./static-assert.js";
import "./cfg.js";
import "./include.js";
import "./module-graph.js";
import "./tailrec.js";
import "./hkt.js"; // Higher-Kinded Type F<_> syntax support

// --- Contract macros ---
import "@ttfx/contracts";

// --- Testing macros ---
import "@ttfx/testing/macros";

// Re-export for programmatic use
export { comptimeMacro } from "./comptime.js";
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
} from "./derive.js";
export {
  operatorsAttribute,
  opsMacro,
  pipeMacro,
  composeMacro,
  registerOperators,
  getOperatorMethod,
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
  builtinDerivations,
  findInstance,
  getTypeclass,
  instanceVarName,
  createTypeclassDeriveMacro,
  generateStandardTypeclasses,
  type TypeclassInfo,
  type TypeclassMethod,
  type InstanceInfo,
  type BuiltinTypeclassDerivation,
} from "./typeclass.js";
export {
  specializeMacro,
  specializeInlineMacro,
  registerInstanceMethods,
  getInstanceMethods,
  type DictMethodMap,
  type DictMethod,
} from "./specialize.js";
export {
  summonHKTMacro,
  deriveMacro as deriveHKTMacro,
  implicitMacro,
  registerInstance as registerHKTInstance,
  lookupInstance as lookupHKTInstance,
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
  genericDerive,
  registerGeneric,
  getGeneric,
  showProduct,
  showSum,
  eqProduct,
  eqSum,
  ordProduct,
  hashProduct,
  deriveShowViaGeneric,
  deriveEqViaGeneric,
} from "./generic.js";

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
export {
  cfgMacro,
  cfgAttrMacro,
  setCfgConfig,
  getCfgConfig,
  evaluateCfgCondition,
} from "./cfg.js";

// --- Phase 2.3: Module-graph reflection ---
export { collectTypesMacro, moduleIndexMacro } from "./module-graph.js";

// --- Phase 3.2: Enhanced diagnostics ---
export {
  staticAssertMacro,
  compileErrorMacro,
  compileWarningMacro,
} from "./static-assert.js";

// --- Tail-call optimization ---
export { tailrecAttribute } from "./tailrec.js";

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

// --- Contract macros ---
export {
  requiresMacro,
  ensuresMacro,
  oldMacro,
  contractAttribute,
  invariantAttribute,
  type ContractConfig,
  setContractConfig,
  getContractConfig,
  shouldEmitCheck,
  type ProofResult,
  type ProverPlugin,
  tryProve,
  registerProverPlugin,
} from "@ttfx/contracts";

// --- Testing macros ---
export {
  powerAssertMacro,
  comptimeAssertMacro,
  testCasesAttribute,
  assertSnapshotMacro,
  typeAssertMacro,
  forAllMacro,
  ArbitraryDerive,
} from "@ttfx/testing/macros";
