/**
 * Activation marker (PEP-052) — import this module to activate `Clone`
 * METHOD syntax (`a.clone()`) in the importing file. Additive: it introduces
 * a method name without redefining any native operator. `Clone` has no
 * operator form.
 *
 * ```ts
 * import "@typesugar/std/syntax/clone";
 * ```
 *
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Clone
 */
export const __typesugar_syntax_methods_Clone = true;
