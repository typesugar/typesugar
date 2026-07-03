/**
 * Activation marker (PEP-052) — import this module to activate do-notation
 * LABEL syntax in the importing file: `let:`/`seq:` comprehensions (with
 * `yield:`/`pure:`/`return:` continuations) and the parallel `par:`/`all:`
 * form (with `yield:`/`pure:` continuations).
 *
 * ```ts
 * import "@typesugar/std/syntax/do";
 * ```
 *
 * Without this import the labels are left as ordinary JavaScript labeled
 * statements and the transformer warns (TS9224). The markers are carried by
 * the `@syntax-labels` JSDoc tags on the exported constant (a real
 * declaration, so it survives `.d.ts` generation).
 *
 * @syntax-labels letYield
 * @syntax-labels parYield
 */
export const __typesugar_syntax_labels_do = true;
