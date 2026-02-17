/**
 * Advanced Type System Extensions
 *
 * This module provides compile-time macros that extend TypeScript's type system
 * with features from the "too hard basket" — things the TypeScript team has
 * considered but deemed too complex to add to the language itself.
 *
 * ## Features
 *
 * 1. **Type-Level Utilities** — Boolean algebra for types
 *    (Equal, Extends, Not, And, Or, IsNever, IsAny, IsUnknown)
 *
 * 2. **Higher-Kinded Types (HKT)** — Type constructors as type parameters
 *    via indexed-access encoding (`$<F, A>`, zero-cost, no registry)
 *
 * 3. **Existential Types** — "There exists some type T" with CPS encoding
 *    (heterogeneous collections, type-safe plugins)
 *
 * 4. **Refinement Types** — Types with predicates (Byte, Port, NonEmpty, Email)
 *    with compile-time validation for literals
 *
 * 5. **Newtype (Zero-Cost Branding)** — Branded types that compile away
 *    (UserId, Meters, Seconds — type discrimination without runtime cost)
 *
 * 6. **Opaque Type Modules** — ML-style abstract types with controlled access
 *    (smart constructors, module-scoped operations)
 *
 * 7. **Type-Level Arithmetic** — Compile-time numeric computation
 *    (Add, Sub, Mul, Div, Mod, Pow, comparisons)
 *
 * 8. **Phantom Type State Machines** — Encode state machines in the type system
 *    (type-safe builders, protocol types, session types)
 *
 * 9. **Effect System Annotations** — Compile-time side-effect tracking
 *    (@pure, @effect("io"), effect propagation checking)
 *
 * ## The Branding Spectrum
 *
 * This module provides three levels of type branding:
 *
 * - **Newtype** — Pure branding, zero runtime cost. Use for type discrimination.
 * - **Opaque** — Module-scoped access. Use to hide representation details.
 * - **Refined** — Runtime validation. Use when values must satisfy invariants.
 */

// Type-Level Boolean Utilities (canonical definitions)
export {
  type Equal,
  type Extends,
  type Not,
  type And,
  type Or,
  type IsNever,
  type IsAny,
  type IsUnknown,
  type Equals, // deprecated alias
} from "./type-utils.js";

// Higher-Kinded Types (via indexed-access encoding)
export {
  type $,
  type Kind,
  type ArrayF,
  type PromiseF,
  type SetF,
  type ReadonlyArrayF,
  type MapF,
  unsafeCoerce,
  // Legacy compatibility (deprecated)
  type ArrayHKT,
  type PromiseHKT,
} from "./hkt.js";

// Existential Types
export {
  type Exists,
  type ExistsList,
  type ShowWitness,
  type Showable,
  type CompareWitness,
  type Comparable,
  type SerializeWitness,
  type Serializable,
  packExists,
  useExists,
  mapExists,
  forEachExists,
  mapExistsList,
  showable,
  showValue,
  comparable,
  serializable,
  existentialAttribute,
  packExistsMacro,
  useExistsMacro,
} from "./existential.js";

// Refinement Types
export {
  type Refined,
  type BaseOf,
  type Refinement,
  refinement,
  composeRefinements,
  Positive,
  NonNegative,
  Negative,
  Int,
  Byte,
  Port,
  Percentage,
  Finite,
  NonEmpty,
  Trimmed,
  Lowercase,
  Uppercase,
  Email,
  Url,
  Uuid,
  NonEmptyArray,
  MaxLength,
  MinLength,
  refineMacro,
  unsafeRefineMacro,
} from "./refined.js";

// GADTs - REMOVED
// The GADT module was removed because it did not provide type-parameter
// narrowing on match (the core feature of GADTs). See PHILOSOPHY.md.
// A proper GADT implementation is tracked as a future project.

// Type-Level Arithmetic
export {
  addTypeMacro,
  subTypeMacro,
  mulTypeMacro,
  divTypeMacro,
  modTypeMacro,
  powTypeMacro,
  negateTypeMacro,
  absTypeMacro,
  maxTypeMacro,
  minTypeMacro,
  ltTypeMacro,
  lteTypeMacro,
  gtTypeMacro,
  gteTypeMacro,
  eqTypeMacro,
  incTypeMacro,
  decTypeMacro,
  isEvenTypeMacro,
  isOddTypeMacro,
} from "./type-arithmetic.js";

// Newtype (Zero-Cost Branding)
export {
  type Newtype,
  type UnwrapNewtype,
  wrap,
  unwrap,
  newtypeCtor,
  validatedNewtype,
  wrapMacro,
  unwrapMacro,
  newtypeCtorMacro,
} from "./newtype.js";

// Opaque Type Modules
export {
  type Opaque,
  type ReprOf,
  type OpaqueType,
  type OpaqueModule,
  type OpaqueModuleResult,
  opaqueModule,
  PositiveInt,
  NonEmptyString,
  EmailAddress,
  SafeUrl,
  opaqueModuleMacro,
} from "./opaque.js";

// Phantom Type State Machines
export {
  type Phantom,
  type StateOf,
  type DataOf,
  type StateMachineDef,
  type StatesOf,
  type TransitionsIn,
  type TargetState,
  type StateMachineInstance,
  type StateMachineModule,
  type TypedBuilder,
  type Send,
  type Recv,
  type Done,
  type Dual,
  createStateMachine,
  createBuilder,
  transition,
  phantomAttribute,
  stateMachineMacro,
} from "./phantom.js";

// Effect System Annotations
export {
  type EffectKind,
  type EffectAnnotation,
  type Effectful,
  type Pure,
  type IO,
  type Async,
  type EffectsOf,
  type HasEffect,
  type CombineEffects,
  effectRegistry,
  registerPure,
  registerEffect,
  checkEffectCall,
  pure,
  io,
  async_ as async,
  assertPure,
  pureAttribute,
  effectAttribute,
} from "./effects.js";
