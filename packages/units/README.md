# @ttfx/units

> Type-safe physical units with compile-time dimensional analysis.

## Overview

`@ttfx/units` provides a compile-time unit system inspired by boost::units. Perform arithmetic on physical quantities with automatic unit tracking — the compiler catches dimension mismatches before runtime.

## Installation

```bash
npm install @ttfx/units
# or
pnpm add @ttfx/units
```

## Usage

### Basic Operations

```typescript
import { meters, seconds, kilograms } from "@ttfx/units";

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

```typescript
import { meters, seconds } from "@ttfx/units";

const d1 = meters(100);
const d2 = meters(50);
const t = seconds(10);

// Same-unit operations work
const total = d1.add(d2); // ✓ 150 meters

// Different-unit operations caught at compile time
const invalid = d1.add(t); // ✗ Compile error: can't add meters and seconds
```

### Unit Literals

```typescript
import { units } from "@ttfx/units";

// Parse unit literals at compile time
const speed = units`100 km/h`; // Type: Unit<Velocity>
const mass = units`5.5 kg`; // Type: Unit<Mass>
const energy = units`1000 J`; // Type: Unit<Energy>
```

### Conversion

```typescript
import { meters, kilometers, feet } from "@ttfx/units";

const d = kilometers(1);
const inMeters = d.to(meters); // 1000 meters
const inFeet = d.to(feet); // ~3280.84 feet
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
  readonly value: number;
  readonly dimensions: D;

  add(other: Unit<D>): Unit<D>;
  sub(other: Unit<D>): Unit<D>;
  mul<D2>(other: Unit<D2>): Unit<MulDimensions<D, D2>>;
  div<D2>(other: Unit<D2>): Unit<DivDimensions<D, D2>>;

  scale(factor: number): Unit<D>;
  abs(): Unit<D>;

  to<D2 extends D>(target: (n: number) => Unit<D2>): Unit<D2>;
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
