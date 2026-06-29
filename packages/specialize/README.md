# @typesugar/specialize

> 📖 **Full documentation:** [Specialization guide](https://typesugar.org/guides/specialize). The microsite is the canonical reference; this README is a quickstart.

Zero-cost typeclass specialization macros: bake typeclass instances into generic functions at compile time, eliminating runtime dictionary passing.

## Installation

```bash
npm install @typesugar/specialize
```

## Quick Start

```typescript
function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

// Just call it — the instance is resolved AND inlined automatically
const sorted = sortWith([3, 1, 2]); // [1, 2, 3]
// Compiles to: [3, 1, 2].slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0)

// Or pass an explicit instance to override
const sorted2 = sortWith([3, 1, 2], reverseOrd);
```

## Documentation

- [Specialization guide](https://typesugar.org/guides/specialize) — full reference
- [API reference](https://typesugar.org/reference/packages#specialize)
