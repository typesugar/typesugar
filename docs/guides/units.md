# Units of Measure

Type-safe physical units with compile-time dimensional analysis. Catch dimension mismatches before runtime.

## Quick Start

```bash
npm install @typesugar/units
```

```typescript
import { meters, seconds, kilograms } from "@typesugar/units";

const distance = meters(100);
const time = seconds(10);
const velocity = distance.div(time); // Type: Unit<Velocity> (m/s)
```

## Type-Safe Arithmetic

```typescript
const d1 = meters(100);
const d2 = meters(50);
const t = seconds(10);

// Same-unit operations work
const total = d1.add(d2); // ✓ 150 meters

// Different-unit operations caught at compile time
const invalid = d1.add(t); // ✗ Compile error
```

## Available Units

### Base Units

| Category   | Units                                                            |
| ---------- | ---------------------------------------------------------------- |
| **Length** | `meters`, `kilometers`, `centimeters`, `feet`, `inches`, `miles` |
| **Mass**   | `kilograms`, `grams`, `milligrams`, `pounds`                     |
| **Time**   | `seconds`, `minutes`, `hours`, `days`, `milliseconds`            |

### Derived Units

| Unit         | Dimensions                             |
| ------------ | -------------------------------------- |
| Velocity     | `metersPerSecond`, `kilometersPerHour` |
| Acceleration | `metersPerSecondSquared`               |
| Force        | `newtons` (kg·m/s²)                    |
| Energy       | `joules` (kg·m²/s²)                    |
| Power        | `watts` (J/s)                          |

## Unit Literals

```typescript
import { units } from "@typesugar/units";

const speed = units`100 km/h`; // Type: Unit<Velocity>
const mass = units`5.5 kg`; // Type: Unit<Mass>
```

## Conversion

```typescript
const d = kilometers(1);
const inMeters = d.to(meters); // 1000 meters
const inFeet = d.to(feet); // ~3280.84 feet
```

## How It Works

Dimensions are tracked at the type level:

```typescript
meters(1); // Unit<Dimensions<1, 0, 0, ...>>  (length=1)
seconds(1); // Unit<Dimensions<0, 0, 1, ...>>  (time=1)

// meters / seconds:
// Unit<Dimensions<1, 0, -1, ...>>  (length=1, time=-1 = velocity)
```

## Learn More

- [API Reference](/reference/packages#units)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/units)
