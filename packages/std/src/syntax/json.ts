/**
 * Activation marker (PEP-052) — import this module to activate `Json`
 * METHOD syntax (`a.toJson()`, `A.fromJson(json)`) in the importing file.
 * Additive: it introduces method names without redefining any native
 * operator. `Json` has no operator form.
 *
 * ```ts
 * import "@typesugar/std/syntax/json";
 * ```
 *
 * The marker is carried by the `@syntax-methods` JSDoc on the exported constant
 * (a real declaration, so it survives `.d.ts` generation).
 *
 * @syntax-methods Json
 */
export const __typesugar_syntax_methods_Json = true;
