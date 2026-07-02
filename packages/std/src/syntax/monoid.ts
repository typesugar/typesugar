/**
 * Activation marker (PEP-052) — import this module to activate `Monoid`
 * METHOD syntax (`a.combine(b)`) in the importing file. Additive: it
 * introduces a method name without redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/monoid";
 * ```
 *
 * For the louder operator form (`a + b`), import
 * `@typesugar/std/syntax/monoid/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Monoid
 */
export const __typesugar_syntax_methods_Monoid = true;
