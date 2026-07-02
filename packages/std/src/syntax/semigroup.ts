/**
 * Activation marker (PEP-052) — import this module to activate `Semigroup`
 * METHOD syntax (`a.combine(b)`) in the importing file. Additive: it
 * introduces a method name without redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/semigroup";
 * ```
 *
 * For the louder operator form (`a + b`), import
 * `@typesugar/std/syntax/semigroup/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Semigroup
 */
export const __typesugar_syntax_methods_Semigroup = true;
