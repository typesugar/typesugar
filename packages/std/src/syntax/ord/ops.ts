/**
 * Activation marker (PEP-052) — import this module to activate `Ord` OPERATOR
 * syntax (`a < b`, `a <= b`, `a > b`, `a >= b`) in the importing file. Redefines
 * native comparison operators, so it is the louder opt-in. Implies methods.
 *
 * ```ts
 * import "@typesugar/std/syntax/ord/ops";
 * ```
 *
 * @syntax-operators Ord
 */
export const __typesugar_syntax_operators_Ord = true;
