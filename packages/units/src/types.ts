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

export type DimExp = N5 | N4 | N3 | N2 | N1 | Z0 | P1 | P2 | P3 | P4 | P5;

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

// Type-level addition map
type AddMap = {
  "-5": {
    "-5": N5;
    "-4": N5;
    "-3": N5;
    "-2": N5;
    "-1": N5;
    "0": N5;
    "1": N4;
    "2": N3;
    "3": N2;
    "4": N1;
    "5": Z0;
  };
  "-4": {
    "-5": N5;
    "-4": N5;
    "-3": N5;
    "-2": N5;
    "-1": N5;
    "0": N4;
    "1": N3;
    "2": N2;
    "3": N1;
    "4": Z0;
    "5": P1;
  };
  "-3": {
    "-5": N5;
    "-4": N5;
    "-3": N5;
    "-2": N5;
    "-1": N4;
    "0": N3;
    "1": N2;
    "2": N1;
    "3": Z0;
    "4": P1;
    "5": P2;
  };
  "-2": {
    "-5": N5;
    "-4": N5;
    "-3": N5;
    "-2": N4;
    "-1": N3;
    "0": N2;
    "1": N1;
    "2": Z0;
    "3": P1;
    "4": P2;
    "5": P3;
  };
  "-1": {
    "-5": N5;
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
    "5": P5;
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
    "4": P5;
    "5": P5;
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
    "3": P5;
    "4": P5;
    "5": P5;
  };
  "4": {
    "-5": N1;
    "-4": Z0;
    "-3": P1;
    "-2": P2;
    "-1": P3;
    "0": P4;
    "1": P5;
    "2": P5;
    "3": P5;
    "4": P5;
    "5": P5;
  };
  "5": {
    "-5": Z0;
    "-4": P1;
    "-3": P2;
    "-2": P3;
    "-1": P4;
    "0": P5;
    "1": P5;
    "2": P5;
    "3": P5;
    "4": P5;
    "5": P5;
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
  constructor(
    public readonly value: number,
    public readonly symbol: string = ""
  ) {}

  /**
   * Add two quantities with the same dimensions
   */
  add(other: Unit<D>): Unit<D> {
    return new Unit(this.value + other.value, this.symbol);
  }

  /**
   * Subtract two quantities with the same dimensions
   */
  sub(other: Unit<D>): Unit<D> {
    return new Unit(this.value - other.value, this.symbol);
  }

  /**
   * Multiply by another unit (dimensions add)
   */
  mul<D2 extends Dimensions<DimExp, DimExp, DimExp, DimExp, DimExp, DimExp, DimExp>>(
    other: Unit<D2>
  ): Unit<MulDimensions<D, D2>> {
    return new Unit(this.value * other.value);
  }

  /**
   * Divide by another unit (dimensions subtract)
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
    return new Unit(this.value * factor, this.symbol);
  }

  /**
   * Negate the value
   */
  neg(): Unit<D> {
    return new Unit(-this.value, this.symbol);
  }

  /**
   * Check equality with tolerance
   */
  equals(other: Unit<D>, tolerance: number = 1e-10): boolean {
    return Math.abs(this.value - other.value) < tolerance;
  }

  /**
   * Format as string
   */
  toString(): string {
    return this.symbol ? `${this.value} ${this.symbol}` : `${this.value}`;
  }
}

// ============================================================================
// Unit Constructors
// ============================================================================

// Length
export const meters = (v: number): Unit<Length> => new Unit(v, "m");
export const kilometers = (v: number): Unit<Length> => new Unit(v * 1000, "km");
export const centimeters = (v: number): Unit<Length> => new Unit(v / 100, "cm");
export const millimeters = (v: number): Unit<Length> => new Unit(v / 1000, "mm");
export const feet = (v: number): Unit<Length> => new Unit(v * 0.3048, "ft");
export const inches = (v: number): Unit<Length> => new Unit(v * 0.0254, "in");
export const miles = (v: number): Unit<Length> => new Unit(v * 1609.344, "mi");

// Mass
export const kilograms = (v: number): Unit<Mass> => new Unit(v, "kg");
export const grams = (v: number): Unit<Mass> => new Unit(v / 1000, "g");
export const milligrams = (v: number): Unit<Mass> => new Unit(v / 1e6, "mg");
export const pounds = (v: number): Unit<Mass> => new Unit(v * 0.453592, "lb");

// Time
export const seconds = (v: number): Unit<Time> => new Unit(v, "s");
export const minutes = (v: number): Unit<Time> => new Unit(v * 60, "min");
export const hours = (v: number): Unit<Time> => new Unit(v * 3600, "h");
export const days = (v: number): Unit<Time> => new Unit(v * 86400, "d");
export const milliseconds = (v: number): Unit<Time> => new Unit(v / 1000, "ms");

// Velocity
export const metersPerSecond = (v: number): Unit<Velocity> => new Unit(v, "m/s");
export const kilometersPerHour = (v: number): Unit<Velocity> => new Unit(v / 3.6, "km/h");
export const milesPerHour = (v: number): Unit<Velocity> => new Unit(v * 0.44704, "mph");

// Acceleration
export const metersPerSecondSquared = (v: number): Unit<Acceleration> => new Unit(v, "m/s²");

// Force
export const newtons = (v: number): Unit<Force> => new Unit(v, "N");

// Energy
export const joules = (v: number): Unit<Energy> => new Unit(v, "J");
export const kilojoules = (v: number): Unit<Energy> => new Unit(v * 1000, "kJ");
export const calories = (v: number): Unit<Energy> => new Unit(v * 4.184, "cal");
export const kilocalories = (v: number): Unit<Energy> => new Unit(v * 4184, "kcal");

// Power
export const watts = (v: number): Unit<Power> => new Unit(v, "W");
export const kilowatts = (v: number): Unit<Power> => new Unit(v * 1000, "kW");

// Temperature (note: this is temperature difference, not absolute)
export const kelvin = (v: number): Unit<Temperature> => new Unit(v, "K");
export const celsius = (v: number): Unit<Temperature> => new Unit(v, "°C");

// Pressure
export const pascals = (v: number): Unit<Pressure> => new Unit(v, "Pa");
export const kilopascals = (v: number): Unit<Pressure> => new Unit(v * 1000, "kPa");
export const atmospheres = (v: number): Unit<Pressure> => new Unit(v * 101325, "atm");

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
