/**
 * Activation marker (PEP-052) — import this module to activate `Integral`
 * METHOD syntax (`a.div(b)`, `a.mod(b)`) in the importing file. Additive: it
 * introduces method names without redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/integral";
 * ```
 *
 * For the louder operator form (`a / b`, `a % b`), import
 * `@typesugar/std/syntax/integral/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Integral
 */
export const __typesugar_syntax_methods_Integral = true;
