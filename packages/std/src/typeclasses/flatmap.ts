/**
 * FlatMap Typeclass — back-compat re-export module.
 *
 * The FlatMap type and its built-in instances live in the runtime-only twin
 * `flatmap-instances.ts` (PEP-050 Case-1 / PEP-052 Wave 3) so the
 * `@typesugar/std/syntax/do` activation marker can re-export them without
 * pulling compile-time machinery into user runtime bundles. This module is
 * kept as a pure re-export for the historical `@typesugar/std/typeclasses/flatmap`
 * import path.
 *
 * Instance resolution for `let:`/`yield:` is scope-based (PEP-052): the macro
 * resolves FlatMap instances via `resolveDoNotationInstance` from
 * `@typesugar/macros` — there is no runtime registry.
 */

export type { FlatMap } from "./flatmap-instances.js";
export {
  flatMapArray,
  flatMapPromise,
  flatMapIterable,
  flatMapAsyncIterable,
} from "./flatmap-instances.js";
