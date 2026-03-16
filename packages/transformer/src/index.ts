/**
 * @typesugar/transformer - Main TypeScript transformer for macro expansion
 *
 * This transformer integrates with ts-patch to process macros during compilation.
 */

import * as ts from "typescript";
import * as path from "path";
import { preprocess } from "@typesugar/preprocessor";
import { loadMacroPackages, loadMacroPackagesFromFile } from "./macro-loader.js";

import {
  getOperatorString,
  getSyntaxForOperator,
  findInstance,
  getInstanceMethods,
  isRegisteredInstance,
  createSpecializedFunction,
  isKindAnnotation,
  transformHKTDeclaration,
  builtinDerivations,
  instanceRegistry,
  instanceVarName,
  tryExtractSumType,
  hasImplicitParams,
  transformImplicitsCall,
  buildImplicitScopeFromDecl,
  SpecializationCache,
  createHoistedSpecialization,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  inlineMethod,
  getResultAlgebra,
  analyzeForFlattening,
  flattenReturnsToExpression,
  // Config functions
  setCfgConfig,
  clearDerivationCaches,
  // Registration functions for AST-based extraction
  registerInstanceWithMeta,
  registerTypeclassDef,
  updateTypeclassSyntax,
  extractOpFromReturnType,
  extractOpFromJSDoc,
  // Source-based specialization
  extractMethodsFromObjectLiteral,
  registerInstanceMethodsFromAST,
  type ImplicitScope,
  type DictMethodMap,
  type DictMethod,
  type ResultAlgebra,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  createMacroContext,
  globalRegistry,
  standaloneExtensionRegistry,
  findStandaloneExtension,
  buildStandaloneExtensionCall,
  type StandaloneExtensionInfo,
  ExpressionMacro,
  AttributeMacro,
  MacroDefinition,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  LabeledBlockMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  // Opt-out system
  globalResolutionScope,
  scanImportsForScope,
  isInOptedOutScope,
  // Import suggestions
  getSuggestionsForSymbol,
  getSuggestionsForMethod,
  getSuggestionsForMacro,
  formatSuggestionsMessage,
  // Source map utilities
  preserveSourceMap,
  // Hygiene system
  HygieneContext,
  FileBindingCache,
  ExpansionTracker,
  globalExpansionTracker,
  // Expansion caching
  MacroExpansionCache,
} from "@typesugar/core";
import { profiler, PROFILING_ENABLED } from "./profiling.js";

// Import MacroTransformer from transformer-core (browser-compatible core)
import { MacroTransformer } from "@typesugar/transformer-core";

// Printer for safe text extraction from nodes (works on synthetic nodes too)
const nodePrinter = ts.createPrinter();

/**
 * Safely get the text content of a node.
 * Unlike node.getText(), this works on synthetic nodes that don't have source positions.
 */
function safeGetNodeText(node: ts.Node, sourceFile?: ts.SourceFile): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  try {
    return node.getText();
  } catch {
    // Fallback for synthetic nodes
    const sf = sourceFile ?? ts.createSourceFile("temp.ts", "", ts.ScriptTarget.Latest);
    return nodePrinter.printNode(ts.EmitHint.Unspecified, node, sf);
  }
}

/**
 * Configuration for the transformer
 */
export interface MacroTransformerConfig {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Custom macro module paths to load */
  macroModules?: string[];

  /** Conditional compilation configuration (for cfg/cfgAttr macros) */
  cfgConfig?: Record<string, unknown>;

  /** Enable expansion tracking for source maps and diagnostics */
  trackExpansions?: boolean;

  /**
   * Directory for the disk-backed macro expansion cache.
   * Set to `false` to disable caching entirely.
   * Defaults to `.typesugar-cache`.
   */
  cacheDir?: string | false;
}

/**
 * The most recently created expansion cache.
 * Used by saveExpansionCache() to persist cache at cleanup time.
 */
let activeExpansionCache: MacroExpansionCache | undefined;

/**
 * Save the macro expansion cache to disk.
 * Call this at cleanup time (buildEnd, CLI exit, etc.) to persist
 * expansion results for future builds.
 */
