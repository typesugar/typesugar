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

// Local definition of Refined type to avoid loading @typesugar/type-system's macro code
// (The type-system package bundles macro code that imports 'typescript', causing import hangs)
declare const __refined__: unique symbol;
export type Refined<Base, Brand extends string> = Base & {
  readonly [__refined__]: Brand;
};

// Local definition of ValidDivisor to avoid @typesugar/type-system import
export type ValidDivisor = Refined<number, "ValidDivisor">;

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
