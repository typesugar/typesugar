# @typesugar/math

> 📖 **Full documentation:** [Math guide](https://typesugar.org/guides/math). The microsite is the canonical reference; this README is a quickstart.

> 🧊 **Frozen ([PEP-048](../../peps/PEP-048-package-triage.md)).** Not under active development and excluded from release. It still lives in the repo and builds, but is not part of typesugar's actively-maintained surface.

Comprehensive math types and typeclasses for TypeScript: exact rationals, complex numbers, arbitrary-precision decimals, type-safe matrices, intervals, modular arithmetic, polynomials, and linear-algebra typeclasses.

## Installation

```bash
npm install @typesugar/math
```

## Quick Start

```typescript
import { rational, numericRational, complex, complexMagnitude, matrix, det } from "@typesugar/math";

// Exact rational arithmetic — no floating-point error
const sum = numericRational.add(rational(1n, 2n), rational(1n, 3n)); // 5/6

// Complex numbers
complexMagnitude(complex(3, 4)); // 5

// Type-safe matrices
det(matrix(2, 2, [1, 2, 3, 4])); // -2
```

## Documentation

- [Math guide](https://typesugar.org/guides/math) — full reference
- [Units guide](https://typesugar.org/guides/units) — `@typesugar/math` re-exports `@typesugar/units`

## License

MIT
