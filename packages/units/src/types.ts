/**
 * Type-Safe Units Library
 *
 * A compile-time unit system inspired by boost::units.
 * Uses TypeScript's type system to ensure unit correctness at compile time.
 *
 * The key insight is encoding unit dimensions in the type system:
 * - Mass: M
 * - Length: L
 * - Time: T
 * - etc.
 *
 * Each dimension has an exponent. For example:
 * - Velocity = Length / Time = L^1 * T^-1
 * - Acceleration = Velocity / Time = L^1 * T^-2
 * - Force = Mass * Acceleration = M^1 * L^1 * T^-2
 */

// ============================================================================
// Dimension Exponent Types (using type-level integers)
// ============================================================================

// Type-level integers from -5 to 5 (sufficient for most physics)
type N5 = { _tag: "int"; value: -5 };
type N4 = { _tag: "int"; value: -4 };
type N3 = { _tag: "int"; value: -3 };
type N2 = { _tag: "int"; value: -2 };
type N1 = { _tag: "int"; value: -1 };
type Z0 = { _tag: "int"; value: 0 };
type P1 = { _tag: "int"; value: 1 };
type P2 = { _tag: "int"; value: 2 };
type P3 = { _tag: "int"; value: 3 };
type P4 = { _tag: "int"; value: 4 };
type P5 = { _tag: "int"; value: 5 };

/**
 * Result of exponent arithmetic that left the supported -5..5 range. Not a real
 * exponent: a quantity whose dimensions contain it is only compatible with
 * another overflowed quantity, never with a real one (see `AddMap`).
 */
export type DimOverflow = { _tag: "int"; value: "overflow" };

export type DimExp = N5 | N4 | N3 | N2 | N1 | Z0 | P1 | P2 | P3 | P4 | P5 | DimOverflow;

// ============================================================================
// Dimension Type (SI base units)
// ============================================================================

/**
 * Represents the dimensions of a physical quantity.
 * Each property is the exponent of that base dimension.
 */
export interface Dimensions<
  M extends DimExp = Z0, // Mass (kg)
  L extends DimExp = Z0, // Length (m)
  T extends DimExp = Z0, // Time (s)
  I extends DimExp = Z0, // Electric current (A)
  Θ extends DimExp = Z0, // Temperature (K)
  N extends DimExp = Z0, // Amount of substance (mol)
  J extends DimExp = Z0, // Luminous intensity (cd)
> {
  mass: M;
  length: L;
  time: T;
  current: I;
  temperature: Θ;
  amount: N;
  luminosity: J;
}

// ============================================================================
// Dimension Arithmetic (Type-Level)
// ============================================================================

