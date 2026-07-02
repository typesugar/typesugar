/**
 * Activation marker (PEP-052) — import this module to activate `Eq` METHOD
 * syntax (`a.equals(b)` / `a.notEquals(b)`) in the importing file. Additive:
 * it introduces method names without redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/eq";
 * ```
 *
 * For the louder operator form (`a === b`), import `@typesugar/std/syntax/eq/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Eq
 */
export const __typesugar_syntax_methods_Eq = true;
