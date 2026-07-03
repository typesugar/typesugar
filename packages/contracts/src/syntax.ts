/**
 * Activation marker (PEP-052) — import this module to activate contract-block
 * LABEL syntax (`requires:` / `ensures:` blocks implicitly applying
 * `@contract`) in the importing file.
 *
 * ```ts
 * import "@typesugar/contracts/syntax";
 * ```
 *
 * Without this import the labels are left as ordinary JavaScript labeled
 * statements (dead code) and the transformer warns (TS9224). The marker is
 * carried by the `@syntax-labels` JSDoc tag on the exported constant (a real
 * declaration, so it survives `.d.ts` generation).
 *
 * @syntax-labels contract
 */
export const __typesugar_syntax_labels_contract = true;
