<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->
<!-- prettier-ignore-start -->

# Error Reference

Every diagnostic the typesugar compiler can emit, generated from the
catalogs in `packages/core/src/diagnostics.ts` (TS9xxx) and
`packages/effect/src/diagnostics.ts` (EFFECT0xx).

Codes marked *(reserved)* are catalogued but not currently emitted by the
compiler.

## Typeclass Resolution

| Code | Severity | Message |
| --- | --- | --- |
| [TS9001](./TS9001.md) | Error | `` No instance found for `{typeclass}<{type}>` `` |
| [TS9002](./TS9002.md) *(reserved)* | Error | `@impl/@instance must annotate a const declaration` |
| [TS9003](./TS9003.md) *(reserved)* | Error | `@impl/@instance requires explicit type annotation (e.g., Typeclass<Type>)` |
| [TS9004](./TS9004.md) *(reserved)* | Error | `@impl/@instance type must be a generic type reference (e.g., Show<Point>)` |
| [TS9005](./TS9005.md) | Error | `summon requires a type argument: summon<Typeclass<Type>>()` |
| [TS9006](./TS9006.md) *(reserved)* | Warning | `Duplicate instance {typeclass}<{type}> registered` |
| [TS9007](./TS9007.md) *(reserved)* | Error | `summon type argument '{typeArg}' is not a registered typeclass` |
| [TS9008](./TS9008.md) | Error | `summon type argument must be a type reference like Show<Point>` |
| [TS9050](./TS9050.md) | Error | `` Conflicting instance of `{typeclass}` for type `{type}` `` |
| [TS9051](./TS9051.md) | Warning | ``Instance of `{typeclass}` for `{type}` shadows imported instance`` |
| [TS9052](./TS9052.md) *(reserved)* | Error | `` Ambiguous instance resolution for `{typeclass}<{type}>` `` |
| [TS9060](./TS9060.md) *(reserved)* | Error | ``Typeclass `{name}` is not in scope`` |
| [TS9062](./TS9062.md) *(reserved)* | Error | `` Method `{method}` does not exist on type `{type}` `` |
| [TS9063](./TS9063.md) *(reserved)* | Info | ``Did you mean to import `{symbol}` from `{module}`?`` |

## Macro Syntax

| Code | Severity | Message |
| --- | --- | --- |
| [TS9061](./TS9061.md) *(reserved)* | Error | ``Macro `{name}` is not defined`` |
| [TS9201](./TS9201.md) *(reserved)* | Error | `{macro} expects {expected} argument(s), got {received}` |
| [TS9202](./TS9202.md) | Error | `{macro} argument {index} must be a {expected}, got {received}` |
| [TS9203](./TS9203.md) | Error | `{macro} can only be applied to {expected}` |
| [TS9204](./TS9204.md) *(reserved)* | Error | `{macro} requires {expected} type argument(s)` |
| [TS9205](./TS9205.md) | Error | `Expected a compile-time constant string literal` |
| [TS9206](./TS9206.md) | Error | `Function must have a name for {macro}` |
| [TS9207](./TS9207.md) *(reserved)* | Error | `Function must have a body for {macro}` |
| [TS9208](./TS9208.md) *(reserved)* | Error | `Invalid argument type: expected {expected}` |
| [TS9209](./TS9209.md) | Error | `Cannot evaluate expression at compile time` |
| [TS9210](./TS9210.md) *(reserved)* | Error | `Macro {macro} is not registered` |
| [TS9211](./TS9211.md) *(reserved)* | Error | `{macro} expects exactly {expected} argument(s)` |
| [TS9212](./TS9212.md) | Error | `Failed to read file: {path}` |
| [TS9213](./TS9213.md) | Error | `Failed to parse JSON from file: {path}` |
| [TS9214](./TS9214.md) *(reserved)* | Error | `Macro expansion failed: {reason}` |
| [TS9215](./TS9215.md) *(reserved)* | Error | `@operator must be inside a class declaration` |
| [TS9216](./TS9216.md) | Error | `{macro} requires at least {min} argument(s)` |
| [TS9217](./TS9217.md) | Error | `Static assertion failed: {message}` |
| [TS9218](./TS9218.md) *(reserved)* | Warning | `Compile-time warning: {message}` |
| [TS9219](./TS9219.md) | Error | `staticAssert condition must be a compile-time constant` |
| [TS9220](./TS9220.md) | Error | `@tailrec: {reason}` |
| [TS9222](./TS9222.md) | Warning | `Result of {label}: comprehension is discarded` |
| [TS9223](./TS9223.md) | Error | `` `yield:` cannot be used as a continuation label inside a generator function `` |
| [TS9224](./TS9224.md) | Warning | `'{label}:' matches the {macro} macro, but its label syntax is not activated in this file` |
| [TS9225](./TS9225.md) | Error | `No {typeclass} instance for '{brand}' is in scope` |
| [TS9226](./TS9226.md) | Error | `Non-exhaustive match — missing {what}: {missing}` |

## Derive

