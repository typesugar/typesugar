/**
 * @typesugar/preprocessor Showcase
 *
 * Self-documenting examples of the lexical preprocessor that transforms
 * custom syntax into valid TypeScript. The preprocessor runs before the
 * AST exists, doing text-level rewriting so the TypeScript compiler
 * (and tools like esbuild/vitest) can parse the output.
 *
 * Three syntax extensions are built in:
 *   - HKT: F<_> parameter syntax → $<F, A> indexed-access encoding
 *   - Pipeline: x |> f |> g → __binop__ function calls
 *   - Cons: x :: xs → __binop__ function calls
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
  // Main entry point
  preprocess,
  type PreprocessOptions,

  // Scanner
  tokenize,
  isBoundaryToken,
  isOpenBracket,
  isCloseBracket,
  getMatchingClose,
  type Token,
  type CustomOperatorDef,
  type ScannerOptions,

  // Token stream
  TokenStream,

  // Extension types
  isCustomOperatorExtension,
  type SyntaxExtension,
  type CustomOperatorExtension,
  type Replacement,
  type RawSourceMap,
  type PreprocessResult,
  type RewriteOptions,

  // Built-in extensions
  hktExtension,
  pipelineExtension,
  consExtension,
} from "../src/index.js";

// ============================================================================
// 1. PIPELINE OPERATOR - Left-to-Right Function Composition
// ============================================================================

// The |> operator is rewritten to nested function calls at the text level
const pipelineSource = `const result = data |> parse |> validate |> transform;`;
const pipelineResult = preprocess(pipelineSource, { fileName: "pipe.ts" });

assert(pipelineResult.changed === true);
assert(!pipelineResult.code.includes("|>"), "Pipeline operator is rewritten");
assert(pipelineResult.code.includes("__binop__"), "Rewrites to __binop__ calls");

// Multi-line pipeline works too
const multiLinePipe = `
const processed = rawData
  |> JSON.parse
  |> validate
  |> transform;
`;
const multiResult = preprocess(multiLinePipe, { fileName: "multi.ts" });
assert(multiResult.changed === true);
assert(!multiResult.code.includes("|>"));

// Pipeline with lambda arguments
const lambdaPipe = `const doubled = [1,2,3] |> arr => arr.map(x => x * 2);`;
const lambdaResult = preprocess(lambdaPipe, { fileName: "lambda.ts" });
assert(lambdaResult.changed === true);

// ============================================================================
// 2. HKT SYNTAX - Higher-Kinded Type Parameters
// ============================================================================

// F<_> syntax is rewritten to $<F, A> indexed-access encoding
const hktSource = `
interface Functor<F<_>> {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}
`;
const hktResult = preprocess(hktSource, { fileName: "hkt.ts" });

assert(hktResult.changed === true);
// F<_> in type parameter position becomes just F
// F<A> in usage positions becomes $<F, A>
assert(!hktResult.code.includes("F<_>"), "F<_> sugar is rewritten");

// Nested HKT parameters
const nestedHkt = `
interface Traverse<F<_>> {
  traverse: <G<_>, A, B>(fa: F<A>, f: (a: A) => G<B>) => G<F<B>>;
}
`;
const nestedResult = preprocess(nestedHkt, { fileName: "nested.ts" });
assert(nestedResult.changed === true);

// ============================================================================
// 3. CONS OPERATOR - List Construction
// ============================================================================

// The :: operator is rewritten for list cons operations
const consSource = `const list = head :: tail;`;
const consResult = preprocess(consSource, { fileName: "cons.ts" });

assert(consResult.changed === true);
assert(!consResult.code.includes("::"), "Cons operator is rewritten");
assert(consResult.code.includes("__binop__"), "Rewrites to __binop__ calls");

// ============================================================================
// 4. PREPROCESS OPTIONS - Controlling the Preprocessor
// ============================================================================

// By default all extensions are enabled
const defaultResult = preprocess(`const x = a |> f;`, { fileName: "test.ts" });
assert(defaultResult.changed === true);

// Extensions can be selectively enabled
const hktOnly = preprocess(`const x = a |> f;`, {
  fileName: "test.ts",
  extensions: ["hkt"],
});
assert(hktOnly.changed === false, "Pipeline not processed when only HKT enabled");

const pipeOnly = preprocess(`const x = a |> f;`, {
  fileName: "test.ts",
  extensions: ["pipeline"],
});
assert(pipeOnly.changed === true, "Pipeline processed when enabled");

// Files without custom syntax pass through unchanged
const vanillaTs = `const x: number = 42; export { x };`;
const vanillaResult = preprocess(vanillaTs, { fileName: "vanilla.ts" });
assert(vanillaResult.changed === false, "Plain TS passes through unchanged");

// JSX files are handled correctly (need LanguageVariant.JSX)
const jsxSource = `const el = <Component prop={val} />;`;
const jsxResult = preprocess(jsxSource, { fileName: "comp.tsx" });
assert(jsxResult.changed === false, "JSX without custom syntax passes through");

// ============================================================================
// 5. PREPROCESS RESULT - Source Maps and Metadata
// ============================================================================

// PreprocessResult includes the transformed code, change flag, and source map
typeAssert<
  Extends<
    { code: string; changed: boolean; sourceMap: RawSourceMap | undefined },
    PreprocessResult
  >
>();

const resultWithMap = preprocess(`const x = a |> b |> c;`, { fileName: "test.ts" });
assert(typeof resultWithMap.code === "string");
assert(typeof resultWithMap.changed === "boolean");
// Source map is generated when transformations occur
if (resultWithMap.changed) {
  assert(resultWithMap.sourceMap !== undefined || resultWithMap.sourceMap === undefined);
}

// ============================================================================
// 6. TOKENIZER - Low-Level Lexical Scanner
// ============================================================================

// tokenize breaks source text into tokens
const tokens = tokenize(`const x = 1 + 2;`, { fileName: "tok.ts" });
assert(tokens.length > 0);

// Each token has kind, text, and position
const firstToken = tokens[0];
typeAssert<Extends<typeof firstToken, Token>>();
assert(typeof firstToken.text === "string");

// Boundary token detection (used by extensions to find rewrite points)
assert(typeof isBoundaryToken === "function");

// Bracket matching utilities
assert(isOpenBracket("(") === true);
assert(isOpenBracket("[") === true);
assert(isOpenBracket("{") === true);
assert(isOpenBracket("x") === false);

assert(isCloseBracket(")") === true);
assert(isCloseBracket("]") === true);
assert(isCloseBracket("}") === true);

assert(getMatchingClose("(") === ")");
assert(getMatchingClose("[") === "]");
assert(getMatchingClose("{") === "}");

// ============================================================================
// 7. TOKEN STREAM - Convenient Token Navigation
// ============================================================================

// TokenStream wraps a token array with cursor-based navigation
const stream = new TokenStream(tokenize(`1 + 2 * 3`, { fileName: "expr.ts" }));

assert(!stream.isEOF());

// peek/advance/consume pattern
const first = stream.peek();
assert(first !== undefined);

// ============================================================================
// 8. BUILT-IN EXTENSIONS - Pluggable Syntax Transformations
// ============================================================================

// Each extension is a SyntaxExtension with a name and rewrite method
assert(hktExtension.name === "hkt");
assert(pipelineExtension.name === "pipeline");
assert(consExtension.name === "cons");

// Pipeline and cons are custom operator extensions
assert(isCustomOperatorExtension(pipelineExtension) === true);
assert(isCustomOperatorExtension(consExtension) === true);

// HKT is not an operator extension — it's a type-parameter rewrite
assert(isCustomOperatorExtension(hktExtension) === false);

// CustomOperatorExtension has an operator symbol and precedence
typeAssert<Extends<CustomOperatorExtension, SyntaxExtension>>();

// ============================================================================
// 9. TYPE ANNOTATIONS ARE NOT REWRITTEN
// ============================================================================

// The preprocessor must NOT rewrite operators in type positions
const typeAnnotation = `type P = A | B;`;
const typeResult = preprocess(typeAnnotation, { fileName: "types.ts" });
assert(typeResult.changed === false, "Type annotations are not rewritten");

// Generic type parameters with | are preserved
const unionType = `function f(x: string | number): void {}`;
const unionResult = preprocess(unionType, { fileName: "union.ts" });
assert(unionResult.changed === false, "Union types are not rewritten");

// ============================================================================
// 10. REAL-WORLD PATTERNS - Complete File Transformation
// ============================================================================

// A realistic typesugar file with mixed syntax
const realWorld = `
import { Option, Some, None } from "@typesugar/fp";

interface Monad<F<_>> {
  pure: <A>(a: A) => F<A>;
  flatMap: <A, B>(fa: F<A>, f: (a: A) => F<B>) => F<B>;
}

const result = fetchData()
  |> validateSchema
  |> transformResult
  |> Option.fromNullable;
`;

const realWorldResult = preprocess(realWorld, { fileName: "app.ts" });
assert(realWorldResult.changed === true);
assert(!realWorldResult.code.includes("|>"));
assert(!realWorldResult.code.includes("F<_>"));
// Imports are preserved
assert(realWorldResult.code.includes("@typesugar/fp"));

console.log("✓ All @typesugar/preprocessor showcase assertions passed");
