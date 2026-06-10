/**
 * @typesugar/preprocessor - Lexical preprocessor for HKT type syntax
 *
 * This package provides a lexical preprocessing layer that transforms HKT
 * type-parameter syntax (`F<_>`) into valid TypeScript (`Kind<F, A>`) before
 * the macro transformer runs, and exposes the shared source-map types used by
 * the transformer pipeline.
 *
 * @example
 * ```typescript
 * import { preprocess } from "@typesugar/preprocessor";
 *
 * const source = `
 *   interface Functor<F<_>> {
 *     map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
 *   }
 * `;
 *
 * const { code, changed, sourceMap } = preprocess(source);
 * // code is now valid TypeScript with F<A> rewritten to Kind<F, A>
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

// HKT Registry and Import Tracking
export {
  HKT_OPERATOR_PACKAGES,
  HKT_TYPE_FUNCTIONS,
  isKnownTypeFunction,
  getTypeFunction,
  getConcreteType,
  isHKTOperatorPackage,
  isExportedFrom,
  type HKTTypeFunction,
} from "./hkt-registry.js";

export { scanImports, type TrackedImports, type TrackedTypeFunction } from "./import-tracker.js";
