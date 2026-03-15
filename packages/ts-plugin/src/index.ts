/**
 * TypeScript Language Service Plugin for typesugar
 *
 * This plugin delegates to @typesugar/transformer's language service
 * implementation, which transforms source files before TypeScript processes them.
 *
 * Key features:
 * - Transforms custom syntax (|>, ::, F<_>) to valid TypeScript
 * - Expands macros (@derive, comptime, etc.)
 * - Maps diagnostics, completions, and definitions back to original positions
 * - Caches transformation results for performance
 */

import type * as ts from "typescript";

function init(modules: { typescript: typeof ts }) {
  let transformerPlugin;

  try {
    transformerPlugin = require("@typesugar/transformer/language-service");
  } catch {
    // Fallback: resolve from the workspace node_modules via tsserver's own path.
    // The TS server process runs from the workspace's typescript installation,
    // so its executing file path gives us the workspace node_modules location.
    // This handles the case where the VS Code extension ships a stub transformer
    // that doesn't include the bundled language service.
    const path = require("path");
    const tsServerPath = modules.typescript.sys.getExecutingFilePath();
    const nodeModulesRoot = tsServerPath.replace(
      /[/\\]node_modules[/\\].*$/,
      path.sep + "node_modules"
    );
    const fallback = path.join(nodeModulesRoot, "@typesugar/transformer/dist/language-service.cjs");
    transformerPlugin = require(fallback);
  }

  const initFn = transformerPlugin.default || transformerPlugin;
  return initFn(modules);
}

export = init;
