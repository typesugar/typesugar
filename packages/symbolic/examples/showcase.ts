/**
 * @typesugar/symbolic Showcase
 *
 * Self-documenting examples of type-safe symbolic mathematics.
 *
 * Expressions support standard JavaScript operators via Op<> typeclass:
 *
 *   x + y    →  add(x, y)      Op<"+">
 *   x - y    →  sub(x, y)      Op<"-">
 *   x * y    →  mul(x, y)      Op<"*">
 *   x / y    →  div(x, y)      Op<"/">
 *   x ** y   →  pow(x, y)      Op<"**">
 *
 * Builders also accept raw numbers with auto-wrapping:
 *   add(x, 3)  →  x + const_(3)
 *   mul(2, x)  →  const_(2) * x
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import {
  assert,
  typeAssert,
  type Equal,
  type Extends,
  type Not,
} from "@typesugar/testing";

import {
  // Core AST and builders
  const_,
  var_,
  add,
  sub,
  mul,
  div,
  pow,
  neg,
  sqrt,
  sin,
  cos,
  tan,
  exp,
  ln,
  log,
  abs,
  type Expression,

  // Special constants
  PI,
  E,
  ZERO,
  ONE,
  TWO,

  // Calculus constructs
  derivative,
  integral,
  limit,
  sum,
  product,
  equation,

  // Rendering
  toText,
  toLatex,
  toMathML,

  // Evaluation
  evaluate,
  partialEvaluate,
  canEvaluate,

  // Calculus operations
  diff,
  nthDiff,
  integrate,
  tryIntegrate,
  computeLimit,
  leftLimit,
  rightLimit,

  // Simplification
  simplify,
  expand,
  collectTerms,

  // Pattern matching
  match,
  patternVar,
  rule,
  rewrite,

  // Equation solving
  solve,
  solveSystem,

  // Type guards
  isConstant,
  isVariable,
  isBinaryOp,
  isZero,
  isOne,

  // Utilities
  getVariables,
  hasVariable,
  depth,
  nodeCount,

  // Typeclass instance
  numericExpr,
} from "../src/index.js";

// ============================================================================
// 1. EXPRESSION AST - Type-Safe Symbolic Representation
// ============================================================================

// Create symbolic variables
const x = var_("x");
const y = var_("y");
const t = var_("t");

// Expression<T> tracks the result type at compile time
typeAssert<Equal<typeof x, Expression<number>>>();
typeAssert<Equal<typeof PI, Expression<number>>>();

// Build expressions using operators
const THREE = const_(3);
const quadratic = x ** TWO + THREE * x + TWO; // x² + 3x + 2

// Physics: v = 9.8t, s = ½gt²
const G = const_(9.8);
const HALF = const_(0.5);
const velocity = G * t; // v = 9.8t
const position = HALF * G * (t ** TWO); // s = ½gt²

// Type guards for pattern matching on AST nodes
assert(isVariable(x));
assert(isConstant(const_(5)));
assert(isBinaryOp(add(x, y)));
assert(isZero(ZERO));
assert(isOne(ONE));

// Utility functions for AST analysis
assert(getVariables(quadratic).has("x"));
assert(hasVariable(quadratic, "x"));
assert(!hasVariable(quadratic, "y"));
assert(depth(quadratic) === 4);
assert(nodeCount(quadratic) > 5);

// ============================================================================
// 2. RENDERING - Multiple Output Formats
// ============================================================================

// Plain text rendering
assert(toText(x ** TWO) === "x^2");
assert(toText(ONE / x) === "1 / x");
assert(toText(sin(x)) === "sin(x)");

// LaTeX rendering for mathematical documents
const fraction = (x + ONE) / (x - ONE);
assert(toLatex(x ** TWO) === "x^2"); // Single-digit exponents don't need braces
assert(toLatex(sqrt(x)) === "\\sqrt{x}");
assert(toLatex(fraction) === "\\frac{x + 1}{x - 1}");

// Greek letters automatically converted
const theta = var_("theta");
const alpha = var_("alpha");
assert(toLatex(sin(theta)) === "\\sin{\\theta}");
assert(toLatex(alpha) === "\\alpha");

// Subscript notation: x_1 → x₁
const x1 = var_("x_1");
assert(toLatex(x1) === "x_{1}");

// MathML for web display
const mathml = toMathML(x ** TWO);
assert(mathml.includes("<msup>"));
assert(mathml.includes("<mi>x</mi>"));
assert(mathml.includes("<mn>2</mn>"));

// ============================================================================
// 3. EVALUATION - Numeric Computation
// ============================================================================

// Evaluate with variable bindings
const expr = x ** TWO + TWO * x; // x² + 2x
assert(evaluate(expr, { x: 3 }) === 15); // 9 + 6 = 15
assert(evaluate(expr, { x: 0 }) === 0);
assert(evaluate(expr, { x: -1 }) === -1); // 1 - 2 = -1

// Trigonometric evaluation
assert(Math.abs(evaluate(sin(PI), {})) < 1e-10); // sin(π) ≈ 0
assert(Math.abs(evaluate(cos(ZERO), {}) - 1) < 1e-10); // cos(0) = 1
assert(Math.abs(evaluate(tan(ZERO), {})) < 1e-10); // tan(0) = 0

// Absolute value and logarithms
assert(evaluate(abs(neg(const_(5))), {}) === 5); // |-5| = 5
assert(Math.abs(evaluate(log(E), {}) - 1) < 1e-10); // log(e) = 1
assert(Math.abs(evaluate(exp(ONE), {}) - Math.E) < 1e-10); // e¹ = e

// Partial evaluation: substitute known values, keep unknowns symbolic
const partial = partialEvaluate(x + ONE + TWO, {});
// Constants folded: x + 3

// Check if expression can be fully evaluated
assert(!canEvaluate(x, {})); // x unbound
assert(canEvaluate(x, { x: 5 })); // x bound
assert(canEvaluate(ONE + TWO, {})); // pure constants

// Summation and product evaluation
const sumExpr = sum(var_("i"), "i", const_(1), const_(5)); // Σ i from 1 to 5
assert(evaluate(sumExpr, {}) === 15); // 1+2+3+4+5

const prodExpr = product(var_("i"), "i", const_(1), const_(4)); // Π i from 1 to 4
assert(evaluate(prodExpr, {}) === 24); // 4!

// Symbolic calculus constructs (AST nodes for rendering, not computation)
const derivativeNode = derivative(x ** TWO, "x"); // d/dx(x²) - symbolic form
const integralNode = integral(x, "x"); // ∫x dx - symbolic form
const limitNode = limit(sin(x) / x, "x", 0); // lim[x→0] sin(x)/x - symbolic form

// These render nicely but are distinct from the computational functions
assert(toLatex(derivativeNode).includes("frac"));
assert(toText(integralNode).includes("∫"));
assert(toText(limitNode).includes("lim"));

// ============================================================================
// 4. DIFFERENTIATION - Symbolic Calculus
// ============================================================================

// Basic derivative rules
assert(evaluate(diff(const_(5), "x"), {}) === 0); // d/dx(c) = 0
assert(evaluate(diff(x, "x"), {}) === 1); // d/dx(x) = 1
assert(evaluate(diff(var_("y"), "x"), {}) === 0); // d/dx(y) = 0

// Power rule: d/dx(xⁿ) = n·xⁿ⁻¹
const xSquared = x ** TWO;
const dxSquared = simplify(diff(xSquared, "x")); // 2x
assert(evaluate(dxSquared, { x: 3 }) === 6);

const xCubed = x ** THREE;
const dxCubed = simplify(diff(xCubed, "x")); // 3x²
assert(evaluate(dxCubed, { x: 2 }) === 12);

// Product rule: d/dx(f·g) = f'·g + f·g'
const fg = mul(x, x); // x·x = x²
const dfg = simplify(diff(fg, "x")); // 2x
assert(evaluate(dfg, { x: 5 }) === 10);

// Chain rule with transcendentals
const sinX = sin(x);
const dsinX = diff(sinX, "x"); // cos(x)
assert(Math.abs(evaluate(dsinX, { x: 0 }) - 1) < 1e-10);

const expX = exp(x);
const dexpX = diff(expX, "x"); // exp(x)
assert(Math.abs(evaluate(dexpX, { x: 0 }) - 1) < 1e-10);

const lnX = ln(x);
const dlnX = diff(lnX, "x"); // 1/x
assert(Math.abs(evaluate(dlnX, { x: 2 }) - 0.5) < 1e-10);

// Higher-order derivatives
const FOUR = const_(4);
const f = x ** FOUR; // x⁴
const f1 = simplify(diff(f, "x")); // 4x³
const f2 = simplify(nthDiff(f, "x", 2)); // 12x²
const f3 = simplify(nthDiff(f, "x", 3)); // 24x
const f4 = simplify(nthDiff(f, "x", 4)); // 24

assert(evaluate(f2, { x: 1 }) === 12);
assert(evaluate(f3, { x: 1 }) === 24);

// ============================================================================
// 5. INTEGRATION - Symbolic Antiderivatives
// ============================================================================

// Basic integrals
const intConst = integrate(const_(5), "x"); // 5x
assert(evaluate(intConst, { x: 2 }) === 10);

const intX = integrate(x, "x"); // x²/2
assert(evaluate(intX, { x: 4 }) === 8);

const intXSquared = integrate(x ** TWO, "x"); // x³/3
assert(Math.abs(evaluate(intXSquared, { x: 3 }) - 9) < 1e-10);

// Trigonometric integrals
const intSin = integrate(sin(x), "x"); // -cos(x)
assert(Math.abs(evaluate(intSin, { x: 0 }) - -1) < 1e-10);

const intCos = integrate(cos(x), "x"); // sin(x)
assert(Math.abs(evaluate(intCos, { x: Math.PI / 2 }) - 1) < 1e-10);

// Exponential integral
const intExp = integrate(exp(x), "x"); // exp(x)
assert(Math.abs(evaluate(intExp, { x: 1 }) - Math.E) < 1e-10);

// Try-integrate for fallible integration
const result = tryIntegrate(x, "x");
assert(result.success === true);

const hardIntegral = tryIntegrate(mul(sin(x), cos(x)), "x");
assert(hardIntegral.success === false); // Integration by parts not implemented

// ============================================================================
// 6. LIMITS - Approaching Values
// ============================================================================

// Direct substitution
const limDirect = computeLimit(x + ONE, "x", 2);
assert(limDirect.exists);
if (limDirect.exists) {
  assert(evaluate(limDirect.value, {}) === 3);
}

// L'Hôpital's rule: lim[x→0] sin(x)/x = 1
const sinOverX = sin(x) / x;
const limSinOverX = computeLimit(sinOverX, "x", 0);
assert(limSinOverX.exists);
if (limSinOverX.exists) {
  assert(Math.abs(evaluate(limSinOverX.value, {}) - 1) < 1e-10);
}

// One-sided limits
const leftLim = leftLimit(x, "x", 0);
const rightLim = rightLimit(x, "x", 0);
assert(leftLim.exists && rightLim.exists);

// ============================================================================
// 7. SIMPLIFICATION - Algebraic Manipulation
// ============================================================================

// Identity elimination
assert(toText(simplify(x + ZERO)) === "x"); // x + 0 = x
assert(toText(simplify(x * ONE)) === "x"); // x × 1 = x
assert(toText(simplify(x ** ONE)) === "x"); // x¹ = x

// Constant folding
const folded = simplify(TWO + THREE);
assert(isConstant(folded) && folded.value === 5);

// Zero properties
assert(isZero(simplify(x * ZERO))); // x × 0 = 0
assert(isOne(simplify(x ** ZERO))); // x⁰ = 1

// Algebraic identities
assert(isZero(simplify(x - x))); // x - x = 0
assert(isOne(simplify(x / x))); // x / x = 1

// Expand distributive law: (x+1)(x+2) = x² + 3x + 2
const factored = (x + ONE) * (x + TWO);
const expanded = expand(factored);

// Collect like terms: x + x + x = 3x
const collected = collectTerms(x + x + x, "x");

// ============================================================================
// 8. PATTERN MATCHING - Expression Rewriting
// ============================================================================

// Create pattern variables
const $a = patternVar("a");
const $b = patternVar("b");

// Match expressions against patterns
const bindings = match(ONE + x, add($a, $b));
assert(bindings !== null);
if (bindings) {
  assert(isConstant(bindings.get("a")!));
  assert(isVariable(bindings.get("b")!));
}

// Create rewrite rules
const commuteAdd = rule(add($a, $b), add($b, $a)); // a + b → b + a

// Apply rewrite rules
const original = ONE + x; // 1 + x
const rewritten = rewrite(original, [commuteAdd]); // x + 1

// ============================================================================
// 9. EQUATION SOLVING - Finding Roots
// ============================================================================

// Linear equation: 2x + 3 = 7 → x = 2
const SEVEN = const_(7);
const FIVE = const_(5);
const SIX = const_(6);
const linear = equation(TWO * x + THREE, SEVEN);
const linearSol = solve(linear, "x");
assert(linearSol.success);
if (linearSol.success && linearSol.solutions.length > 0) {
  const sol = linearSol.solutions[0];
  assert(isConstant(sol) && sol.value === 2);
}

// Quadratic equation: x² - 5x + 6 = 0 → x = 2 or x = 3
const quadEq = (x ** TWO) - FIVE * x + SIX; // x² - 5x + 6
const quadSol = solve(quadEq, "x");
assert(quadSol.success);
if (quadSol.success) {
  assert(quadSol.solutions.length === 2);
}

// System of linear equations:
//   x + y = 5
//   x - y = 1
// Solution: x = 3, y = 2
const system = solveSystem(
  [
    { left: x + y, right: FIVE },
    { left: x - y, right: ONE },
  ],
  ["x", "y"]
);
assert(system !== null);
if (system) {
  const xVal = system.get("x")!;
  const yVal = system.get("y")!;
  assert(isConstant(xVal) && xVal.value === 3);
  assert(isConstant(yVal) && yVal.value === 2);
}

// ============================================================================
// 10. OPERATOR OVERLOADING
// ============================================================================

// All standard operators work on Expression × Expression
const exprSum = x + y; // → add(x, y)
const exprDiff = x - y; // → sub(x, y)
const exprProd = x * y; // → mul(x, y)
const exprQuot = x / y; // → div(x, y)
const exprPow = x ** y; // → pow(x, y)

typeAssert<Equal<typeof exprSum, Expression<number>>>();
typeAssert<Equal<typeof exprProd, Expression<number>>>();
typeAssert<Equal<typeof exprPow, Expression<number>>>();

// Physics formulas using operators
const mass = var_("m");
const v = var_("v");
const h = var_("h");
const kinetic = HALF * mass * (v ** TWO); // ½mv²
const potential = mass * G * h; // mgh

// The quadratic formula discriminant: b² - 4ac
const a = var_("a");
const b = var_("b");
const c = var_("c");
const discriminantExpr = (b ** TWO) - FOUR * a * c;

// Explicit Numeric instance also available for generic code
const N = numericExpr;
const explicitSum = N.add(x, y);
const explicitNeg = N.negate(x);

// ============================================================================
// 11. PHYSICS EXAMPLE - Kinematics
// ============================================================================

// Position of falling object: s(t) = ½gt²
const pos = HALF * G * (t ** TWO);

// Velocity: v(t) = ds/dt = gt
const vel = simplify(diff(pos, "t"));

// Acceleration: a(t) = dv/dt = g
const acc = simplify(diff(vel, "t"));

// At t=2: position = 19.6m, velocity = 19.6m/s, acceleration = 9.8m/s²
assert(Math.abs(evaluate(pos, { t: 2 }) - 19.6) < 1e-10);
assert(Math.abs(evaluate(vel, { t: 2 }) - 19.6) < 1e-10);
assert(Math.abs(evaluate(acc, { t: 2 }) - 9.8) < 1e-10);

// Newton's second law: F = ma
const force = mass * acc;

// Work done: W = F * d
const d = var_("d");
const work = force * d;

// ============================================================================
// 12. RENDERING SHOWCASE - Publication Quality Output
// ============================================================================

// Complex physics formula: Schrödinger equation term
const hbar = var_("ℏ");
const psi = var_("ψ");
const schrodinger = neg((hbar ** TWO) / (TWO * mass)) * diff(diff(psi, "x"), "x");

// Quadratic formula discriminant
const discriminantRender = (b ** TWO) - FOUR * a * c;
assert(toLatex(discriminantRender) === "b^{2} - 4 a c");

// Euler's identity setup: e^(iπ) + 1 = 0
const i = var_("i");
const eulerExpr = exp(i * PI) + ONE;

console.log("✓ All assertions passed");
