/**
 * Activation marker (PEP-052) — import this module to activate `TypeGuard`
 * METHOD syntax (`A.is(value)`) in the importing file. Additive: it
 * introduces a method name without redefining any native operator.
 * `TypeGuard` has no operator form.
 *
 * ```ts
 * import "@typesugar/std/syntax/type-guard";
 * ```
 *
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods TypeGuard
 */
export const __typesugar_syntax_methods_TypeGuard = true;
