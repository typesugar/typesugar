/**
 * Activation marker (PEP-052 Wave 5) — import this module to activate `Show`
 * METHOD syntax (`a.show()`) in the importing file.
 *
 * ```ts
 * import "@typesugar/fp/syntax/show";
 * ```
 *
 * `Show` has no operator form (there is no native operator to redefine for
 * "stringify this value") — method syntax is the only tier. The marker is
 * carried by the `@syntax-methods` JSDoc on the exported constant (a real
 * declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Show
 */
export const __typesugar_syntax_methods_Show = true;
