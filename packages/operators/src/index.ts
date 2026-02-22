/**
 * @typesugar/operators - Operator Overloading Macros
 *
 * This package re-exports operator functionality from @typesugar/macros.
 * It provides:
 * - @operators decorator for enabling operator overloading
 * - ops() for transforming operator expressions
 * - pipe() for function piping
 * - compose() for function composition
 *
 * @example
 * ```typescript
 * import { operators, ops, pipe, compose } from "@typesugar/operators";
 *
 * @operators({ "+": "add", "*": "mul" })
 * class Vec2 {
 *   constructor(public x: number, public y: number) {}
 *   add(other: Vec2): Vec2 { return new Vec2(this.x + other.x, this.y + other.y); }
 *   mul(scalar: number): Vec2 { return new Vec2(this.x * scalar, this.y * scalar); }
 * }
 *
 * const result = ops(v1 + v2 * 2);
 * // Compiles to: v1.add(v2.mul(2))
 *
 * const processed = pipe(data, parse, validate, transform);
 * // Compiles to: transform(validate(parse(data)))
 * ```
 *
 * @module
 */

// Re-export everything from @typesugar/macros that relates to operators

// Runtime stubs
export { operators, ops, pipe, compose, flow } from "@typesugar/macros";

// Macro definitions
export { operatorsAttribute, opsMacro, pipeMacro, composeMacro } from "@typesugar/macros";

// Operator registration and lookup
export {
  registerOperators,
  getOperatorMethod,
  getOperatorString,
  clearOperatorMappings,
} from "@typesugar/macros";