export function saveExpansionCache(): void {
  if (activeExpansionCache) {
    activeExpansionCache.save();
  }
}

/**
 * Get statistics about the expansion cache for diagnostics.
 */
export function getExpansionCacheStats(): string | undefined {
  return activeExpansionCache?.getStatsString();
}

/**
 * Holds state that can be reused across multiple factory invocations.
 *
 * In watch mode, creating a new factory on each rebuild discards all caches.
 * By passing a TransformerState to subsequent factory calls, expensive setup
 * work is preserved:
 * - Hygiene context (alias generation)
 * - Expansion cache (disk-backed)
 * - Scanned files set (registration scanning)
 * - Macro packages already loaded
 *
 * @example
 * ```typescript
 * // CLI watch mode: create state once, reuse across rebuilds
 * const state = new TransformerState({ cacheDir: '.typesugar-cache' });
 * afterProgramCreate((program) => {
 *   const factory = macroTransformerFactory(program, config, state);
 *   program.emit(undefined, undefined, undefined, false, { before: [factory] });
 * });
 * // On exit:
 * state.save();
 * ```
 */
export class TransformerState {
  /** Shared hygiene context for alias management */
  readonly hygiene: HygieneContext;

  /** Disk-backed expansion cache */
  readonly expansionCache: MacroExpansionCache | undefined;

  /** Files that have been scanned for instance/typeclass registrations */
  readonly scannedFiles: Set<string>;

  /** Track which programs have had macro packages loaded */
  private loadedPrograms = new WeakSet<ts.Program>();

  constructor(options: { cacheDir?: string | false; verbose?: boolean } = {}) {
    this.hygiene = new HygieneContext();
    this.expansionCache =
      options.cacheDir !== false
        ? new MacroExpansionCache(options.cacheDir ?? ".typesugar-cache")
        : undefined;
    this.scannedFiles = new Set();

    if (options.verbose) {
      console.log("[typesugar] Created TransformerState");
      if (this.expansionCache) {
        console.log("[typesugar] Expansion cache loaded: " + this.expansionCache.size + " entries");
      }
    }
  }

  /**
   * Check if macro packages have been loaded for this program.
   * Returns true if already loaded (skip loading), false if not.
   */
  hasLoadedMacroPackages(program: ts.Program): boolean {
    return this.loadedPrograms.has(program);
  }

  /**
   * Mark that macro packages have been loaded for this program.
   */
  markMacroPackagesLoaded(program: ts.Program): void {
    this.loadedPrograms.add(program);
  }

  /**
   * Invalidate scanned files that match a predicate.
   * Use this when a source file changes to allow re-scanning.
   */
  invalidateScannedFiles(predicate: (fileName: string) => boolean): void {
    for (const fileName of this.scannedFiles) {
      if (predicate(fileName)) {
        this.scannedFiles.delete(fileName);
      }
    }
  }

  /**
   * Save the expansion cache to disk.
   */
  save(): void {
    this.expansionCache?.save();
  }

  /**
   * Get cache statistics.
   */
  getStats(): { expansionCacheSize: number; scannedFilesCount: number } {
    return {
      expansionCacheSize: this.expansionCache?.size ?? 0,
      scannedFilesCount: this.scannedFiles.size,
    };
  }
}

/**
 * Check if a file is a "sugared TypeScript" file that needs preprocessing.
 * Only .sts and .stsx files go through the preprocessor.
 */
function isSugaredTypeScriptFile(fileName: string): boolean {
  return /\.stsx?$/i.test(fileName);
}

/**
 * Regex to detect custom syntax in non-.sts files (for error reporting).
 * If a .ts file contains this syntax, we should emit a diagnostic.
 */
