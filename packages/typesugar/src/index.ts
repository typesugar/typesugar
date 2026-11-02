/**
 * typesugar - TypeScript Compile-Time Macros
 *
 * Scala 3-style metaprogramming for TypeScript. Write macros that transform
 * code at compile time, eliminating runtime overhead while maintaining
 * type safety.
 *
 * ## Quick Start
 *
 * ```ts
 * // Use built-in macros
 * import { derive, pipe, compose } from "typesugar";
 *
 * // Derive pattern implementations at compile time
 * @derive(Eq, Debug, Clone)
 * class User {
 *   constructor(public id: number, public name: string) {}
 * }
 *
 * // Operator overloading via @op JSDoc on typeclasses
 * /** @typeclass *\/
 * interface Addable<A> {
 *   /** @op + *\/
 *   add(a: A, b: A): A;
 * }
 * // a + b compiles to: addableA.add(a, b)
 *
 * // Function composition
 * const process = pipe(
 *   data,
 *   parse,
 *   validate,
 *   transform
 * ); // Compiles to: transform(validate(parse(data)))
 * ```
 *
 * ## Bundler Integration
 *
 * ```ts
 * // vite.config.ts
 * import typesugar from "unplugin-typesugar/vite";
 *
 * export default {
 *   plugins: [typesugar()],
 * };
 * ```
 *
 * ## What this entry point contains (runtime-safe)
 *
 * This module is what APPLICATION code imports, so it ends up in app
 * bundles. It therefore only re-exports the TypeScript-free runtime stubs
 * (`@typesugar/macros/runtime`) -- it does not import the TypeScript
 * compiler, the macro definitions, or Node built-ins (review finding #16:
 * it used to `import "@typesugar/macros"` for its side effects and
 * `export *` from `@typesugar/core`, pulling ~10 MB including `typescript`
 * into every browser bundle).
 *
 * Macro-AUTHORING APIs (`defineExpressionMacro`, `globalRegistry`,
 * `defineCustomDerive`, `defineSyntaxMacro`, `globalExpansionTracker`, ...)
 * live at `typesugar/core` (or `@typesugar/core` / `@typesugar/macros`).
 * Their types are still re-exported here as types only. Macro definitions
 * are registered by the transformer, which loads macro packages itself.
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

// Core types (type-only: no runtime import of @typesugar/core, which loads
// the TypeScript compiler). Value APIs: `typesugar/core`.
export type * from "@typesugar/core";

// HKT marker type (re-exported from @typesugar/type-system for convenience)
export type { _ } from "@typesugar/type-system";

import type { TypesugarConfig } from "@typesugar/core";

/**
 * Helper for type-safe `typesugar.config.ts` files. Identity at runtime
 * (defined here so a config file importing it from "typesugar" does not
 * load the compiler).
 */
export function defineConfig(cfg: TypesugarConfig): TypesugarConfig {
  return cfg;
}

/**
 * @deprecated No-op. Macros are registered by the transformer, which loads
 * macro packages itself; importing "typesugar" no longer registers them.
 * Tests that need the registry populated should `import "@typesugar/macros"`.
 */
export function registerAllMacros(): void {
  // intentionally empty
}

// ============================================================================
// Runtime stubs (what users import; the transformer replaces the calls)
// ============================================================================

export {
  // Typeclass runtime stubs
  typeclass,
  impl,
  instance,
  deriving,
  summon,
  summonAll,
  extend,
  implicit,
  // Extension method decorator
  extension,
  // Extension registration
  registerExtensions,
  registerExtension,
  // Comptime
  comptime,
  type ComptimePermissions,
  // Derive
  derive,
  // Operators
  pipe,
  compose,
  flow,
  // Reflect
  reflect,
  typeInfo,
  fieldNames,
  validator,
  type ValidationResult,
  // Conditional compilation
  cfg,
  cfgAttr,
  // File includes
  includeStr,
  includeText,
  includeBytes,
  includeJson,
  // Static assert / compile-time diagnostics
  staticAssert,
  compileError,
  compileWarning,
  // Tail recursion
  tailrec,
  // HKT
  hkt,
} from "@typesugar/macros/runtime";

// Derive name markers (@derive(Eq, Ord, ...)). These are runtime values
// that survive in user code after expansion (`import { derive, Eq }` is
// kept), so they must come from a TypeScript-free module too.
export {
  Eq,
  Ord,
  Clone,
  Debug,
  Hash,
  Default,
  Json,
  Builder,
  TypeGuard,
} from "./derive-markers.js";
