/**
 * @typesugar/preprocessor - Lexical preprocessor for typesugar syntax extensions
 *
 * This package provides a lexical preprocessing layer that transforms custom
 * syntax (HKT F<_>, pipeline |>, cons ::) into valid TypeScript before the
 * macro transformer runs.
 *
 * @example
 * ```typescript
 * import { preprocess } from "@typesugar/preprocessor";
 *
 * const source = `
 *   interface Functor<F<_>> {
 *     map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
 *   }
 *
 *   const result = x |> f |> g;
 * `;
 *
 * const { code, changed, sourceMap } = preprocess(source);
 * // code is now valid TypeScript with F<A> rewritten to $<F, A>
 * // and |> rewritten to __binop__ calls
 * ```
 *
 * @packageDocumentation
 */

// Main entry point
export { preprocess, type PreprocessOptions } from "./preprocess.js";
export { default } from "./preprocess.js";

// Scanner
export {
  tokenize,
  isBoundaryToken,
  isOpenBracket,
  isCloseBracket,
  getMatchingClose,
  type Token,
  type CustomOperatorDef,
  type ScannerOptions,
} from "./scanner.js";

// Token stream
export { TokenStream } from "./token-stream.js";

// Extension types
export type {
  SyntaxExtension,
  CustomOperatorExtension,
  Replacement,
  RawSourceMap,
  PreprocessResult,
  RewriteOptions,
} from "./extensions/types.js";
export { isCustomOperatorExtension } from "./extensions/types.js";

// Built-in extensions
export { hktExtension } from "./extensions/hkt.js";
export { pipelineExtension } from "./extensions/pipeline.js";
export { consExtension } from "./extensions/cons.js";
export { decoratorRewriteExtension } from "./extensions/decorator-rewrite.js";