const CUSTOM_SYNTAX_RE = /\|>|<_>|[)\]}\w]\s*::\s*[(\[{A-Za-z_$]/;

/**
 * Detect whether a source file needs preprocessing and, if so, create a
 * new SourceFile from the preprocessed text.
 *
 * Extension-based routing:
 * - `.sts`/`.stsx` files: ALWAYS preprocess (custom syntax allowed)
 * - `.ts`/`.tsx` files: NEVER preprocess (use JSDoc syntax only)
 *
 * CAVEATS:
 * - The type checker was built against the original (non-preprocessed) program,
 *   so type resolution may be incomplete for preprocessed constructs. Macros
 *   that rely on the type checker (e.g. = implicit(), extension methods) may
 *   not resolve correctly in preprocessed regions.
 * - For full type-aware transformation of files with custom syntax, use
 *   `unplugin-typesugar` or the `TransformationPipeline` which creates a
 *   fresh program from preprocessed content.
 * - This inline preprocessing is a best-effort fallback for `tsc` + ts-patch
 *   users who have .sts files with custom syntax mixed with macros.
 */
function maybePreprocess(sourceFile: ts.SourceFile, verbose: boolean): ts.SourceFile {
  const fileName = sourceFile.fileName;

  // Only preprocess .sts/.stsx files
  if (!isSugaredTypeScriptFile(fileName)) {
    return sourceFile;
  }

  const text = sourceFile.text;

  try {
    const result = preprocess(text, { fileName });

    if (!result.changed) {
      return sourceFile;
    }

    if (verbose) {
      console.log("[typesugar] Preprocessing: " + fileName);
    }

    const scriptKind =
      fileName.endsWith(".stsx") || fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : fileName.endsWith(".mts") || fileName.endsWith(".cts")
          ? ts.ScriptKind.TS
          : ts.ScriptKind.TS;

    return ts.createSourceFile(
      fileName,
      result.code,
      sourceFile.languageVersion,
      /* setParentNodes */ true,
      scriptKind
    );
  } catch (e) {
    if (verbose) {
      console.log(`[typesugar] Preprocessing failed for ${fileName}: ${e}`);
    }
    return sourceFile;
  }
}

/**
 * Parse a typeclass instantiation string like "Numeric<Expression<number>>"
 * into { typeclassName, forType }.
 */
function parseTypeclassInstantiation(
  text: string
): { typeclassName: string; forType: string } | null {
  const openBracket = text.indexOf("<");
  if (openBracket === -1) return null;

  const typeclassName = text.slice(0, openBracket).trim();
  if (!typeclassName) return null;

  let depth = 0;
  let closeBracket = -1;
  for (let i = openBracket; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") {
      depth--;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }
  if (closeBracket === -1) return null;

  const forType = text.slice(openBracket + 1, closeBracket).trim();
  if (!forType) return null;

  return { typeclassName, forType };
}

/**
 * Resolve a relative module import to an absolute file path.
 * Probes extensions: .ts, .tsx, .js, .jsx, then /index variants.
 */
function resolveRelativeImport(modulePath: string, baseDir: string): string | undefined {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ""];

  // Strip .js/.jsx extension for TypeScript ESM compatibility
  // (imports like "./foo.js" should resolve to "./foo.ts")
  let basePath = path.resolve(baseDir, modulePath);
  if (basePath.endsWith(".js") || basePath.endsWith(".jsx")) {
    const stripped = basePath.replace(/\.jsx?$/, "");
    for (const ext of extensions) {
      const candidate = stripped + ext;
      if (ts.sys.fileExists(candidate)) {
        return candidate;
      }
    }
  }

  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (ts.sys.fileExists(candidate)) {
      return candidate;
    }
  }

  for (const ext of extensions) {
    if (ext === "") continue;
    const indexCandidate = path.join(basePath, "index" + ext);
    if (ts.sys.fileExists(indexCandidate)) {
      return indexCandidate;
    }
  }

  return undefined;
}

/**
 * Extract an ops map from an object literal like { ops: { "===": "equals", ... } }
 */
function extractOpsFromOptions(optionsArg: ts.Expression): Map<string, string> | undefined {
  if (!ts.isObjectLiteralExpression(optionsArg)) return undefined;

  for (const prop of optionsArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : undefined;
    if (name !== "ops") continue;

    const opsObj = prop.initializer;
    if (!ts.isObjectLiteralExpression(opsObj)) continue;

    const result = new Map<string, string>();
    for (const opProp of opsObj.properties) {
      if (!ts.isPropertyAssignment(opProp)) continue;
      const key = ts.isStringLiteral(opProp.name)
        ? opProp.name.text
        : ts.isIdentifier(opProp.name)
          ? opProp.name.text
          : undefined;
      const value = ts.isStringLiteral(opProp.initializer) ? opProp.initializer.text : undefined;
      if (key && value) {
        result.set(key, value);
      }
    }
    return result.size > 0 ? result : undefined;
  }
  return undefined;
}

/**
 * Extract operator syntax from an interface definition by scanning for Op<> in return types.
 * This is the zero-cost path: syntax is extracted at transform time, not runtime.
 */
function extractOpsFromInterface(
  sourceFile: ts.SourceFile,
  interfaceName: string
): Map<string, string> | undefined {
  // Find the interface declaration
  let targetInterface: ts.InterfaceDeclaration | undefined;
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === interfaceName) {
      targetInterface = stmt;
      break;
    }
  }

  if (!targetInterface) return undefined;

  const result = new Map<string, string>();

  // Scan method signatures for @op JSDoc tags (preferred) or Op<> return type annotations (deprecated)
  for (const member of targetInterface.members) {
    if (!ts.isMethodSignature(member)) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;

    const methodName = member.name.text;

    // Check @op JSDoc tag first (preferred source-based approach)
    const jsdocOp = extractOpFromJSDoc(member);
    if (jsdocOp) {
      result.set(jsdocOp, methodName);
      continue;
    }

    // Fall back to Op<> return type annotation (deprecated)
    const { operatorSymbol } = extractOpFromReturnType(member.type);
    if (operatorSymbol) {
      result.set(operatorSymbol, methodName);
    }
  }

  return result.size > 0 ? result : undefined;
}

