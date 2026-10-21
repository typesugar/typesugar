# Operator Overloading

typesugar provides operator overloading via `@op` JSDoc on typeclass methods: standard JavaScript operators (`+`, `-`, `*`, `/`, `===`, etc.) dispatch to typeclass methods at compile time.

## Standard Operators via @op JSDoc

The only way to enable standard JavaScript operators is through typeclass instances with `@op` JSDoc tags on method signatures. For the standard typeclasses, operator syntax is off until you import the typeclass's `ops` activation module (PEP-052) — without it, `a + b` is left alone, and the transformer warns ([TS9804](../errors/TS9804.md)) when an instance in scope would have handled the operator, naming the import to add:

```typescript
import "@typesugar/std/syntax/numeric/ops"; // + - *
import "@typesugar/std/syntax/fractional/ops"; // /
import "@typesugar/std/syntax/ord/ops"; // < <= > >=
import { rational, rationalToString } from "@typesugar/math";

const a = rational(1n, 2n);
const b = rational(1n, 3n);

const sum = a + b; // Compiles to: numericRational.add(a, b)
const product = a * b; // Compiles to: numericRational.mul(a, b)
const quotient = a / b; // Compiles to: fractionalRational.div(a, b)
const comparison = a < b; // Compiles to: ordRational.lessThan(a, b)
rationalToString(sum); // "5/6"
```

The instances (`numericRational`, …) are imported for you. The activation modules are
`@typesugar/std/syntax/<typeclass>/ops` for `eq` (`===`, `!==`, `==`, `!=`), `ord`, `semigroup`,
`monoid`, `group` (`+`), `numeric` (`+ - *`), `integral` (`/ %`) and `fractional` (`/`).
A typeclass you define in the same file with `@op` tags needs no activation import.

If you forget the import, the operator stays native JavaScript (`a + b` on two
objects concatenates strings; `p1 === p2` compares references), and you get:

```
warning [TS9804] Operator '+' on 'Complex' matches Numeric.add, but Numeric operator syntax is not activated in this file
  = help: Add `import "@typesugar/std/syntax/numeric/ops";` to rewrite it to Numeric.add(...). Without it the operator stays native JavaScript.
```

The warning only fires when activating the typeclass would actually change the
expression: never on primitive operands, on types with no instance in scope, in
files that already activate the typeclass or declare it, or in
`"use no typesugar"` files. Where the native operator is intended, add
`// @ts-no-typesugar operators` to the line. For reference identity, write
`Object.is(a, b)` instead: it is a call, so it is never rewritten, in a file that
activates Eq or one that doesn't.

Typeclasses define methods with `@op` JSDoc tags, which the transformer uses to dispatch operators:

```typescript
/** @typeclass */
interface Numeric<A> {
  /** @op + */
  add(a: A, b: A): A;

  /** @op * */
  mul(a: A, b: A): A;

  /** @op - */
  sub(a: A, b: A): A;
}
```

This approach is **zero-cost** — the operator is transformed directly to the method call with no wrapper.

### Several Operators on One Method

A method can carry more than one `@op` tag, one per operator it handles. Use this
for equivalent spellings of the same operation: std's `Eq` maps both `===` and `==`
to `equals`, and both `!==` and `!=` to `notEquals`, so `a == b` and `a === b`
compile to the same call:

```typescript
/** @typeclass */
interface Eq<A> {
  /**
   * @op ===
   * @op ==
   */
  equals(a: A, b: A): boolean;
  /**
   * @op !==
   * @op !=
   */
  notEquals(a: A, b: A): boolean;
}
```

Every tag maps its operator to that method, and the rules below (unary vs binary
by parameter count, the right-operand check) apply to each tag alike. Keep it to
spellings that mean the same thing; two different operations belong on two methods.

---

## Supported Operators

### Arithmetic

| Operator | Typical Method          | Example  |
| -------- | ----------------------- | -------- |
| `+`      | `add`, `plus`           | `a + b`  |
| `-`      | `sub`, `minus`          | `a - b`  |
| `*`      | `mul`, `times`, `scale` | `a * b`  |
| `/`      | `div`                   | `a / b`  |
| `%`      | `mod`, `rem`            | `a % b`  |
| `**`     | `pow`                   | `a ** b` |

### Comparison

| Operator | Typical Method              | Example   |
| -------- | --------------------------- | --------- |
| `===`    | `equals`, `eq`              | `a === b` |
| `==`     | `equals`, `eq`              | `a == b`  |
| `!==`    | `notEquals`, `neq`          | `a !== b` |
| `!=`     | `notEquals`, `neq`          | `a != b`  |
| `<`      | `lessThan`, `lt`            | `a < b`   |
| `<=`     | `lessThanOrEqual`, `lte`    | `a <= b`  |
| `>`      | `greaterThan`, `gt`         | `a > b`   |
| `>=`     | `greaterThanOrEqual`, `gte` | `a >= b`  |

