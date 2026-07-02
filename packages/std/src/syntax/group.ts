/**
 * Activation marker (PEP-052) — import this module to activate `Group`
 * METHOD syntax (`a.combine(b)`, `a.inverse()`) in the importing file.
 * Additive: it introduces method names without redefining any native operator.
 *
 * ```ts
 * import "@typesugar/std/syntax/group";
 * ```
 *
 * For the louder operator form (`a + b`), import
 * `@typesugar/std/syntax/group/ops`.
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Group
 */
export const __typesugar_syntax_methods_Group = true;