/**
 * Extract and pre-register `instance()` and `typeclass()` calls from imported workspace files.
 *
 * This ensures typeclass instances and syntax mappings are registered BEFORE the transformer
 * processes files that use operator overloading on imported types.
 *
 * @param sourceFile The current file to scan imports from
 * @param program The TypeScript program (provides access to imported source files)
 * @param scannedFiles Set of already-scanned file paths (prevents cycles)
 * @param verbose Enable logging
 */
function ensureImportedRegistrations(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  scannedFiles: Set<string>,
  verbose: boolean
): void {
  const baseDir = path.dirname(sourceFile.fileName);

  // Collect module paths from both imports and re-exports
  const modulePaths: string[] = [];

  for (const stmt of sourceFile.statements) {
    // Handle: import { ... } from "./module.js"
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = stmt.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        modulePaths.push(moduleSpecifier.text);
      }
    }

    // Handle: export * from "./module.js" and export { ... } from "./module.js"
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      if (ts.isStringLiteral(stmt.moduleSpecifier)) {
        modulePaths.push(stmt.moduleSpecifier.text);
      }
    }
  }

  for (const modulePath of modulePaths) {
    // Only process relative/workspace imports
    if (!modulePath.startsWith(".") && !modulePath.startsWith("/")) {
      continue;
    }

    const resolved = resolveRelativeImport(modulePath, baseDir);
    if (!resolved) continue;

    // Skip if already scanned (prevents cycles)
    if (scannedFiles.has(resolved)) continue;
    scannedFiles.add(resolved);

    // Get the source file from the program (will have preprocessed content via VirtualCompilerHost)
    const importedSf = program.getSourceFile(resolved);
    if (!importedSf) continue;

    // OPTIMIZATION: Fast string-based skip for files without registration calls
    // Most files don't contain registrations, so avoid the expensive AST walk
    const fileText = importedSf.text;
    if (
      !fileText.includes("instance(") &&
      !fileText.includes("typeclass(") &&
      !fileText.includes("registerInstanceWithMeta(") &&
      !fileText.includes("updateTypeclassSyntax(")
    ) {
      // File doesn't have any registration calls — just recurse into imports
      ensureImportedRegistrations(importedSf, program, scannedFiles, verbose);
      continue;
    }

    if (verbose) {
      console.log(`[typesugar] Pre-scanning registrations in: ${resolved}`);
    }

    // Walk the AST looking for registration calls
    const scanNode = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) {
          const fnName = callee.text;

          // Handle instance("Typeclass<Type>", ...)
          if (fnName === "instance" && node.arguments.length >= 1) {
            const descArg = node.arguments[0];
            if (ts.isStringLiteral(descArg)) {
              const parsed = parseTypeclassInstantiation(descArg.text);
              if (parsed) {
                // Find the enclosing variable declaration to get the instance name
                let instanceName: string | undefined;
                let parent: ts.Node | undefined = node.parent;
                while (parent) {
                  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
                    instanceName = parent.name.text;
                    break;
                  }
                  parent = parent.parent;
                }

                if (instanceName && !findInstance(parsed.typeclassName, parsed.forType)) {
                  if (verbose) {
                    console.log(
                      `[typesugar] Pre-registered instance: ${parsed.typeclassName}<${parsed.forType}> = ${instanceName}`
                    );
                  }
                  registerInstanceWithMeta({
                    typeclassName: parsed.typeclassName,
                    forType: parsed.forType,
                    instanceName,
                    derived: false,
                  });
                }
              }
            }
          }

          // Handle typeclass("Name", { ops: {...} })
          if (fnName === "typeclass" && node.arguments.length >= 1) {
            const nameArg = node.arguments[0];
            if (ts.isStringLiteral(nameArg)) {
              const tcName = nameArg.text;

              // Extract ops from second argument if present
              if (node.arguments.length >= 2) {
                const opsMap = extractOpsFromOptions(node.arguments[1]);
                if (opsMap && opsMap.size > 0) {
                  if (verbose) {
                    console.log(
                      `[typesugar] Pre-registered syntax for ${tcName}: ${[...opsMap.entries()].map(([k, v]) => `${k}->${v}`).join(", ")}`
                    );
                  }
                  updateTypeclassSyntax(tcName, opsMap);
                }
              } else {
                // No explicit ops argument — extract @op from interface definition
                // This is the zero-cost path: syntax is extracted at transform time
                const opsMap = extractOpsFromInterface(importedSf, tcName);
                if (opsMap && opsMap.size > 0) {
                  if (verbose) {
                    console.log(
                      `[typesugar] Pre-registered syntax (from interface): ${tcName}: ${[...opsMap.entries()].map(([k, v]) => `${k}->${v}`).join(", ")}`
                    );
                  }
                  updateTypeclassSyntax(tcName, opsMap);
                }
              }
            }
          }

          // Handle registerInstanceWithMeta({ ... })
          if (fnName === "registerInstanceWithMeta" && node.arguments.length >= 1) {
            const arg = node.arguments[0];
            if (ts.isObjectLiteralExpression(arg)) {
              const info = extractInstanceInfoFromLiteral(arg);
              if (info && !findInstance(info.typeclassName, info.forType)) {
                if (verbose) {
                  console.log(
                    `[typesugar] Pre-registered instance (meta): ${info.typeclassName}<${info.forType}> = ${info.instanceName}`
                  );
                }
                registerInstanceWithMeta(info);
              }
            }
          }

          // Legacy registerTypeclassSyntax() calls are no longer supported.
          // Use @op annotations on typeclass method signatures instead.
        }
      }

      ts.forEachChild(node, scanNode);
    };

    scanNode(importedSf);

    // Recurse into this file's imports
    ensureImportedRegistrations(importedSf, program, scannedFiles, verbose);
  }
}