A comparison with `null` or `undefined` (`a == null`, `a !== undefined`) is never
rewritten, so the usual nullish checks keep their JavaScript meaning. To compare
references in a file that activates Eq, use `Object.is(a, b)`.

An operand whose type admits `null` or `undefined` (`c: Point | undefined`) is
dispatched to the instance only when it holds a value; when it is nullish, the
comparison gives the native operator's result, so the instance is never called with
`null` and a comparison that never threw before the rewrite doesn't throw after it:

```typescript
c === p; // c == null ? c === p : Point.Eq.equals(c, p)
f() === p; // ((l, r) => l == null ? l === r : Point.Eq.equals(l, r))(f(), p): f() runs once
```

Operands with non-null types compile to the plain call. This follows the checker, so it
needs `strictNullChecks` (part of `strict`): without it TypeScript sees no type as
nullable, and every operand is passed to the instance as it is.

### Bitwise

| Operator | Typical Method | Example  |
| -------- | -------------- | -------- |
| `&`      | `and`          | `a & b`  |
| `\|`     | `or`           | `a \| b` |
| `^`      | `xor`          | `a ^ b`  |
| `<<`     | `shl`          | `a << b` |
| `>>`     | `shr`          | `a >> b` |

## Operator Precedence

Operators respect JavaScript operator precedence:

```typescript
a + b * c; // → add(a, mul(b, c))
(a + b) * c; // → mul(add(a, b), c)
```

## Pipe Operator

The `pipe()` function chains operations:

```typescript
import { pipe } from "typesugar";

const result = pipe(
  5,
  (x) => x * 2,
  (x) => x + 1,
  (x) => x.toString()
);
// result: "11"
```

## Compose

Compose functions right-to-left:

```typescript
import { compose } from "typesugar";

const f = (x: number) => x * 2;
const g = (x: number) => x + 1;

const h = compose(f, g); // x => f(g(x))
h(5); // 12 (5 + 1 = 6, 6 * 2 = 12)
```

## Unary Operators

Put `@op` on a ONE-parameter method to dispatch the prefix-unary form. The same
token can map a binary method too; the parameter count decides which form each one
handles:

```typescript
/** @typeclass */
interface VecOps<A> {
  /** @op - */
  sub(a: A, b: A): A; // v - w  → vecOps.sub(v, w)
  /** @op - */
  negate(a: A): A; // -v     → vecOps.negate(v)
}
```

Prefix `-`, `+`, `!` and `~` can be dispatched. `++`/`--` never are, and a unary
operator on a primitive (`-n` for a `number`) stays plain JavaScript.

## Comparison with @derive

`@op` and `@derive(Eq, Ord)` serve different purposes:

```typescript
// @derive generates the implementation
@derive(Eq, Ord)
class Point { ... }

// @op maps syntax to existing methods on typeclass definitions
@op is on the typeclass interface, not the class
```

## Type Safety

Dispatch picks the instance from the left operand's type. When the method's right
parameter is the typeclass's type parameter (`add(a: A, b: A)`), the right operand
must have the instance type too; otherwise the operator is left native and reported:

```typescript
const sum = vec + other; // OK: vecOps.add(vec, other)
const bad = vec + 5; // error: Operator '+' on 'Vec2' dispatches to VecOps.add, whose right
//                      operand must also be 'Vec2', but it is 'number'.
```

A method whose right parameter has some other type (`scale(a: A, k: number)`) is not
checked here. Set the bundler plugin's `strict: true` to have the expanded code
type-checked (see [Type Safety](./type-safety.md)).

## Performance

Operators compile away completely:

```typescript
// Source
const result = a + b * c;

// Compiled
const result = numericInstance.add(a, numericInstance.mul(b, c));
```

No runtime overhead.

## Limitations

### What @op Doesn't Support

- Assignment operators (`+=`, `-=`, etc.)
- Increment/decrement (`++`, `--`)
- Logical operators (`&&`, `||`)
- Ternary operator (`? :`)

## Best Practices

### Do

- Use descriptive method names (`add`, `multiply`)
- Keep operator semantics intuitive
- Document what operators your type supports
- Use `@op` on typeclass methods for typeclass-based operator dispatch

### Don't

- Overload operators with surprising behavior
- Use operators everywhere (only where they improve readability)