| Code | Severity | Message |
| --- | --- | --- |
| [TS9101](./TS9101.md) | Error | ``Cannot auto-derive {typeclass}<{type}>: field `{field}` has type `{fieldType}` which lacks {typeclass}`` |
| [TS9102](./TS9102.md) *(reserved)* | Error | `@derive({typeclass}) requires an interface, class, or type alias` |
| [TS9103](./TS9103.md) | Error | `@deriving on union types requires a discriminant field` |
| [TS9104](./TS9104.md) | Error | `Cannot derive {typeclass}: type {type} has no fields` |
| [TS9105](./TS9105.md) *(reserved)* | Warning | `@derive(Builder) is not applicable to sum types` |
| [TS9106](./TS9106.md) | Error | `Cannot derive {typeclass} for '{type}'` |

## Higher-Kinded Types

| Code | Severity | Message |
| --- | --- | --- |
| [TS9301](./TS9301.md) *(reserved)* | Error | `` Higher-kinded type {type} must define a `_` property that uses `this["__kind__"]` `` |
| [TS9302](./TS9302.md) | Error | `@hkt can only be applied to interfaces or type aliases` |
| [TS9303](./TS9303.md) | Error | ``@hkt type alias must contain `_` placeholder`` |
| [TS9304](./TS9304.md) | Error | ``@hkt must contain exactly one `_` placeholder, found {count}`` |
| [TS9305](./TS9305.md) | Error | ``Cannot resolve type constructor `{type}` for HKT instance`` |

## Extension Methods

| Code | Severity | Message |
| --- | --- | --- |
| [TS9401](./TS9401.md) *(reserved)* | Error | `No extension method '{method}' found for type '{type}'` |
| [TS9402](./TS9402.md) | Error | `registerExtensions expects 2 arguments: (typeName, namespace)` |
| [TS9403](./TS9403.md) | Error | `registerExtension expects 2 arguments: (typeName, function)` |

## Comptime

| Code | Severity | Message |
| --- | --- | --- |
| [TS9501](./TS9501.md) *(reserved)* | Error | `Compile-time evaluation failed: {error}` |
| [TS9502](./TS9502.md) *(reserved)* | Error | `comptime() requires exactly 1 argument (a function to evaluate)` |

## Import Resolution

| Code | Severity | Message |
| --- | --- | --- |
| [TS9701](./TS9701.md) *(reserved)* | Error | `Did you mean to import '{suggestion}' from '{module}'?` |
| [TS9702](./TS9702.md) *(reserved)* | Warning | ``Operator `{operator}` on {type} is not rewritten in explicit mode`` |
| [TS9703](./TS9703.md) *(reserved)* | Error | `Ambiguous resolution: both '{source1}' and '{source2}' provide '{symbol}'` |

## Operators

| Code | Severity | Message |
| --- | --- | --- |
| [TS9800](./TS9800.md) *(reserved)* | Error | `Operator '{operator}' cannot be overloaded with @operator` |
| [TS9801](./TS9801.md) *(reserved)* | Error | `Binary operator '{operator}' requires exactly 1 parameter (the right operand)` |
| [TS9802](./TS9802.md) *(reserved)* | Error | `Operator '{operator}' is handled by the preprocessor and cannot be registered with @operator` |
| [TS9803](./TS9803.md) *(reserved)* | Warning | `Operator '{operator}' has no registered overload for the operand type` |

## Internal

| Code | Severity | Message |
| --- | --- | --- |
| [TS9999](./TS9999.md) | Error | `Internal error: {message}` |

## service-resolution

| Code | Severity | Message |
| --- | --- | --- |
| [EFFECT001](./EFFECT001.md) | Error | `` No layer provides `{service}` `` |
| [EFFECT002](./EFFECT002.md) *(reserved)* | Error | ``Layer `{layer}` provides `{service}` but implementation is incompatible`` |
| [EFFECT003](./EFFECT003.md) *(reserved)* | Warning | `` Multiple layers provide `{service}` `` |

## error-completeness

| Code | Severity | Message |
| --- | --- | --- |
| [EFFECT010](./EFFECT010.md) *(reserved)* | Warning | `Error handler doesn't cover all error types` |
| [EFFECT011](./EFFECT011.md) *(reserved)* | Info | ``Redundant error handler for `{errorType}` — this error cannot occur`` |

## layer-dependency

| Code | Severity | Message |
| --- | --- | --- |
| [EFFECT020](./EFFECT020.md) | Error | `Circular layer dependency detected` |
| [EFFECT021](./EFFECT021.md) *(reserved)* | Info | ``Layer `{layer}` is provided but not required`` |

## schema-drift

| Code | Severity | Message |
| --- | --- | --- |
| [EFFECT030](./EFFECT030.md) *(reserved)* | Error | `` Schema `{schemaName}` is out of sync with type `{typeName}` `` |

## type-simplification

| Code | Severity | Message |
| --- | --- | --- |
| [EFFECT040](./EFFECT040.md) *(reserved)* | Info | `Effect type could be simplified` |

<!-- prettier-ignore-end -->
<!-- generated:end -->
