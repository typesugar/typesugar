/**
 * @typesugar/symbolic
 *
 * Type-safe symbolic mathematics for TypeScript.
 *
 * @example
 * ```typescript
 * import { var_, const_, add, mul, diff, toLatex, evaluate, simplify } from "@typesugar/symbolic";
 *
 * const x = var_("x");
 * const expr = add(mul(x, x), const_(1)); // x² + 1
 *
 * toLatex(expr);           // "x^{2} + 1"
 * diff(expr, "x");         // 2x
 * evaluate(expr, { x: 3 }); // 10
 * simplify(add(x, ZERO));  // x
 * ```
 */

// Re-export Refined type and ValidDivisor used in public signatures (ZERO, div)
export type { Refined } from "@typesugar/type-system";
export { ValidDivisor } from "@typesugar/type-system";

// Core types
export * from "./types.js";
export * from "./expression.js";

// Builders
export * from "./builders.js";

// Rendering
export * from "./render/text.js";
export * from "./render/latex.js";
export * from "./render/mathml.js";

// Evaluation
export * from "./eval.js";

// Calculus
export * from "./calculus/diff.js";
export * from "./calculus/integrate.js";
export * from "./calculus/limit.js";

// Simplification
export * from "./simplify/simplify.js";
export * from "./simplify/rules.js";

// Pattern matching and solving
export * from "./pattern.js";
export * from "./solve.js";
