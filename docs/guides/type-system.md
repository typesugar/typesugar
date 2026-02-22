# Type System

Advanced type system extensions: refined types, newtypes, HKT, phantom types, and type-level arithmetic.

## Quick Start

```bash
npm install @typesugar/type-system
```

```typescript
import { type Newtype, wrap, unwrap, type Refined, refine } from "@typesugar/type-system";

// Zero-cost branding
type UserId = Newtype<number, "UserId">;
const id = wrap<UserId>(42);

// Compile-time validated refinements
type Port = Refined<number, "Port">;
const port = refine<Port>(8080); // ✓
const bad = refine<Port>(-1); // ✗ Compile error
```

## Features

### Newtype — Zero-Cost Branding

Type-safe wrappers with zero runtime cost.

```typescript
type Meters = Newtype<number, "Meters">;
type Feet = Newtype<number, "Feet">;

function calculateArea(width: Meters, height: Meters): number {
  return unwrap(width) * unwrap(height);
}

// Type-safe! Can't mix up Meters and Feet
calculateArea(wrap<Meters>(10), wrap<Feet>(5)); // Type error!
```

### Refinement Types

Types with predicates validated at compile time for literals.

```typescript
import { Positive, NonEmpty, Email, Port } from "@typesugar/type-system";

type ValidPort = Refined<number, typeof Port>;
const port = refine<Port>(8080); // ✓
const badPort = refine<Port>(-1); // ✗ Compile error
```

### Higher-Kinded Types (HKT)

Type constructors as type parameters.

```typescript
import { type $, type ArrayF, type PromiseF } from "@typesugar/type-system";

type Result = $<ArrayF, number>; // number[]
type Async = $<PromiseF, string>; // Promise<string>
```

### Length-Indexed Arrays (Vec)

Arrays with compile-time known length.

```typescript
import { Vec } from "@typesugar/type-system";

const v3: Vec<number, 3> = Vec.from([1, 2, 3]);
const first: number = Vec.head(v3); // ✓ Safe
const rest: Vec<number, 2> = Vec.tail(v3);

// Vec<T, 0> has no head — compile error!
```

### Type-Level Arithmetic

```typescript
import { Add, Mul, Pow } from "@typesugar/type-system";

type Sum = Add<1, 2>; // 3
type Product = Mul<4, 5>; // 20
type Power = Pow<2, 8>; // 256
```

## Learn More

- [API Reference](/reference/packages#type-system)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/type-system)