/**
 * Extract InstanceInfo from an object literal expression.
 */
function extractInstanceInfoFromLiteral(
  obj: ts.ObjectLiteralExpression
): { typeclassName: string; forType: string; instanceName: string; derived: boolean } | null {
  let typeclassName: string | undefined;
  let forType: string | undefined;
  let instanceName: string | undefined;
  let derived = false;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    const name = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (!name) continue;

    const value = prop.initializer;

    if (name === "typeclassName" && ts.isStringLiteral(value)) {
      typeclassName = value.text;
    } else if (name === "forType" && ts.isStringLiteral(value)) {
      forType = value.text;
    } else if (name === "instanceName" && ts.isStringLiteral(value)) {
      instanceName = value.text;
    } else if (name === "derived") {
      derived = value.kind === ts.SyntaxKind.TrueKeyword;
    }
  }

  if (typeclassName && forType && instanceName) {
    return { typeclassName, forType, instanceName, derived };
  }
  return null;
}

/**
 * Extract a Map<string, string> from a new Map([...]) or array literal argument.
 */
function extractSyntaxMapFromArg(arg: ts.Expression): Map<string, string> | undefined {
  // Handle new Map([["op", "method"], ...])
  if (ts.isNewExpression(arg) && arg.arguments?.length === 1) {
    const initArg = arg.arguments[0];
    if (ts.isArrayLiteralExpression(initArg)) {
      return extractMapFromArray(initArg);
    }
  }

  // Handle array literal [["op", "method"], ...]
  if (ts.isArrayLiteralExpression(arg)) {
    return extractMapFromArray(arg);
  }

  return undefined;
}

