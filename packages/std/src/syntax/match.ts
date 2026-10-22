/**
 * Activation marker (PEP-052) — import this module to activate the `match:`
 * statement form of pattern matching in the importing file:
 *
 * ```ts
 * import "@typesugar/std/syntax/match";
 *
 * match: switch (geom.type) {
 *   case "Point": ...; break;
 *   case "LineString": ...; break;
 * }
 * ```
 *
 * Without this import the label is an ordinary JavaScript label on a plain
 * switch and the transformer warns (TS9224). The marker has nothing to run,
 * so the transformer removes this import from its output (no runtime import
 * of `@typesugar/std`). The marker is carried by the `@syntax-labels` JSDoc
 * tag on the exported constant (a real declaration, so it survives `.d.ts`
 * generation).
 *
 * @syntax-labels matchSwitch
 */
export const __typesugar_syntax_labels_match = true;
