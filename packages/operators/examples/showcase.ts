/**
 * @typesugar/operators Showcase
 *
 * Self-documenting examples of operator overloading, function composition,
 * and data piping macros.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  ops,
  pipe,
  flow,
  compose,
  registerOperators,
  getOperatorMethod,
  clearOperatorMappings,
} from "../src/index.js";

// ============================================================================
// 1. PIPE - Value-Through-Functions (Left-to-Right)
// ============================================================================

// pipe(value, f, g, h) compiles to h(g(f(value))) — zero-cost, no array allocation

const doubled = pipe(5, (x) => x * 2);
assert(doubled === 10, "pipe with one function");
typeAssert<Equal<typeof doubled, number>>();

const transformed = pipe(
  "hello world",
  (s) => s.split(" "),
  (words) => words.map((w) => w.toUpperCase()),
  (words) => words.join("-"),
);
assert(transformed === "HELLO-WORLD", "pipe chains multiple transforms");
typeAssert<Equal<typeof transformed, string>>();

// pipe with a single value is identity
const identity = pipe(42);
assert(identity === 42, "pipe with no functions is identity");

// Multi-step data processing pipeline
const processScores = (scores: number[]) =>
  pipe(
    scores,
    (arr) => arr.filter((n) => n >= 0),
    (arr) => arr.sort((a, b) => a - b),
    (arr) => arr.slice(1, -1),           // trim outliers
    (arr) => arr.reduce((a, b) => a + b, 0) / arr.length,
  );

assert(processScores([100, 20, 30, 40, 50, -5]) === 35, "pipe for data processing");

// ============================================================================
// 2. FLOW - Compose Functions Left-to-Right
// ============================================================================

// flow(f, g, h) compiles to (x) => h(g(f(x))) — creates a reusable pipeline

const increment = (x: number) => x + 1;
const double = (x: number) => x * 2;
const negate = (x: number) => -x;

const incDoublNeg = flow(increment, double, negate);
assert(incDoublNeg(3) === -8, "flow composes left-to-right: (3+1)*2 = 8, neg = -8");
typeAssert<Equal<ReturnType<typeof incDoublNeg>, number>>();

// flow with a single function is that function
const singleFlow = flow((x: number) => x + 1);
assert(singleFlow(10) === 11, "flow with single function");

// Real-world: build a text normalizer
const normalizeText = flow(
  (s: string) => s.trim(),
  (s) => s.toLowerCase(),
  (s) => s.replace(/\s+/g, " "),
);
assert(normalizeText("  Hello   World  ") === "hello world", "flow for text normalization");

// ============================================================================
// 3. COMPOSE - Compose Functions Right-to-Left (Mathematical Order)
// ============================================================================

// compose(f, g, h) compiles to (x) => f(g(h(x))) — mathematical composition order

const addTen = (x: number) => x + 10;
const stringify = (x: number) => `[${x}]`;

const composed = compose(stringify, addTen, double);
// Evaluation: double(5) = 10, addTen(10) = 20, stringify(20) = "[20]"
assert(composed(5) === "[20]", "compose applies right-to-left");
typeAssert<Equal<ReturnType<typeof composed>, string>>();

// compose with single function
const singleCompose = compose((x: number) => x * 3);
assert(singleCompose(7) === 21, "compose with single function");

// ============================================================================
// 4. OPS - Operator-to-Method Rewriting
// ============================================================================

// ops(expr) rewrites binary operators to method calls at compile time.
// At runtime (without transformer), ops() is a pass-through.

// The ops() macro depends on @operators registrations happening at compile time.
// Here we demonstrate the runtime registration API directly.

clearOperatorMappings();

registerOperators("Vector2D", {
  "+": "add",
  "-": "sub",
  "*": "scale",
  "==": "equals",
});

// Verify registration
assert(getOperatorMethod("Vector2D", "+") === "add", "registered + operator");
assert(getOperatorMethod("Vector2D", "-") === "sub", "registered - operator");
assert(getOperatorMethod("Vector2D", "*") === "scale", "registered * operator");
assert(getOperatorMethod("Vector2D", "==") === "equals", "registered == operator");
assert(getOperatorMethod("Vector2D", "/") === undefined, "unregistered operator returns undefined");
assert(getOperatorMethod("UnknownType", "+") === undefined, "unknown type returns undefined");

// ============================================================================
// 5. REGISTER OPERATORS - Operator Mapping API
// ============================================================================

// Multiple registrations merge (don't overwrite)
registerOperators("Matrix", { "+": "add", "*": "mul" });
registerOperators("Matrix", { "-": "sub", "**": "pow" });

assert(getOperatorMethod("Matrix", "+") === "add", "first registration preserved");
assert(getOperatorMethod("Matrix", "-") === "sub", "second registration merged");
assert(getOperatorMethod("Matrix", "**") === "pow", "exponentiation operator");

// Override an existing mapping
registerOperators("Matrix", { "+": "addNew" });
assert(getOperatorMethod("Matrix", "+") === "addNew", "override replaces old mapping");

// clearOperatorMappings resets everything
clearOperatorMappings();
assert(getOperatorMethod("Matrix", "+") === undefined, "clearOperatorMappings wipes all");

// ============================================================================
// 6. PIPE TYPE SAFETY - Types Flow Through the Chain
// ============================================================================

// Each step in pipe narrows/transforms the type
const result = pipe(
  [1, 2, 3, 4, 5],
  (arr) => arr.filter((n) => n % 2 === 0),
  (evens) => evens.length,
  (count) => count > 0,
);

typeAssert<Equal<typeof result, boolean>>();
assert(result === true, "pipe type narrows through chain");

// pipe preserves generic type inference
const parseAndTransform = pipe(
  '{"x": 1, "y": 2}',
  (s) => JSON.parse(s) as { x: number; y: number },
  (obj) => obj.x + obj.y,
);
typeAssert<Equal<typeof parseAndTransform, number>>();
assert(parseAndTransform === 3, "pipe preserves complex types");

// ============================================================================
// 7. FLOW AND COMPOSE TYPE SAFETY
// ============================================================================

// flow infers the composite function signature
const strToNum = flow(
  (s: string) => s.length,
  (n) => n * 2,
);
typeAssert<Equal<typeof strToNum, (a: string) => number>>();
assert(strToNum("hello") === 10, "flow infers (string) => number");

// compose infers correctly in reverse order
const numToStr = compose(
  (n: number) => `#${n}`,
  (s: string) => s.length,
);
typeAssert<Equal<typeof numToStr, (a: string) => string>>();
assert(numToStr("test") === "#4", "compose infers (string) => string");

// ============================================================================
// 8. REAL-WORLD EXAMPLE - HTTP Request Pipeline
// ============================================================================

interface Request {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

const addAuth = (req: Request): Request => ({
  ...req,
  headers: { ...req.headers, Authorization: "Bearer token123" },
});

const addContentType = (req: Request): Request => ({
  ...req,
  headers: { ...req.headers, "Content-Type": "application/json" },
});

const addBody = (data: object) => (req: Request): Request => ({
  ...req,
  body: JSON.stringify(data),
});

const prepareRequest = flow(addAuth, addContentType, addBody({ user: "alice" }));

const req = prepareRequest({ url: "/api/users", headers: {} });
assert(req.headers.Authorization === "Bearer token123", "auth header added");
assert(req.headers["Content-Type"] === "application/json", "content-type added");
assert(req.body === '{"user":"alice"}', "body serialized");
typeAssert<Equal<typeof req, Request>>();