/**
 * Extract Map entries from an array literal like [["op", "method"], ...]
 */
function extractMapFromArray(arr: ts.ArrayLiteralExpression): Map<string, string> | undefined {
  const result = new Map<string, string>();
  for (const elem of arr.elements) {
    if (ts.isArrayLiteralExpression(elem) && elem.elements.length >= 2) {
      const key = elem.elements[0];
      const val = elem.elements[1];
      if (ts.isStringLiteral(key) && ts.isStringLiteral(val)) {
        result.set(key.text, val.text);
      }
    }
  }
  return result.size > 0 ? result : undefined;
}

function isPrimitiveType(type: ts.Type): boolean {
  const flags = type.flags;
  return !!(
    flags & ts.TypeFlags.Number ||
    flags & ts.TypeFlags.String ||
    flags & ts.TypeFlags.Boolean ||
    flags & ts.TypeFlags.BigInt ||
    flags & ts.TypeFlags.Null ||
    flags & ts.TypeFlags.Undefined ||
    flags & ts.TypeFlags.Void ||
    flags & ts.TypeFlags.Never ||
    flags & ts.TypeFlags.NumberLiteral ||
    flags & ts.TypeFlags.StringLiteral ||
    flags & ts.TypeFlags.BooleanLiteral ||
    flags & ts.TypeFlags.BigIntLiteral
  );
}

/**
 * Create the TypeScript transformer factory
 * This is the entry point called by ts-patch
 *
 * @param program - The TypeScript program to transform
 * @param config - Configuration options
 * @param state - Optional reusable state for watch mode (caches, hygiene context)
 */
