# @typesugar/units

> Type-safe physical units with compile-time dimensional analysis.

## Overview

`@typesugar/units` provides a compile-time unit system inspired by boost::units. Perform arithmetic on physical quantities with automatic unit tracking — the compiler catches dimension mismatches before runtime.

## Installation

```bash
npm install @typesugar/units
# or
pnpm add @typesugar/units
```

## Usage

### Basic Operations

```typescript
import { meters, seconds, kilograms } from "@typesugar/units";

const distance = meters(100);
const time = seconds(10);
const mass = kilograms(5);

// Division produces derived units
const velocity = distance.div(time);
// Type: Unit<Velocity> (m/s)

// Multiplication
const force = mass.mul(velocity.div(time));
// Type: Unit<Force> (N = kg·m/s²)
```

### Type-Safe Arithmetic

With the typesugar transformer, use natural operator syntax:

```typescript
import { meters, seconds } from "@typesugar/units";

const d1 = meters(100);
const d2 = meters(50);
const t = seconds(10);

// Operator syntax (requires typesugar transformer)
const total = d1 + d2; // 150 meters
const diff = d1 - d2; // 50 meters
const velocity = d1 / t; // Unit<Velocity>

// Different-dimension operations caught at compile time
// const invalid = d1 + t; // ✗ Compile error: can't add meters and seconds
```

Or use explicit method calls:

```typescript
const total = d1.add(d2); // ✓ 150 meters
const invalid = d1.add(t); // ✗ Compile error: can't add meters and seconds
```

### Unit Literals

```typescript
import { units } from "@typesugar/units";

// Parse unit literals at compile time
const speed = units`100 km/h`; // Type: Unit<Velocity>
const mass = units`5.5 kg`; // Type: Unit<Mass>
const energy = units`1000 J`; // Type: Unit<Energy>
```

### Unit Values and Display

All units store values internally in SI base units. Access the raw value with `.value`:

```typescript
import { meters, kilometers, feet } from "@typesugar/units";

const d = kilometers(1);
console.log(d.value); // 1000 (stored as meters internally)
console.log(d.symbol); // "km"
console.log(d.toString()); // "1000 km"

const f = feet(1);
console.log(f.value); // 0.3048 (stored as meters)
```

### Arithmetic Conversion

Convert between units of the same dimension through arithmetic:

```typescript
import { meters, kilometers } from "@typesugar/units";

// Convert kilometers to a number in meters
const km = kilometers(5);
const metersValue = km.value; // 5000

// Create a new unit with specific representation
const inMeters = meters(km.value); // Unit<Length> with value 5000, symbol "m"

// Velocity conversion
const speed = kilometersPerHour(100);
const mps = metersPerSecond(speed.value); // Convert via the raw value
```

## Available Units

### Length

| Unit        | Function         | Symbol |
| ----------- | ---------------- | ------ |
| Meters      | `meters(n)`      | m      |
| Kilometers  | `kilometers(n)`  | km     |
| Centimeters | `centimeters(n)` | cm     |
| Millimeters | `millimeters(n)` | mm     |
| Feet        | `feet(n)`        | ft     |
| Inches      | `inches(n)`      | in     |
| Miles       | `miles(n)`       | mi     |

### Mass

| Unit       | Function        | Symbol |
| ---------- | --------------- | ------ |
| Kilograms  | `kilograms(n)`  | kg     |
| Grams      | `grams(n)`      | g      |
| Milligrams | `milligrams(n)` | mg     |
| Pounds     | `pounds(n)`     | lb     |

### Time

| Unit         | Function          | Symbol |
| ------------ | ----------------- | ------ |
| Seconds      | `seconds(n)`      | s      |
| Minutes      | `minutes(n)`      | min    |
| Hours        | `hours(n)`        | h      |
| Days         | `days(n)`         | d      |
| Milliseconds | `milliseconds(n)` | ms     |

### Derived Units

| Unit         | Function                    | Dimensions   |
| ------------ | --------------------------- | ------------ |
| Velocity     | `metersPerSecond(n)`        | m/s          |
| Velocity     | `kilometersPerHour(n)`      | km/h         |
| Acceleration | `metersPerSecondSquared(n)` | m/s²         |
| Force        | `newtons(n)`                | N (kg·m/s²)  |
| Energy       | `joules(n)`                 | J (kg·m²/s²) |
| Power        | `watts(n)`                  | W (J/s)      |
| Pressure     | `pascals(n)`                | Pa (N/m²)    |
| Temperature  | `kelvin(n)`, `celsius(n)`   | K, °C        |

## API Reference

### Unit<D>

```typescript
class Unit<D extends Dimensions> {
  readonly value: number; // Value in SI base units
  readonly symbol: string; // Display symbol (e.g., "km", "m/s")

  // Same-dimension operations
  add(other: Unit<D>): Unit<D>;
  sub(other: Unit<D>): Unit<D>;

  // Cross-dimension operations (dimensions combine)
  mul<D2>(other: Unit<D2>): Unit<MulDimensions<D, D2>>;
  div<D2>(other: Unit<D2>): Unit<DivDimensions<D, D2>>;

  // Scalar operations
  scale(factor: number): Unit<D>;
  neg(): Unit<D>;

  // Comparison
  equals(other: Unit<D>, tolerance?: number): boolean;

  // Display
  toString(): string; // "value symbol"
}
```

### Dimensions

The type-level dimension tracking:

```typescript
type Dimensions<
  Length, Mass, Time, Current, Temperature, Amount, Luminosity
>
```

### Tagged Template

```typescript
function units(strings: TemplateStringsArray): Unit<Dimensions>;
```

## Typeclass Integration

The Unit class methods are annotated with `Op<>` return types, enabling the typesugar transformer to rewrite operators:

| Operator | Method   | Type Behavior                    |
| -------- | -------- | -------------------------------- |
| `+`      | `add`    | Same dimensions required         |
| `-`      | `sub`    | Same dimensions required         |
| `*`      | `mul`    | Dimensions multiply (L × T = LT) |
| `/`      | `div`    | Dimensions divide (L / T = L/T)  |
| `===`    | `equals` | Same dimensions, tolerance check |

Note: Unlike a simple Numeric typeclass, `mul` and `div` change the dimension type, which is the whole point of unit safety.

## How It Works

Each unit carries its dimensions at the type level:

```typescript
meters(1); // Unit<Dimensions<1, 0, 0, ...>>  (length=1)
seconds(1); // Unit<Dimensions<0, 0, 1, ...>>  (time=1)
// meters / seconds:
// Unit<Dimensions<1, 0, -1, ...>>  (length=1, time=-1 = velocity)
```

When you add/subtract, dimensions must match exactly. When you multiply/divide, dimensions combine:

- `m × m = m²`
- `m / s = m·s⁻¹` (velocity)
- `kg × m / s² = kg·m·s⁻²` (force)

## License

MIT
