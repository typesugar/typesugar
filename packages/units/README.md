# @typesugar/units

> 📖 **Full documentation:** [Units of Measure guide](https://typesugar.org/guides/units). The microsite is the canonical reference; this README is a quickstart.

> 🧊 **Frozen ([PEP-048](../../peps/PEP-048-package-triage.md)).** Not under active development and excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

Type-safe physical units with compile-time dimensional analysis, so the compiler catches dimension mismatches before runtime.

## Installation

```bash
npm install @typesugar/units
```

## Quick Start

```typescript
import { meters, seconds, kilograms } from "@typesugar/units";

const distance = meters(100);
const time = seconds(10);
const mass = kilograms(5);

// Division produces derived units
const velocity = distance.div(time); // Unit<Velocity> (m/s)

// Multiplication combines dimensions
const force = mass.mul(velocity.div(time)); // Unit<Force> (kg·m/s²)

// Dimension mismatches are compile errors
// distance.add(time);                       // ✗ Length + Time
// const m: Unit<Mass> = distance;           // ✗ Length is not Mass
```

Each base dimension's exponent is tracked in the range −5..5. Arithmetic that leaves that range produces an overflow dimension, which is compatible only with other overflowed quantities, never with a real one.

## Documentation

- [Units of Measure guide](https://typesugar.org/guides/units) — full reference
- [API Reference](https://typesugar.org/reference/packages#units)