export default function macroTransformerFactory(
  program: ts.Program,
  config?: MacroTransformerConfig,
  state?: TransformerState
): ts.TransformerFactory<ts.SourceFile> {
  profiler.start("factory.total");
  const verbose = config?.verbose ?? false;
  const trackExpansions = config?.trackExpansions ?? false;
  const hasState = state !== undefined;

  // Apply conditional compilation config if provided
  if (config?.cfgConfig) {
    setCfgConfig(config.cfgConfig);
  }

  // Reuse state if provided, otherwise create fresh caches
  let hygiene: HygieneContext;
  let expansionCache: MacroExpansionCache | undefined;
  let scannedFiles: Set<string>;

  if (state) {
    // Reuse existing state (watch mode optimization)
    hygiene = state.hygiene;
    expansionCache = state.expansionCache;
    scannedFiles = state.scannedFiles;
    activeExpansionCache = expansionCache;

    // Only load macro packages if not already loaded for this program
    if (!state.hasLoadedMacroPackages(program)) {
      profiler.start("factory.loadMacroPackages");
      loadMacroPackages(program, verbose);
      profiler.end("factory.loadMacroPackages");
      state.markMacroPackagesLoaded(program);
    }

    // Skip clearDerivationCaches() when reusing state — caches are still valid
    if (verbose) {
      console.log("[typesugar] Reusing TransformerState from previous build");
    }
  } else {
    // Fresh state (first build or non-watch mode)

    // Clear per-compilation caches (stale mirrors/derivations from watch-mode rebuilds)
    profiler.start("factory.clearDerivationCaches");
    clearDerivationCaches();
    profiler.end("factory.clearDerivationCaches");

    // Create a shared hygiene context for the entire compilation
    hygiene = new HygieneContext();

    // Instantiate the disk-backed expansion cache (one per compilation)
    profiler.start("factory.loadExpansionCache");
    const cacheDir = config?.cacheDir;
    expansionCache =
      cacheDir !== false ? new MacroExpansionCache(cacheDir ?? ".typesugar-cache") : undefined;
    // Store for cleanup access via saveExpansionCache()
    activeExpansionCache = expansionCache;
    profiler.end("factory.loadExpansionCache");

    // Lazily load macro packages based on what the program actually imports.
    // This replaces eager side-effect imports that caused dependency cycles.
    profiler.start("factory.loadMacroPackages");
    loadMacroPackages(program, verbose);
    profiler.end("factory.loadMacroPackages");

    // Track which files have been scanned for registrations (prevents cycles)
    scannedFiles = new Set<string>();
  }

  // Use the global expansion tracker (or a fresh one per compilation)
  const expansionTracker = trackExpansions ? globalExpansionTracker : undefined;

  profiler.end("factory.total");

  if (verbose) {
    if (hasState) {
      console.log("[typesugar] Initializing transformer (reusing state)");
    } else {
      console.log("[typesugar] Initializing transformer (fresh state)");
    }
    console.log(
      `[typesugar] Registered macros: ${globalRegistry
        .getAll()
        .map((m) => m.name)
        .join(", ")}`
    );
    if (expansionCache) {
      console.log(`[typesugar] Expansion cache: ${expansionCache.size} entries`);
    }
    console.log(`[typesugar] Scanned files: ${scannedFiles.size}`);
  }

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      profiler.start("perFile.total");

      if (verbose) {
        console.log(`[typesugar] Processing: ${sourceFile.fileName}`);
      }

      // Phase 1: Preprocess custom syntax (|>, ::, F<_>) into valid TypeScript.
      // This must happen before macro expansion because the original source may
      // contain syntax that TypeScript couldn't parse correctly.
      profiler.start("perFile.maybePreprocess");
      sourceFile = maybePreprocess(sourceFile, verbose);
      profiler.end("perFile.maybePreprocess");

      const ctx = createMacroContext(program, sourceFile, context, hygiene);

      // Scan for imports and opt-out directives
      profiler.start("perFile.scanImportsForScope");
      scanImportsForScope(sourceFile, globalResolutionScope);
      profiler.end("perFile.scanImportsForScope");

      // Load macro packages based on this file's imports.
      // This is important for the language service where the initial program
      // may not include all files that will be transformed.
      profiler.start("perFile.loadMacroPackagesFromFile");
      loadMacroPackagesFromFile(sourceFile, verbose);
      profiler.end("perFile.loadMacroPackagesFromFile");

      // Pre-scan imported workspace files for instance() and typeclass() registrations.
      // This ensures instances are registered before operator rewriting encounters them.
      profiler.start("perFile.ensureImportedRegistrations");
      ensureImportedRegistrations(sourceFile, program, scannedFiles, verbose);
      profiler.end("perFile.ensureImportedRegistrations");

      // Check for file-level opt-out
      const fileScope = globalResolutionScope.getScope(sourceFile.fileName);
      if (fileScope.optedOut) {
        if (verbose) {
          console.log(`[typesugar] Skipping: ${sourceFile.fileName} (opted out)`);
        }
        profiler.end("perFile.total");
        return sourceFile;
      }

      const transformer = new MacroTransformer(ctx, verbose, expansionTracker, expansionCache);

      profiler.start("perFile.visitNode");
      const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));
      profiler.end("perFile.visitNode");

      // Report diagnostics through the TS diagnostic pipeline
      const macroDiagnostics = ctx.getDiagnostics();
      for (const diag of macroDiagnostics) {
        // Safely get start position - synthetic nodes throw on getStart
        let start = 0;
        let length = 0;
        if (diag.node) {
          if (verbose) {
            console.log(
              `[typesugar] Diagnostic node: kind=${ts.SyntaxKind[diag.node.kind]}, pos=${diag.node.pos}, end=${diag.node.end}`
            );
          }
          // Try multiple approaches to get position
          // 1. Check if node has pos/end properties directly (most reliable)
          if (diag.node.pos >= 0 && diag.node.end > diag.node.pos) {
            start = diag.node.pos;
            length = diag.node.end - diag.node.pos;
            // Adjust start to skip leading trivia (whitespace/comments)
            // Use the node's getStart method if available, as it handles trivia correctly
            try {
              const nodeSourceFile = diag.node.getSourceFile?.();
              if (nodeSourceFile) {
                // getStart skips leading trivia
                const textStart = diag.node.getStart(nodeSourceFile);
                if (textStart >= start && textStart < diag.node.end) {
                  start = textStart;
                  length = diag.node.end - textStart;
                }
              }
            } catch (e) {
              if (verbose) {
                console.log(`[typesugar] getStart failed: ${e}`);
              }
              // Keep the pos/end values if getStart fails
            }
          } else {
            // 2. Fallback: try getStart/getWidth with provided sourceFile
            try {
              start = diag.node.getStart(sourceFile);
              length = diag.node.getWidth(sourceFile);
            } catch (e) {
              if (verbose) {
                console.log(
                  `[typesugar] Fallback getStart failed: ${e}, node.pos=${diag.node.pos}, node.end=${diag.node.end}`
                );
              }
            }
          }
          if (verbose) {
            console.log(`[typesugar] Final position: start=${start}, length=${length}`);
          }
        } else {
          if (verbose) {
            console.log(`[typesugar] Diagnostic has no node: ${diag.message.substring(0, 50)}...`);
          }
        }

        // Use the structured code from MacroDiagnostic if available,
        // otherwise try to extract from [TS9XXX] prefix in message text
        const errorCode =
          diag.code ??
          (() => {
            const m = diag.message.match(/\[TS(\d{4})\]/);
            return m ? parseInt(m[1], 10) : 9999;
          })();

        const tsDiag: ts.Diagnostic & { __typesugarSuggestion?: string } = {
          file: sourceFile,
          start,
          length,
          messageText: `[typesugar] ${diag.message}`,
          category:
            diag.severity === "error" ? ts.DiagnosticCategory.Error : ts.DiagnosticCategory.Warning,
          code: errorCode,
          source: "typesugar",
        };
        if (diag.suggestion) {
          tsDiag.__typesugarSuggestion = diag.suggestion;
        }

        // Use the transformation context's addDiagnostic if available (TS 5.x+)
        const ctxWithDiag = context as ts.TransformationContext & {
          addDiagnostic?: (diag: ts.Diagnostic) => void;
        };
        if (ctxWithDiag.addDiagnostic) {
          ctxWithDiag.addDiagnostic(tsDiag);
        }

        // Also log for build tools that don't surface TS diagnostics
        if (verbose) {
          const prefix = diag.severity === "error" ? "ERROR" : "WARNING";
          const loc = diag.node
            ? ` at ${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(start).line + 1}`
            : "";
          console.log(`[typesugar ${prefix}]${loc} ${diag.message}`);
        }
      }

      profiler.end("perFile.total");
      return result as ts.SourceFile;
    };
  };
}

// MacroTransformer class is now imported from @typesugar/transformer-core
// See packages/transformer-core/src/transformer.ts

// Also export for programmatic use
export { MacroTransformer };

// Lazy macro loading utilities
export { loadMacroPackages, loadMacroPackage, resetLoadedPackages } from "./macro-loader.js";

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
  type TransformBackend,
} from "./pipeline.js";

export {
  VirtualCompilerHost,
  type VirtualCompilerHostOptions,
  type PreprocessedFile,
} from "./virtual-host.js";

export { rewriteHKTTypeReferences, hasHKTPatterns } from "./hkt-rewriter.js";

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

export {
  needsTypescriptTransformer,
  needsTs,
  type NeedsTransformerResult,
  type DetectedPattern,
} from "./needs-ts-transformer.js";
