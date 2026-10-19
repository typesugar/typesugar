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

// Method sugar reads `Show`'s method names from its `@typeclass` declaration
// in the PROGRAM. A side-effect import of this marker is often the only fp
// import in the file, so the marker must pull that declaration in itself —
// otherwise `p.show()` stays a plain (failing) call unless the user also
// imports the type (docs review r3 start #4). A type-only re-export keeps
// the marker free of runtime imports.
export type { Show } from "../typeclasses/show.js";
