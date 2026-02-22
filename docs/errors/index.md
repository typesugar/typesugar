# Error Reference

This section documents all typesugar diagnostic codes in the `TS9xxx` range. Each error includes an explanation of the problem and common fixes.

## Quick Reference

Use the `--explain` CLI flag to get detailed information about any error code:

```bash
npx typesugar --explain TS9001
```

## Error Code Ranges

| Range         | Category             | Description                                                                 |
| ------------- | -------------------- | --------------------------------------------------------------------------- |
| TS9001-TS9099 | Typeclass Resolution | Errors related to `summon()`, `@instance`, `@deriving`, implicit resolution |
| TS9101-TS9199 | Derive Failures      | Errors when auto-deriving typeclass instances                               |
| TS9201-TS9299 | Macro Syntax         | Syntax errors in macro usage                                                |
| TS9301-TS9399 | HKT                  | Higher-kinded type errors                                                   |
| TS9401-TS9499 | Extension Methods    | Errors with standalone extension methods                                    |
| TS9501-TS9599 | Comptime             | Compile-time evaluation errors                                              |
| TS9701-TS9799 | Import Resolution    | Import and module resolution errors                                         |
| TS9801-TS9899 | Operators            | Operator overloading errors                                                 |
| TS9901-TS9999 | Internal             | Internal compiler errors                                                    |

## Typeclass Resolution Errors (TS9001-TS9099)

- [TS9001](./TS9001.md) - No instance found for typeclass
- [TS9002](./TS9002.md) - Ambiguous typeclass instances
- [TS9003](./TS9003.md) - Invalid @instance declaration
- [TS9004](./TS9004.md) - Instance type mismatch
- [TS9005](./TS9005.md) - Missing type arguments for summon
- [TS9006](./TS9006.md) - Instance already exists (warning)
- [TS9007](./TS9007.md) - Typeclass not found
- [TS9008](./TS9008.md) - Invalid extends clause
- [TS9009](./TS9009.md) - @implicits found no implicit parameters (warning)

### Import Suggestions (TS9060-TS9069)

- TS9060 - Typeclass not in scope (with import suggestion)
- TS9061 - Macro not defined (with import suggestion)
- TS9062 - Extension method not found for type (with import suggestion)
- TS9063 - Import suggestion hint (info)

## Derive Errors (TS9101-TS9199)

- [TS9101](./TS9101.md) - Cannot derive for type
- [TS9102](./TS9102.md) - Missing field instance
- [TS9103](./TS9103.md) - Unsupported field type
- [TS9104](./TS9104.md) - Circular derivation
- [TS9105](./TS9105.md) - Field requires custom instance (warning)

## Macro Syntax Errors (TS9201-TS9299)

- [TS9201](./TS9201.md) - Invalid macro argument count
- [TS9202](./TS9202.md) - Invalid macro argument type
- [TS9203](./TS9203.md) - Invalid target for decorator
- [TS9204](./TS9204.md) - Missing type arguments
- [TS9205](./TS9205.md) - Invalid expression
- [TS9206](./TS9206.md) - Invalid block expression
- [TS9207](./TS9207.md) - Not a compile-time constant
- [TS9208](./TS9208.md) - Invalid type annotation
- [TS9209](./TS9209.md) - Invalid function signature
- [TS9210](./TS9210.md) - Unknown derive
- [TS9211](./TS9211.md) - Cannot specialize
- [TS9212](./TS9212.md) - Static assert failed
- [TS9213](./TS9213.md) - Not tail recursive
- [TS9214](./TS9214.md) - Invalid cfg condition
- [TS9215](./TS9215.md) - Generic field extraction failed
- [TS9216](./TS9216.md) - Invalid contract
- [TS9217](./TS9217.md) - Method not found
- [TS9218](./TS9218.md) - Unused derive (warning)
- [TS9219](./TS9219.md) - Invalid reflect target
- [TS9220](./TS9220.md) - Module graph error
- [TS9221](./TS9221.md) - Custom derive error

## HKT Errors (TS9301-TS9399)

- [TS9301](./TS9301.md) - Invalid HKT parameter
- [TS9302](./TS9302.md) - HKT kind mismatch

## Extension Method Errors (TS9401-TS9499)

- [TS9401](./TS9401.md) - Extension method not found
- [TS9402](./TS9402.md) - Ambiguous extension method
- [TS9403](./TS9403.md) - Invalid extension registration

## Comptime Errors (TS9501-TS9599)

- [TS9501](./TS9501.md) - Comptime evaluation failed
- [TS9502](./TS9502.md) - Include file not found

## Import Resolution Errors (TS9701-TS9799)

- [TS9701](./TS9701.md) - Missing import
- [TS9702](./TS9702.md) - Unused import (warning)
- [TS9703](./TS9703.md) - Invalid import source

## Operator Errors (TS9801-TS9899)

- [TS9800](./TS9800.md) - Operator not defined
- [TS9801](./TS9801.md) - Invalid operator method
- [TS9802](./TS9802.md) - Ambiguous operator
- [TS9803](./TS9803.md) - Unknown custom operator (warning)

## Internal Errors (TS9901-TS9999)

- [TS9999](./TS9999.md) - Internal error

## Reporting Issues

If you encounter an error that isn't documented here, or if the suggested fixes don't resolve your issue, please [open an issue](https://github.com/typesugar/typesugar/issues) with:

1. The full error message
2. A minimal reproduction
3. Your typesugar version (`npx typesugar --version`)
