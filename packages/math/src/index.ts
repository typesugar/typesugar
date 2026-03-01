/**
 * @typesugar/math — Comprehensive Math Types and Typeclasses
 *
 * This package provides:
 * - **Numeric types**: Rational, Complex, BigDecimal, Matrix, Interval, Mod, Polynomial
 * - **Typeclasses**: VectorSpace, InnerProduct, Normed
 * - **Bridge modules**: Integration with @typesugar/units
 *
 * All types implement the standard typeclasses from @typesugar/std (Numeric, Fractional, etc.)
 * with Op<> operator support.
 *
 * @example
 * ```typescript
 * import { rational, complex, matrix, interval } from "@typesugar/math";
 *
 * // Exact rational arithmetic
 * const half = rational(1n, 2n);
 * const third = rational(1n, 3n);
 * const sum = numericRational.add(half, third); // 5/6
 *
 * // Complex numbers
 * const z = complex(3, 4); // 3 + 4i
 * magnitude(z); // 5
 *
 * // Type-safe matrices
 * const m = matrix(2, 2, [1, 2, 3, 4]);
 * det(m); // -2
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Typeclasses (linear algebra abstractions)
// ============================================================================

export {
  // Typeclasses
  type VectorSpace,
  type InnerProduct,
  type Normed,
  // Instances
  vectorSpaceArray,
  innerProductArray,
  normedNumberArray,
  // Derived operations
  vSub,
  normSquared,
  normalize,
  distance,
  isOrthogonal,
  project,
} from "./typeclasses/index.js";

// ============================================================================
// Rational Numbers
// ============================================================================

export {
  // Type
  type Rational,
  // Constructors
  rational,
  rat,
  fromNumber as rationalFromNumber,
  // Typeclass instances
  numericRational,
  fractionalRational,
  ordRational,
  // Operations
  toNumber as rationalToNumber,
  toString as rationalToString,
  isInteger as rationalIsInteger,
  equals as rationalEquals,
  isZero as rationalIsZero,
  isPositive as rationalIsPositive,
  isNegative as rationalIsNegative,
  floor as rationalFloor,
  ceil as rationalCeil,
  trunc as rationalTrunc,
  pow as rationalPow,
} from "./types/rational.js";

// ============================================================================
// Complex Numbers
// ============================================================================

export {
  // Type
  type Complex,
  // Constructors
  complex,
  fromPolar,
  // Constants
  I,
  ONE as COMPLEX_ONE,
  ZERO as COMPLEX_ZERO,
  // Typeclass instances
  numericComplex,
  fractionalComplex,
  floatingComplex,
  // Operations
  conjugate,
  magnitude as complexMagnitude,
  phase,
  toPolar,
  equals as complexEquals,
  isReal,
  isImaginary,
  isZero as complexIsZero,
  toString as complexToString,
  rootsOfUnity,
  nthRoots,
} from "./types/complex.js";

// ============================================================================
// BigDecimal (Arbitrary Precision)
// ============================================================================

export {
  // Type
  type BigDecimal,
  // Constructors
  bigDecimal,
  fromString as bigDecimalFromString,
  // Constants
  ZERO as BIGDECIMAL_ZERO,
  ONE as BIGDECIMAL_ONE,
  TEN as BIGDECIMAL_TEN,
  // Typeclass instances
  numericBigDecimal,
  ordBigDecimal,
  // Operations
  toNumber as bigDecimalToNumber,
  toFixed,
  toString as bigDecimalToString,
  round as bigDecimalRound,
  divWithScale,
  equals as bigDecimalEquals,
  isZero as bigDecimalIsZero,
  isPositive as bigDecimalIsPositive,
  isNegative as bigDecimalIsNegative,
  isInteger as bigDecimalIsInteger,
  integerPart,
  fractionalPart,
  pow as bigDecimalPow,
  compareMagnitude,
  min as bigDecimalMin,
  max as bigDecimalMax,
} from "./types/bigdecimal.js";

// ============================================================================
// Rounding
// ============================================================================

export {
  type RoundingMode,
  DEFAULT_ROUNDING_MODE,
  roundBigInt,
  roundNumber,
  isValidRoundingMode,
} from "./types/rounding.js";

// ============================================================================
// FixedDecimal (Fixed-Point with Compile-Time Scale)
// ============================================================================

export {
  // Type
  type FixedDecimal,
  type FixedDecimalConfig,
  // Constructors
  fixed,
  fixedZero,
  fixedOne,
  // Typeclass instances
  fixedNumeric,
  fixedIntegral,
  fixedEq,
  fixedOrd,
  // Pre-configured instances
  fixedNumeric2,
  fixedNumeric4,
  fixedNumeric6,
  fixedNumeric8,
  fixedIntegral2,
  fixedIntegral4,
  // Operations
  fixedAdd,
  fixedSub,
  fixedMul,
  fixedDiv,
  fixedQuot,
  fixedMod,
  fixedNegate,
  fixedAbs,
  fixedSignum,
  fixedScale,
  fixedMin,
  fixedMax,
  fixedClamp,
  // Conversions
  fixedToNumber,
  fixedToString,
  fixedFormat,
  fixedRound,
  fixedRescale,
  // Queries
  fixedCompare,
  fixedEquals,
  fixedIsZero,
  fixedIsPositive,
  fixedIsNegative,
} from "./types/fixed-decimal.js";

// ============================================================================
// Currencies (ISO 4217)
// ============================================================================

export {
  // Type
  type CurrencyDef,
  type CurrencyCode,
  // Major currencies
  USD,
  EUR,
  GBP,
  JPY,
  CNY,
  CHF,
  CAD,
  AUD,
  NZD,
  HKD,
  SGD,
  // European
  SEK,
  NOK,
  DKK,
  PLN,
  CZK,
  HUF,
  RUB,
  // Asian
  KRW,
  INR,
  THB,
  MYR,
  IDR,
  PHP,
  VND,
  TWD,
  // Americas
  MXN,
  BRL,
  ARS,
  CLP,
  COP,
  // Middle East & Africa
  AED,
  SAR,
  ILS,
  TRY,
  ZAR,
  EGP,
  KWD,
  BHD,
  OMR,
  // Precious metals
  XAU,
  XAG,
  XPT,
  XPD,
  // Crypto
  BTC,
  ETH,
  // Utilities
  ALL_CURRENCIES,
  CURRENCY_MAP,
  getCurrency,
  currencyScaleFactor,
} from "./types/currencies.js";

// ============================================================================
// Money (Type-Safe Currency)
// ============================================================================

export {
  // Type
  type Money,
  // Constructors
  money,
  moneyFromMajor,
  moneyZero,
  // Typeclass instances
  moneyNumeric,
  moneyEq,
  moneyOrd,
  // Operations
  moneyAdd,
  moneySub,
  moneyNegate,
  moneyAbs,
  moneyScale,
  moneyDivide,
  moneyMin,
  moneyMax,
  moneySum,
  moneyPercentage,
  moneyAddPercentage,
  // Allocation
  moneyAllocate,
  moneySplit,
  // Conversion
  moneyConvert,
  moneyMinorUnits,
  moneyToMajor,
  // Formatting
  moneyFormat,
  moneyToString,
  // Queries
  moneyCompare,
  moneyEquals,
  moneyIsZero,
  moneyIsPositive,
  moneyIsNegative,
} from "./types/money.js";

// ============================================================================
// Type Conversions
// ============================================================================

export {
  // Rational conversions
  rationalToBigDecimal,
  rationalToFixed,
  rationalToMoney,
  // BigDecimal conversions
  bigDecimalToRational,
  bigDecimalToFixed,
  bigDecimalToMoney,
  // FixedDecimal conversions
  fixedToRational,
  fixedToBigDecimal,
  fixedToMoney,
  // Money conversions
  moneyToRational,
  moneyToBigDecimal,
  moneyToFixed,
  // Number conversions
  numberToRational,
  numberToBigDecimal,
  numberToFixed,
  numberToMoney,
} from "./types/conversions.js";

// ============================================================================
// Matrix (Type-Safe Dimensions)
// ============================================================================

export {
  // Types
  type Matrix,
  type Rows,
  type Cols,
  // Constructors
  matrix,
  zeros,
  identity,
  fromRows,
  diag,
  // Dimension access
  rows,
  cols,
  // Element access
  get,
  set,
  row,
  col,
  // Operations
  transpose,
  matMul,
  add as matrixAdd,
  sub as matrixSub,
  scale as matrixScale,
  negate as matrixNegate,
  // Square matrix operations
  trace,
  det,
  inverse as matrixInverse,
  // Typeclass instance
  numericMatrix,
  // Utilities
  approxEquals as matrixApproxEquals,
  toArray,
  toString as matrixToString,
} from "./types/matrix.js";

// ============================================================================
// Interval (Bounds Tracking)
// ============================================================================

export {
  // Type
  type Interval,
  // Constructors
  interval,
  point as intervalPoint,
  entire,
  empty,
  // Queries
  isEmpty as isIntervalEmpty,
  isPoint,
  contains,
  containsInterval,
  overlaps,
  width,
  midpoint as intervalMidpoint,
  radius,
  magnitude as intervalMagnitude,
  mignitude,
  // Set operations
  hull,
  intersect,
  // Arithmetic
  add as intervalAdd,
  sub as intervalSub,
  mul as intervalMul,
  div as intervalDiv,
  negate as intervalNegate,
  abs as intervalAbs,
  square,
  sqrt as intervalSqrt,
  pow as intervalPow,
  // Typeclass instances
  numericInterval,
  ordInterval,
  // Utilities
  equals as intervalEquals,
  approxEquals as intervalApproxEquals,
  toString as intervalToString,
  widen,
  narrow,
} from "./types/interval.js";

// ============================================================================
// Modular Arithmetic (Z/nZ)
// ============================================================================

export {
  // Type
  type Mod,
  // Constructors
  mod,
  zero as modZero,
  one as modOne,
  // Operations
  modAdd,
  modSub,
  modMul,
  modNegate,
  modPow,
  modInverse,
  modDiv,
  // Number theory
  isPrime,
  gcd,
  coprime,
  totient,
  crt,
  units as modUnits,
  // Typeclass instances
  numericMod,
  integralMod,
  fractionalMod,
  // Utilities
  equals as modEquals,
  toString as modToString,
} from "./types/modular.js";

// ============================================================================
// Polynomial (Polynomial Ring F[x])
// ============================================================================

export {
  // Type
  type Polynomial,
  // Constructors
  polynomial,
  constant,
  monomial,
  zeroPoly,
  onePoly,
  xPoly,
  // Queries
  degree,
  isZero as isZeroPoly,
  leading,
  coeff,
  // Evaluation
  evaluate,
  // Arithmetic
  addPoly,
  subPoly,
  mulPoly,
  negatePoly,
  scalePoly,
  divPoly,
  gcdPoly,
  // Calculus
  derivative,
  integral as polyIntegral,
  nthDerivative,
  // Root finding
  rationalRoots,
  // Typeclass instance
  numericPolynomial,
  // Utilities
  equals as polyEquals,
  toString as polyToString,
  compose as composePoly,
} from "./types/polynomial.js";

// ============================================================================
// Bridge Modules
// ============================================================================

export {
  // Units bridge
  unitToRational,
  rationalToUnit,
  unitToRationalPrecise,
  scaleByRational,
} from "./bridge/index.js";

// ============================================================================
// Re-exports from @typesugar/units
// ============================================================================

export {
  // Dimension types
  type Dimensions,
  type DimExp,
  type Dimensionless,
  type Mass,
  type Length,
  type Time,
  type Current,
  type Temperature,
  type Area,
  type Volume,
  type Velocity,
  type Acceleration,
  type Force,
  type Energy,
  type Power,
  type Pressure,
  type Frequency,
  type Voltage,
  type Resistance,
  type MulDimensions,
  type DivDimensions,
  // Unit class
  Unit,
  // Length constructors
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,
  // Mass constructors
  kilograms,
  grams,
  milligrams,
  pounds,
  // Time constructors
  seconds,
  minutes,
  hours,
  days,
  milliseconds,
  // Velocity constructors
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,
  // Acceleration
  metersPerSecondSquared,
  // Force
  newtons,
  // Energy
  joules,
  kilojoules,
  calories,
  kilocalories,
  // Power
  watts,
  kilowatts,
  // Temperature
  kelvin,
  celsius,
  // Pressure
  pascals,
  kilopascals,
  atmospheres,
  // Tagged template
  units,
} from "@typesugar/units";
