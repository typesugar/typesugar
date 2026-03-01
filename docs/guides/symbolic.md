# Symbolic Math

Type-safe symbolic mathematics with compile-time type tracking, calculus operations, and algebraic simplification.

## Overview

`@typesugar/symbolic` provides:

- **Type-Safe AST** — `Expression<T>` tracks result types at compile time
- **Rendering** — Output to plain text, LaTeX, or MathML
- **Evaluation** — Evaluate expressions with variable bindings
- **Calculus** — Symbolic differentiation, integration, and limits
- **Simplification** — Algebraic simplification with extensible rules
- **Pattern Matching** — Match and rewrite expressions
- **Equation Solving** — Solve linear and quadratic equations

## Installation

```bash
npm install @typesugar/symbolic
```

## Quick Start

```typescript
import {
  var_,
  const_,
  add,
  mul,
  pow,
  diff,
  simplify,
  toLatex,
  toText,
  evaluate,
  solve,
} from "@typesugar/symbolic";

// Create variables and expressions
const x = var_("x");
const t = var_("t");

// Build expressions
const position = mul(const_(0.5), pow(t, const_(2))); // s = ½t²
const velocity = diff(position, "t"); // v = t
const acceleration = diff(velocity, "t"); // a = 1

// Render to different formats
toText(position); // "0.5 * t^2"
toLatex(position); // "0.5 t^{2}"

// Evaluate with variable bindings
evaluate(position, { t: 10 }); // 50

// Simplify expressions
const messy = add(x, add(const_(0), mul(const_(1), x)));
simplify(messy); // 2x

// Solve equations
const eq = add(mul(const_(2), x), const_(-6)); // 2x - 6 = 0
solve(eq, "x"); // { success: true, solutions: [const_(3)] }
```

## Expression Types

### Constants and Variables

```typescript
const c = const_(42); // numeric constant
const pi = const_(Math.PI, "π"); // named constant
const x = var_("x"); // variable
```

### Binary Operations

```typescript
add(a, b); // a + b
sub(a, b); // a - b
mul(a, b); // a * b
div(a, b); // a / b
pow(a, b); // a ^ b
```

### Functions

```typescript
sin(x);
cos(x);
tan(x);
exp(x);
ln(x);
sqrt(x);
abs(x);
// ... and more
```

## Calculus

### Differentiation

```typescript
import { diff, nthDiff } from "@typesugar/symbolic";

diff(pow(x, const_(2)), "x"); // 2x
diff(sin(x), "x"); // cos(x)
nthDiff(pow(x, const_(3)), "x", 2); // 6x
```

### Integration

```typescript
import { integrate } from "@typesugar/symbolic";

integrate(pow(x, const_(2)), "x"); // x³/3
integrate(sin(x), "x"); // -cos(x)
```

### Limits

```typescript
import { computeLimit } from "@typesugar/symbolic";

computeLimit(div(sin(x), x), "x", 0); // 1 (L'Hôpital's rule applied)
```

## Rendering

```typescript
import { toText, toLatex, toMathML } from "@typesugar/symbolic";

const expr = div(pow(x, const_(2)), add(x, const_(1)));

toText(expr); // "x^2 / (x + 1)"
toLatex(expr); // "\\frac{x^{2}}{x + 1}"
toMathML(expr); // MathML XML
```

## Typeclass Integration

With the typesugar transformer, operators work naturally:

```typescript
// x + 2 * y → add(x, mul(const_(2), y))
const position = const_(0.5) * t * t;
```

## Full Reference

See the [package README](https://github.com/typesugar/typesugar/blob/main/packages/symbolic/README.md) for the complete API reference including:

- Pattern matching and rewrite rules
- Equation solving (linear, quadratic, systems)
- Advanced simplification
- Expression traversal utilities
