/**
 * Derive name markers (`@derive(Eq, Ord, ...)`).
 *
 * TODO(review #16): these still come from the `@typesugar/macros` ROOT,
 * which loads the TypeScript compiler, because the markers are defined in
 * `macros/src/derive.ts` (a macro module). Once `@typesugar/macros/runtime`
 * exports them (moved to a TypeScript-free module, re-exported by derive.ts
 * so their identity is unchanged), point this file at
 * "@typesugar/macros/runtime" -- nothing else in the umbrella needs to change.
 * Until then, ONLY apps that import a marker pull in the compiler; this file
 * is a separate module so bundlers drop it when no marker is used.
 */
export { Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard } from "@typesugar/macros";
