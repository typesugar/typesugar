/**
 * @typesugar/lsp-common — Shared IDE infrastructure
 *
 * Utilities consumed by both the LSP server (packages/lsp-server) and the
 * TS plugin language service (packages/transformer/language-service.ts).
 *
 * @see PEP-034 Wave 2
 */

// Position mapping
export {
  mapTextSpanToOriginal,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapping.js";

// Position conversion helpers
export {
  offsetToPosition,
  positionToOffset,
  textSpanToRange,
  type Position,
  type Range,
} from "./position-helpers.js";

// AST helpers
export { findNodeAtOffset, findAncestor, getDecoratorName } from "./ast-helpers.js";

// Macro-specific code actions
export {
  computeMacroCodeActions,
  type MacroCodeAction,
  type MacroManifest,
} from "./code-actions.js";
