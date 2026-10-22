/**
 * @typesugar/transformer - Main entry point
 *
 * PEP-056: this package's own duplicate macro-dispatch engine has been
 * deleted. The dispatch logic now lives in a single place --
 * @typesugar/transformer-core's MacroTransformer class -- used identically
 * by the CLI (pipeline.ts/cli.ts), the language service, and the browser
 * playground. This file is now a thin barrel re-exporting the package's
 * public surface from wherever each piece actually lives.
 */

import type * as ts from "typescript";
import * as path from "path";
import { config as typesugarConfig } from "@typesugar/core";
import {
  macroTransformerFactory,
  type MacroTransformerConfig,
  type TsPatchTransformerExtras,
} from "./pipeline.js";
import { keepMacroReferencedImports } from "./keep-imports.js";

// The Node-host macro transformer factory (config/state/cache plumbing
// around transformer-core's shared MacroTransformer) now lives in
// pipeline.ts -- see its doc comment for what it reconstructs that
// transformer-core's browser-safe createTransformerFactory can't.
export { keepMacroReferencedImports } from "./keep-imports.js";
export {
  macroTransformerFactory,
  type MacroTransformerConfig,
  TransformerState,
  saveExpansionCache,
  getExpansionCacheStats,
  type TsPatchTransformerExtras,
} from "./pipeline.js";

/**
 * ts-patch entry point: `{ "transform": "@typesugar/transformer", "type": "program" }`.
 *
 * ts-patch calls `factory(program, pluginConfig, extras)` where `extras` is
 * ts-patch's own object (`{ ts, addDiagnostic, removeDiagnostic, diagnostics,
 * library }`) -- NOT a `TransformerState`. Macro diagnostics are forwarded to
 * `extras.addDiagnostic`, which ts-patch merges into the emit result, so a
 * patched `tsc` reports macro errors and exits non-zero.
 */
export default function typesugarTsPatchTransformer(
  program: ts.Program,
  pluginConfig?: MacroTransformerConfig,
  extras?: TsPatchTransformerExtras
): ts.TransformerFactory<ts.SourceFile> {
  // The project's typesugar.config.* is searched from its tsconfig's
  // directory, as every other host does, not from the cwd: `tspc -p
  // packages/app` run from the repository root missed packages/app's config.
  // tsc sets `configFilePath` for a project build; without one (files on the
  // command line) the search stays at the cwd.
  const configFilePath = program.getCompilerOptions().configFilePath;
  if (typeof configFilePath === "string" && configFilePath) {
    typesugarConfig.load({
      searchFrom: path.dirname(path.resolve(program.getCurrentDirectory(), configFilePath)),
    });
  }
  const macros = macroTransformerFactory(program, pluginConfig, extras);
  // ts-patch runs this inside tsc's JavaScript emit: keep the imports the
  // expanded code references (keep-imports.ts).
  const keep = keepMacroReferencedImports(program);
  return (context) => {
    const expand = macros(context);
    const keepImports = keep(context);
    return (sourceFile) => keepImports(expand(sourceFile));
  };
}

// TypeScript-major guard (PEP-060 item 1), re-exported for hosts that only
// depend on the transformer (the ESLint plugin).
export {
  assertSupportedTypeScript,
  UnsupportedTypeScriptError,
  SUPPORTED_TYPESCRIPT_RANGE,
} from "@typesugar/core";

// The single shared macro-dispatch engine (PEP-056).
export { MacroTransformer } from "@typesugar/transformer-core";

// Lazy macro loading utilities
export {
  loadMacroPackages,
  loadMacroPackage,
  resetLoadedPackages,
  classifyManifestPackages,
  UnapprovedMacroPackagesError,
} from "./macro-loader.js";

// Re-export unified pipeline components
export {
  TransformationPipeline,
  createPipeline,
  transformCode,
  restoreBlankLines,
  formatExpansions,
  type TransformResult,
  type TransformDiagnostic,
  type PipelineOptions,
} from "./pipeline.js";

export {
  VirtualCompilerHost,
  type VirtualCompilerHostOptions,
  type PreprocessedFile,
} from "./virtual-host.js";

export { rewriteHKTTypeReferences, hasHKTPatterns } from "./hkt-rewriter.js";

// .d.ts from the expanded program (`typesugar build`, the tsup helper).
export {
  emitDeclarations,
  emitExpandedDeclarations,
  expandProgramSources,
  captureExpandedSource,
  createExpandedHost,
  formatDiagnosticsForConsole,
  type EmitDeclarationsOptions,
  type EmitDeclarationsResult,
} from "./declarations.js";

export {
  type PositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
  createPositionMapper,
  type TextRange,
} from "./position-mapper.js";

export {
  composeSourceMaps,
  decodeMappings,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
  type RawSourceMap,
  type DecodedSourceMap,
  type DecodedSegment,
  type SourcePosition,
} from "./source-map-utils.js";

export {
  TransformCache,
  DependencyGraph,
  createTransformCache,
  hashContent,
  type PreprocessedCacheEntry,
  type TransformCacheEntry,
} from "./cache.js";

export { generateManifest, createDefaultManifest, type MacroManifest } from "./manifest.js";
