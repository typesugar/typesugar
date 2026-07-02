/**
 * Activation marker (PEP-052) — import this module to activate `Numeric`
 * METHOD syntax (`a.add(b)`, `a.sub(b)`, `a.mul(b)`, `a.div(b)`, `a.pow(b)`)
 * in the importing file. Additive: it introduces method names without
 * redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/numeric";
 * ```
 *
 * For the louder operator form (`a + b`, `a - b`, `a * b`, `a / b`, `a ** b`),
 * import `@typesugar/std/syntax/numeric/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Numeric
 */
export const __typesugar_syntax_methods_Numeric = true;
