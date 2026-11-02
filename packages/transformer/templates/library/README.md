# My typesugar Library

A library built with typesugar typeclasses and derives.

## Features

- Custom `Printable` typeclass
- `Point` type with derived `Eq`, `Clone`, `Debug`
- Generic `printAll` function

## Installation

```bash
npm install my-typesugar-library
```

The published JavaScript and declarations are already expanded: `tsup` runs
typesugar through `withTypesugar()` (`tsup.config.ts`).

## Usage

```typescript
import { Point, printAll, Printable } from "my-typesugar-library";

// Use the derived instances
const p1 = new Point(1, 2);
const p2 = Point.Clone.clone(p1);
console.log(Point.Eq.equals(p1, p2)); // true
console.log(Point.Debug.debug(p1)); // "Point { x: 1, y: 2 }"

// Use generic function
console.log(printAll([1, 2, 3])); // "1, 2, 3"
```

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Watch mode
npm run dev
npm run test:watch
```

## Publishing

```bash
npm version patch
npm publish
```

## Structure

```
src/
  index.ts    # Main exports
tests/
  index.test.ts
```
