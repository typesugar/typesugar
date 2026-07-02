/**
 * Activation marker (PEP-052) — import this module to activate `Default`
 * METHOD syntax (`a.default()`) in the importing file. Additive: it
 * introduces a method name without redefining any native operator. `Default`
 * has no operator form.
 *
 * ```ts
 * import "@typesugar/std/syntax/default";
 * ```
 *
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Default
 */
export const __typesugar_syntax_methods_Default = true;