// Type-level addition map. Sums outside -5..5 map to `DimOverflow` (MU-20)
// rather than saturating at ±5: a saturated L^5·L would be typed L^5 and be
// wrongly compatible with a real L^5. `DimOverflow` is sticky (any sum or
// negation involving it is `DimOverflow`) and is not assignable to any real
// exponent, so an overflowed quantity only type-checks against itself.
type AddMap = {
  "-5": {
    "-5": DimOverflow;
    "-4": DimOverflow;
    "-3": DimOverflow;
    "-2": DimOverflow;
    "-1": DimOverflow;
    "0": N5;
    "1": N4;
    "2": N3;
    "3": N2;
    "4": N1;
    "5": Z0;
    overflow: DimOverflow;
  };
  "-4": {
    "-5": DimOverflow;
    "-4": DimOverflow;
    "-3": DimOverflow;
    "-2": DimOverflow;
    "-1": N5;
    "0": N4;
    "1": N3;
    "2": N2;
    "3": N1;
    "4": Z0;
    "5": P1;
    overflow: DimOverflow;
  };
  "-3": {
    "-5": DimOverflow;
    "-4": DimOverflow;
    "-3": DimOverflow;
    "-2": N5;
    "-1": N4;
    "0": N3;
    "1": N2;
    "2": N1;
    "3": Z0;
    "4": P1;
    "5": P2;
    overflow: DimOverflow;
  };
  "-2": {
    "-5": DimOverflow;
    "-4": DimOverflow;
    "-3": N5;
    "-2": N4;
    "-1": N3;
    "0": N2;
    "1": N1;
    "2": Z0;
    "3": P1;
    "4": P2;
    "5": P3;
    overflow: DimOverflow;
  };
  "-1": {
    "-5": DimOverflow;
    "-4": N5;
    "-3": N4;
    "-2": N3;
    "-1": N2;
    "0": N1;
    "1": Z0;
    "2": P1;
    "3": P2;
    "4": P3;
    "5": P4;
    overflow: DimOverflow;
  };
  "0": {
    "-5": N5;
    "-4": N4;
    "-3": N3;
    "-2": N2;
    "-1": N1;
    "0": Z0;
    "1": P1;
    "2": P2;
    "3": P3;
    "4": P4;
    "5": P5;
    overflow: DimOverflow;
  };
  "1": {
    "-5": N4;
    "-4": N3;
    "-3": N2;
    "-2": N1;
    "-1": Z0;
    "0": P1;
    "1": P2;
    "2": P3;
    "3": P4;
    "4": P5;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
  "2": {
    "-5": N3;
    "-4": N2;
    "-3": N1;
    "-2": Z0;
    "-1": P1;
    "0": P2;
    "1": P3;
    "2": P4;
    "3": P5;
    "4": DimOverflow;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
  "3": {
    "-5": N2;
    "-4": N1;
    "-3": Z0;
    "-2": P1;
    "-1": P2;
    "0": P3;
    "1": P4;
    "2": P5;
    "3": DimOverflow;
    "4": DimOverflow;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
  "4": {
    "-5": N1;
    "-4": Z0;
    "-3": P1;
    "-2": P2;
    "-1": P3;
    "0": P4;
    "1": P5;
    "2": DimOverflow;
    "3": DimOverflow;
    "4": DimOverflow;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
  "5": {
    "-5": Z0;
    "-4": P1;
    "-3": P2;
    "-2": P3;
    "-1": P4;
    "0": P5;
    "1": DimOverflow;
    "2": DimOverflow;
    "3": DimOverflow;
    "4": DimOverflow;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
  overflow: {
    "-5": DimOverflow;
    "-4": DimOverflow;
    "-3": DimOverflow;
    "-2": DimOverflow;
    "-1": DimOverflow;
    "0": DimOverflow;
    "1": DimOverflow;
    "2": DimOverflow;
    "3": DimOverflow;
    "4": DimOverflow;
    "5": DimOverflow;
    overflow: DimOverflow;
  };
};

// Type-level negation map
type NegMap = {
  "-5": P5;
  "-4": P4;
  "-3": P3;
  "-2": P2;
  "-1": P1;
  "0": Z0;
  "1": N1;
  "2": N2;
  "3": N3;
  "4": N4;
  "5": N5;
  overflow: DimOverflow;
};

type DimToString<D extends DimExp> = `${D["value"]}`;

// Add two dimension exponents
export type AddDim<A extends DimExp, B extends DimExp> = AddMap[DimToString<A>][DimToString<B>];

// Negate a dimension exponent
export type NegDim<D extends DimExp> = NegMap[DimToString<D>];

// Subtract dimension exponents
export type SubDim<A extends DimExp, B extends DimExp> = AddDim<A, NegDim<B>>;

// ============================================================================
// Dimension Operations (Multiply/Divide units)
// ============================================================================

/**
 * Multiply two dimensional types (add exponents)
 */
export type MulDimensions<
  D1 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
  D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
> = Dimensions<
  AddDim<D1["mass"], D2["mass"]>,
  AddDim<D1["length"], D2["length"]>,
  AddDim<D1["time"], D2["time"]>,
  AddDim<D1["current"], D2["current"]>,
  AddDim<D1["temperature"], D2["temperature"]>,
  AddDim<D1["amount"], D2["amount"]>,
  AddDim<D1["luminosity"], D2["luminosity"]>
>;

/**
 * Divide dimensional types (subtract exponents)
 */
export type DivDimensions<
  D1 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
  D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
> = Dimensions<
  SubDim<D1["mass"], D2["mass"]>,
  SubDim<D1["length"], D2["length"]>,
  SubDim<D1["time"], D2["time"]>,
  SubDim<D1["current"], D2["current"]>,
  SubDim<D1["temperature"], D2["temperature"]>,
  SubDim<D1["amount"], D2["amount"]>,
  SubDim<D1["luminosity"], D2["luminosity"]>
>;

// ============================================================================
// Common Dimension Types
// ============================================================================

export type Dimensionless = Dimensions<Z0, Z0, Z0, Z0, Z0, Z0, Z0>;
export type Mass = Dimensions<P1, Z0, Z0, Z0, Z0, Z0, Z0>;
export type Length = Dimensions<Z0, P1, Z0, Z0, Z0, Z0, Z0>;
export type Time = Dimensions<Z0, Z0, P1, Z0, Z0, Z0, Z0>;
export type Current = Dimensions<Z0, Z0, Z0, P1, Z0, Z0, Z0>;
export type Temperature = Dimensions<Z0, Z0, Z0, Z0, P1, Z0, Z0>;

// Derived dimensions
export type Area = Dimensions<Z0, P2, Z0, Z0, Z0, Z0, Z0>; // L^2
export type Volume = Dimensions<Z0, P3, Z0, Z0, Z0, Z0, Z0>; // L^3
export type Velocity = Dimensions<Z0, P1, N1, Z0, Z0, Z0, Z0>; // L/T
export type Acceleration = Dimensions<Z0, P1, N2, Z0, Z0, Z0, Z0>; // L/T^2
export type Force = Dimensions<P1, P1, N2, Z0, Z0, Z0, Z0>; // M*L/T^2
export type Energy = Dimensions<P1, P2, N2, Z0, Z0, Z0, Z0>; // M*L^2/T^2
export type Power = Dimensions<P1, P2, N3, Z0, Z0, Z0, Z0>; // M*L^2/T^3
export type Pressure = Dimensions<P1, N1, N2, Z0, Z0, Z0, Z0>; // M/(L*T^2)
export type Frequency = Dimensions<Z0, Z0, N1, Z0, Z0, Z0, Z0>; // 1/T
export type Voltage = Dimensions<P1, P2, N3, N1, Z0, Z0, Z0>; // M*L^2/(T^3*I)
export type Resistance = Dimensions<P1, P2, N3, N2, Z0, Z0, Z0>; // M*L^2/(T^3*I^2)

// ============================================================================
// Unit Class
// ============================================================================

/**
 * A quantity with a value and dimensional type.
 * The dimension is encoded in the type system for compile-time checking.
 */
export class Unit<D extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>> {
  /**
   * Phantom, type-only member that makes `D` part of the class's structure
   * (MU-2). Without it `D` appears only in method parameter positions, which
   * TypeScript compares bivariantly, so every `Unit<…>` was assignable to
   * every other and no dimension mismatch was ever a compile error. `declare`
   * emits nothing at runtime; the property does not exist on instances.
   */
  declare readonly __dimensions: D;

  /**
   * @param value - the quantity in SI base units
   * @param symbol - the display symbol (e.g. "km")
   * @param displayFactor - SI units per display unit (1000 for "km"); `toString()`
   *   prints `(value - displayOffset) / displayFactor`
   * @param displayOffset - SI value of the display unit's zero (273.15 for "°C")
   */
  constructor(
    public readonly value: number,
    public readonly symbol: string = "",
    public readonly displayFactor: number = 1,
    public readonly displayOffset: number = 0
  ) {}

  /**
   * Add two quantities with the same dimensions.
   * Enables `unit1 + unit2` syntax via transformer operator rewriting.
   */
  add(other: Unit<D>): Unit<D> {
    return new Unit(this.value + other.value, this.symbol, this.displayFactor, this.displayOffset);
  }

  /**
   * Subtract two quantities with the same dimensions.
   * Enables `unit1 - unit2` syntax via transformer operator rewriting.
   */
  sub(other: Unit<D>): Unit<D> {
    // A difference is a delta, so it is displayed without the zero offset
    // (celsius(30).sub(celsius(10)) prints "20 °C").
    return new Unit(this.value - other.value, this.symbol, this.displayFactor);
  }

  /**
   * Multiply by another unit (dimensions add).
   * Enables `unit1 * unit2` syntax via transformer operator rewriting.
   */
  mul<D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>(
    other: Unit<D2>
  ): Unit<MulDimensions<D, D2>> {
    return new Unit(this.value * other.value);
  }

  /**
   * Divide by another unit (dimensions subtract).
   * Enables `unit1 / unit2` syntax via transformer operator rewriting.
   */
  div<D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>(
    other: Unit<D2>
  ): Unit<DivDimensions<D, D2>> {
    return new Unit(this.value / other.value);
  }

  /**
   * Scale by a dimensionless number
   */
  scale(factor: number): Unit<D> {
    return new Unit(this.value * factor, this.symbol, this.displayFactor, this.displayOffset);
  }

  /**
   * Negate the value
   */
  neg(): Unit<D> {
    return new Unit(-this.value, this.symbol, this.displayFactor, this.displayOffset);
  }

  /**
   * Check equality with tolerance.
   * Enables `unit1 === unit2` syntax via transformer operator rewriting.
   */
  equals(other: Unit<D>, tolerance: number = 1e-10): boolean {
    return Math.abs(this.value - other.value) < tolerance;
  }

  /**
   * Convert to a different unit of the same dimensions.
   *
   * Since all values are stored internally in SI base units, conversion works by
   * dividing by the target unit's SI factor: `display_value = si_value / factor`.
   *
   * Note: For temperature, celsius and kelvin store values as-is (factor = 1),
   * so `.to()` works correctly for temperature *differences* but NOT for absolute
   * temperature conversion (which requires an offset).
   *
   * @param targetConstructor - A unit constructor function (e.g., kilometers, miles)
   * @returns A new Unit with the value expressed in the target unit
   *
   * @example
   * ```typescript
   * meters(1000).to(kilometers) // → Unit(1, "km")
   * hours(2).to(minutes)        // → Unit(120, "min")
   * ```
   */
  to(targetConstructor: (v: number) => Unit<D>): Unit<D> {
    const atZero = targetConstructor(0);
    const atOne = targetConstructor(1);
    const factor = atOne.value - atZero.value;
    const offset = atZero.value;
    const convertedValue = (this.value - offset) / factor;
    return new Unit(convertedValue, atOne.symbol);
  }

  /**
   * Format as string, in the displayed unit: `kilometers(1).toString()` is
   * "1 km" (while `.value` is the SI value, 1000). A unit with no symbol, such
   * as the result of `mul`/`div`, prints its SI value.
   */
  toString(): string {
    let shown = this.value;
    if (this.displayFactor !== 1 || this.displayOffset !== 0) {
      // Round away the float noise of SI → display (100 / 3.6 * 3.6).
      shown = Number(((this.value - this.displayOffset) / this.displayFactor).toPrecision(15));
    }
    return this.symbol ? `${shown} ${this.symbol}` : `${shown}`;
  }
}

// ============================================================================
// Unit Constructors
// ============================================================================

// Length
export const meters = (v: number): Unit<Length> => new Unit(v, "m");
export const kilometers = (v: number): Unit<Length> => new Unit(v * 1000, "km", 1000);
export const centimeters = (v: number): Unit<Length> => new Unit(v / 100, "cm", 1 / 100);
export const millimeters = (v: number): Unit<Length> => new Unit(v / 1000, "mm", 1 / 1000);
export const feet = (v: number): Unit<Length> => new Unit(v * 0.3048, "ft", 0.3048);
export const inches = (v: number): Unit<Length> => new Unit(v * 0.0254, "in", 0.0254);
export const miles = (v: number): Unit<Length> => new Unit(v * 1609.344, "mi", 1609.344);

// Mass
export const kilograms = (v: number): Unit<Mass> => new Unit(v, "kg");
export const grams = (v: number): Unit<Mass> => new Unit(v / 1000, "g", 1 / 1000);
export const milligrams = (v: number): Unit<Mass> => new Unit(v / 1e6, "mg", 1 / 1e6);
export const pounds = (v: number): Unit<Mass> => new Unit(v * 0.453592, "lb", 0.453592);

// Time
export const seconds = (v: number): Unit<Time> => new Unit(v, "s");
export const minutes = (v: number): Unit<Time> => new Unit(v * 60, "min", 60);
export const hours = (v: number): Unit<Time> => new Unit(v * 3600, "h", 3600);
export const days = (v: number): Unit<Time> => new Unit(v * 86400, "d", 86400);
export const milliseconds = (v: number): Unit<Time> => new Unit(v / 1000, "ms", 1 / 1000);

// Velocity
export const metersPerSecond = (v: number): Unit<Velocity> => new Unit(v, "m/s");
export const kilometersPerHour = (v: number): Unit<Velocity> => new Unit(v / 3.6, "km/h", 1 / 3.6);
export const milesPerHour = (v: number): Unit<Velocity> => new Unit(v * 0.44704, "mph", 0.44704);

// Acceleration
export const metersPerSecondSquared = (v: number): Unit<Acceleration> => new Unit(v, "m/s²");

// Force
export const newtons = (v: number): Unit<Force> => new Unit(v, "N");

// Energy
export const joules = (v: number): Unit<Energy> => new Unit(v, "J");
export const kilojoules = (v: number): Unit<Energy> => new Unit(v * 1000, "kJ", 1000);
export const calories = (v: number): Unit<Energy> => new Unit(v * 4.184, "cal", 4.184);
export const kilocalories = (v: number): Unit<Energy> => new Unit(v * 4184, "kcal", 4184);

// Power
export const watts = (v: number): Unit<Power> => new Unit(v, "W");
export const kilowatts = (v: number): Unit<Power> => new Unit(v * 1000, "kW", 1000);

// Temperature (absolute — stored internally in kelvin)
export const kelvin = (v: number): Unit<Temperature> => new Unit(v, "K");
export const celsius = (v: number): Unit<Temperature> => new Unit(v + 273.15, "°C", 1, 273.15);
export const fahrenheit = (v: number): Unit<Temperature> =>
  new Unit(((v - 32) * 5) / 9 + 273.15, "°F", 5 / 9, 273.15 - (32 * 5) / 9);

// Frequency
export const hertz = (v: number): Unit<Frequency> => new Unit(v, "Hz");
export const kilohertz = (v: number): Unit<Frequency> => new Unit(v * 1e3, "kHz", 1e3);
export const megahertz = (v: number): Unit<Frequency> => new Unit(v * 1e6, "MHz", 1e6);
export const gigahertz = (v: number): Unit<Frequency> => new Unit(v * 1e9, "GHz", 1e9);

// Voltage
export const volts = (v: number): Unit<Voltage> => new Unit(v, "V");
export const millivolts = (v: number): Unit<Voltage> => new Unit(v / 1000, "mV", 1 / 1000);
export const kilovolts = (v: number): Unit<Voltage> => new Unit(v * 1000, "kV", 1000);

// Resistance
export const ohms = (v: number): Unit<Resistance> => new Unit(v, "Ω");
export const kilohms = (v: number): Unit<Resistance> => new Unit(v * 1000, "kΩ", 1000);
export const megohms = (v: number): Unit<Resistance> => new Unit(v * 1e6, "MΩ", 1e6);

// Pressure
export const pascals = (v: number): Unit<Pressure> => new Unit(v, "Pa");
export const kilopascals = (v: number): Unit<Pressure> => new Unit(v * 1000, "kPa", 1000);
export const atmospheres = (v: number): Unit<Pressure> => new Unit(v * 101325, "atm", 101325);

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Check if two units have the same dimensions (compile-time)
 */
export type SameDimensions<
  D1 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
  D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
> = D1 extends D2 ? (D2 extends D1 ? true : false) : false;

/**
 * Assert at compile time that dimensions are equal
 */
export function assertSameDimensions<
  D1 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
  D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>,
>(_a: Unit<D1>, _b: Unit<D2>): SameDimensions<D1, D2> {
  return true as SameDimensions<D1, D2>;
}
