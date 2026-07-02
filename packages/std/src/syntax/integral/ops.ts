/**
 * Activation marker (PEP-052) — import this module to activate `Integral`
 * OPERATOR syntax (`a / b`, `a % b`) in the importing file. This redefines
 * native primitive operators, so it is a separate, louder opt-in than the
 * method form. Importing operators implies methods (tier 3 ⊇ tier 2).
 *
 * ```ts
 * import "@typesugar/std/syntax/integral/ops";
 * ```
 *
 * The activation is carried by the `@syntax-operators` JSDoc tag on the exported
 * marker constant below (attached to a real declaration so it survives `.d.ts`
 * generation — bundlers strip comments on bare `export {}`).
 *
 * @syntax-operators Integral
 */
export const __typesugar_syntax_operators_Integral = true;
