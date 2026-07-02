/**
 * Activation marker (PEP-052) — import this module to activate `Debug`
 * METHOD syntax (`a.debug()`) in the importing file. Additive: it introduces
 * a method name without redefining any native operator. `Debug` has no
 * operator form.
 *
 * ```ts
 * import "@typesugar/std/syntax/debug";
 * ```
 *
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Debug
 */
export const __typesugar_syntax_methods_Debug = true;
