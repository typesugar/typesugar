/**
 * @typesugar/lsp-server — library entry (the package's "." export).
 *
 * Importing this module has NO side effects: it does not open an LSP
 * connection. The server itself is started by the `typesugar-lsp` bin (which
 * runs `dist/server.js`) or by running `dist/server.cjs` /
 * `dist/server-bundled.cjs` as a script. `server.ts` opens the connection at
 * module load, so it must never be re-exported from here.
 */

export {
  uriToFileName,
  fileNameToUri,
  normalizeFileName,
  offsetToPosition,
  positionToOffset,
  getDecoratorName,
  textSpanToRange,
  mapTsDiagnosticToOriginal,
  type ToOriginalMapper,
} from "./helpers.js";
export { ManifestState, type MacroManifest } from "./manifest.js";
export {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  getSemanticTokensLegend,
  computeSemanticTokens,
} from "./semantic-tokens.js";
export { computeCodeLenses } from "./codelens.js";
export { computeInlayHints } from "./inlay-hints.js";
export { computeExtraCodeActions } from "./code-actions-extra.js";
