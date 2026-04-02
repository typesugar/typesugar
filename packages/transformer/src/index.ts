/**
 * @typesugar/transformer - Main TypeScript transformer for macro expansion
 *
 * This transformer integrates with ts-patch to process macros during compilation.
 */

import * as ts from "typescript";
import * as path from "path";
import { preprocess } from "@typesugar/preprocessor";
import { loadMacroPackages, loadMacroPackagesFromFile } from "./macro-loader.js";
import { discoverOpaqueTypesFromImports } from "./dts-opaque-discovery.js";

import {
  getOperatorString,
  getSyntaxForOperator,
  findInstance,
  getInstanceMethods,
  getInstanceOrIntrinsicMethods,
  isRegisteredInstance,
  createSpecializedFunction,
  isKindAnnotation,
  transformHKTDeclaration,
  builtinDerivations,
  instanceRegistry,
  typeclassRegistry,
  instanceVarName,
  companionPath,
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
  extractOpFromJSDoc,
  // Source-based specialization
  extractMethodsFromObjectLiteral,
  registerInstanceMethodsFromAST,
  getSpecializationMethodsForDerivation,
  type ImplicitScope,
  type DictMethodMap,
  type DictMethod,
  type ResultAlgebra,
  createRegistrationCall,
  convertToCompanionAssignment,
  ensureDataTypeCompanionConst,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  createMacroContext,
  globalRegistry,
  standaloneExtensionRegistry,
  findStandaloneExtension,
  getAllStandaloneExtensions,
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
  // Expansion tracking
  ExpansionTracker,
  globalExpansionTracker,
  // Expansion caching
  MacroExpansionCache,
  // Type rewrite registry (PEP-012)
  findTypeRewrite,
  getTypeRewrite,
  getAllTypeRewrites,
  type TypeRewriteEntry,
  type ConstructorRewrite,
  type AccessorRewrite,
  type MethodInlinePattern,
  // Statement removal sentinel
  isRemoveExpression,
  getRemoveComment,
  // Comment stripping for inlined expressions
  stripCommentsDeep,
  // Type string parsing
  parseTypeInstantiation,
  extractTypeArgumentsContent,
  stripTypeArguments,
  // Derive diagnostics
  TS9101,
  TS9103,
  TS9104,
} from "@typesugar/core";
import { profiler, PROFILING_ENABLED } from "./profiling.js";

// Printer for safe text extraction from nodes (works on synthetic nodes too)
const nodePrinter = ts.createPrinter();
// Printer that strips all comments — used to reparse macro-generated expressions
// without inheriting stray comments from the original source file
const commentFreePrinter = ts.createPrinter({ removeComments: true });

/**
 * Safety net: clamp any negative source positions to 0.
 *
 * Synthetic nodes created by macro expansion have pos = -1 (set by
 * stripPositions). This is fine for the printer, but TypeScript's emitter
 * crashes in createTextSpan when it encounters negative positions during
 * program.emit(). Walking the tree once after transformation prevents that.
 *
 * Note: ts.forEachChild may not visit all leaf tokens (e.g. NumericLiteral
 * in certain positions). The CLI also guards against this by collecting
 * pre-emit diagnostics before emit, and wrapping post-emit checker access
 * in try/catch.
 */
function clampSyntheticPositions<T extends ts.Node>(node: T): T {
  if (node.pos < 0 || node.end < 0) {
    ts.setTextRange(node, { pos: Math.max(0, node.pos), end: Math.max(0, node.end) });
  }
  ts.forEachChild(node, clampSyntheticPositions);
  return node;
}

function isNullLiteral(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword;
}

function isNullOrUndefinedExpression(node: ts.Expression): boolean {
  if (node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node) && node.text === "undefined") return true;
  if (ts.isVoidExpression(node)) return true; // void 0
  return false;
}

function isSimpleExpression(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    isNullLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

function buildOpaqueInlineExpressionStatic(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: readonly ts.Expression[],
  verbose: boolean,
  typeName: string,
  methodName: string
): ts.Expression | undefined {
  if (isNullLiteral(receiver)) {
    if (verbose) {
      console.log(`[typesugar] Opaque inline (constant-folded null): ${typeName}.${methodName}()`);
    }
    return constantFoldNullStatic(factory, pattern, args);
  }

  if (isKnownNonNullLiteral(receiver)) {
    if (verbose) {
      console.log(
        `[typesugar] Opaque inline (constant-folded non-null): ${typeName}.${methodName}()`
      );
    }
    return constantFoldNonNullStatic(factory, pattern, receiver, args);
  }

  if (verbose) {
    console.log(`[typesugar] Opaque inline (inlined): ${typeName}.${methodName}()`);
  }

  if (isSimpleExpression(receiver)) {
    return buildInlineTernaryStatic(factory, pattern, receiver, args);
  }

  const param = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createIdentifier("_opt"),
    undefined,
    undefined,
    undefined
  );
  const optRef = factory.createIdentifier("_opt");
  const body = buildInlineTernaryStatic(factory, pattern, optRef, args);
  if (!body) return undefined;

  const arrow = factory.createArrowFunction(
    undefined,
    undefined,
    [param],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
  return factory.createCallExpression(factory.createParenthesizedExpression(arrow), undefined, [
    receiver,
  ]);
}

function isKnownNonNullLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

function constantFoldNonNullStatic(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: readonly ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      return fn ? factory.createCallExpression(fn, undefined, [receiver]) : undefined;
    }
    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createCallExpression(pred, undefined, [receiver]),
        undefined,
        receiver,
        undefined,
        factory.createNull()
      );
    }
    case "null-coalesce-call":
    case "null-coalesce-value":
      return receiver;
    case "fold": {
      const onSome = args[1];
      return onSome ? factory.createCallExpression(onSome, undefined, [receiver]) : undefined;
    }
  }
}

function constantFoldNullStatic(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  args: readonly ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply":
    case "null-check-predicate":
      return factory.createNull();
    case "null-coalesce-call": {
      const defaultFn = args[0];
      return defaultFn ? factory.createCallExpression(defaultFn, undefined, []) : undefined;
    }
    case "null-coalesce-value":
      return args[0];
    case "fold": {
      const onNone = args[0];
      return onNone ? factory.createCallExpression(onNone, undefined, []) : undefined;
    }
  }
}

function buildInlineTernaryStatic(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: readonly ts.Expression[]
): ts.Expression | undefined {
  const nullExpr = factory.createNull();
  const notNull = factory.createBinaryExpression(
    receiver,
    ts.SyntaxKind.ExclamationEqualsToken,
    nullExpr
  );

  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      if (!fn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(fn, undefined, [receiver]),
        undefined,
        nullExpr
      );
    }

    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createBinaryExpression(
          notNull,
          ts.SyntaxKind.AmpersandAmpersandToken,
          factory.createCallExpression(pred, undefined, [receiver])
        ),
        undefined,
        receiver,
        undefined,
        nullExpr
      );
    }

    case "null-coalesce-call": {
      const defaultFn = args[0];
      if (!defaultFn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        factory.createCallExpression(defaultFn, undefined, [])
      );
    }

    case "null-coalesce-value": {
      const defaultVal = args[0];
      if (!defaultVal) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        defaultVal
      );
    }

    case "fold": {
      const onNone = args[0];
      const onSome = args[1];
      if (!onNone || !onSome) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(onSome, undefined, [receiver]),
        undefined,
        factory.createCallExpression(onNone, undefined, [])
      );
    }
  }
}

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
  const parsed = parseTypeInstantiation(text);
  if (!parsed || !parsed.args) return null;
  return { typeclassName: parsed.base, forType: parsed.args };
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

/**
 * Extract operator syntax from an interface definition by scanning for @op JSDoc tags.
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

  // Scan method signatures for @op JSDoc tags
  for (const member of targetInterface.members) {
    if (!ts.isMethodSignature(member)) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;

    const methodName = member.name.text;

    const jsdocOp = extractOpFromJSDoc(member);
    if (jsdocOp) {
      result.set(jsdocOp, methodName);
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

          // Handle typeclass("Name") — extract @op from interface definition
          if (fnName === "typeclass" && node.arguments.length >= 1) {
            const nameArg = node.arguments[0];
            if (ts.isStringLiteral(nameArg)) {
              const tcName = nameArg.text;
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
function extractInstanceInfoFromLiteral(obj: ts.ObjectLiteralExpression): {
  typeclassName: string;
  forType: string;
  instanceName: string;
  derived: boolean;
  sourceModule?: string;
} | null {
  let typeclassName: string | undefined;
  let forType: string | undefined;
  let instanceName: string | undefined;
  let sourceModule: string | undefined;
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
    } else if (name === "sourceModule" && ts.isStringLiteral(value)) {
      sourceModule = value.text;
    } else if (name === "derived") {
      derived = value.kind === ts.SyntaxKind.TrueKeyword;
    }
  }

  if (typeclassName && forType && instanceName) {
    return { typeclassName, forType, instanceName, derived, sourceModule };
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

/**
 * True when a statement is an ExpressionStatement whose expression is a
 * removal sentinel (created by `createRemoveExpression`).
 */
function isRemovedStatement(node: ts.Node): boolean {
  return ts.isExpressionStatement(node) && isRemoveExpression(node.expression);
}

/** Check if a node has an `export` modifier (PEP-027). */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 * Extract the `forType` string from the first parameter's type annotation (PEP-027).
 * Returns the normalized type name, or undefined if no type annotation or
 * the type is a bare generic parameter (e.g. `T`, `A`).
 */
function extractForTypeFromParam(param: ts.ParameterDeclaration): string | undefined {
  let typeNode = param.type;
  if (!typeNode) return undefined;

  // Unwrap `readonly T[]` → T[]
  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
    typeNode = typeNode.type;
  }

  // Keyword types: number, string, boolean
  switch (typeNode.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "number";
    case ts.SyntaxKind.StringKeyword:
      return "string";
    case ts.SyntaxKind.BooleanKeyword:
      return "boolean";
    case ts.SyntaxKind.ObjectKeyword:
      return "object";
  }

  // Array type: T[] → "Array"
  if (ts.isArrayTypeNode(typeNode)) {
    return "Array";
  }

  // Type reference: Array<T>, Map<K,V>, Set<T>, MyType, etc.
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) {
      const name = typeName.text;
      // Skip if this name is a type parameter on the enclosing function
      if (isTypeParamOfEnclosingFunction(param, name)) return undefined;
      return name;
    }
    if (ts.isQualifiedName(typeName)) {
      return typeName.right.text;
    }
  }

  // Union, intersection, or other complex types — skip
  return undefined;
}

/** Check if `name` is declared as a type parameter on the function that owns `param`. */
function isTypeParamOfEnclosingFunction(param: ts.ParameterDeclaration, name: string): boolean {
  const fn = param.parent;
  if (!ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
    return false;
  }
  return fn.typeParameters?.some((tp) => tp.name.text === name) === true;
}

/**
 * If a removed statement carries a comment, create an empty statement with
 * that comment so the output shows what was erased.  Returns undefined if
 * there is no comment (the statement should be dropped entirely).
 */
function createCommentReplacement(
  factory: ts.NodeFactory,
  node: ts.Node
): ts.EmptyStatement | undefined {
  if (!ts.isExpressionStatement(node)) return undefined;
  const comment = getRemoveComment(node.expression);
  if (!comment) return undefined;
  const empty = factory.createEmptyStatement();
  ts.addSyntheticLeadingComment(empty, ts.SyntaxKind.SingleLineCommentTrivia, comment);
  return empty;
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

      // Discover @opaque types from imported .d.ts files (external libraries).
      // This auto-registers TypeRewriteEntry entries for opaque types that
      // the library published with @opaque annotations in their declarations.
      profiler.start("perFile.discoverOpaqueTypes");
      discoverOpaqueTypesFromImports(sourceFile, program, verbose);
      profiler.end("perFile.discoverOpaqueTypes");

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

      // Safety net: clamp negative positions so program.emit() doesn't crash
      // in createTextSpan when encountering synthetic nodes from macro expansion
      clampSyntheticPositions(result as ts.SourceFile);

      profiler.end("perFile.total");
      return result as ts.SourceFile;
    };
  };
}

/**
 * The main transformer class that handles macro expansion
 */
class MacroTransformer {
  private additionalStatements: ts.Statement[] = [];

  /**
   * Cache of resolved macro symbols for this source file.
   * Maps a ts.Symbol id to the MacroDefinition it resolves to (or null if not a macro).
   * Built lazily as identifiers are encountered.
   */
  private symbolMacroCache = new Map<number, MacroDefinition | null>();

  /**
   * Tracks import specifiers that resolved to macros during expansion.
   * After the visitor pass completes, these specifiers are removed from their
   * import declarations. If all specifiers in an import are macro-only, the
   * entire import declaration is removed.
   *
   * Keyed by the import *declaration* node, value is the set of import
   * specifier nodes (named imports) or `"namespace"` / `"default"` sentinels
   * for namespace/default import bindings.
   */
  private macroImportSpecifiers = new Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >();

  /**
   * Cache for import-scoped extension resolution.
   * Key: ts.Type object identity, Value: Map<methodName, result>
   */
  private importExtensionCache = new Map<
    ts.Type,
    Map<string, StandaloneExtensionInfo | undefined>
  >();

  /**
   * Stack of implicit scopes from enclosing functions with `= implicit()` params.
   * Pushed when entering such a function body, popped on exit.
   * Inner scopes shadow outer ones.
   */
  private implicitScopeStack: ImplicitScope[] = [];

  /**
   * Per-block deduplication cache for auto-specialization.
   * When the same function is specialized with the same dictionaries
   * multiple times in the same block, we generate one hoisted declaration
   * and reuse the identifier.
   */
  private specCache = new SpecializationCache();

  /**
   * Cache for union type alias member lookups. Maps a type alias name to
   * the set of base member names in its union, or null if not found/not a union.
   * Avoids repeatedly scanning all source files (including .d.ts) for the same alias.
   */
  private unionMemberCache = new Map<string, Set<string> | null>();

  private inlinedInstanceNames = new Set<string>();

  /**
   * Pending imports for type-rewrite method erasure (PEP-012 Wave 3).
   * Tracks `{ name, module }` pairs that need import declarations injected.
   * Deduped by name+module so the same function is only imported once.
   */
  private pendingTypeRewriteImports = new Map<string, { name: string; module: string }>();

  constructor(
    private ctx: MacroContextImpl,
    private verbose: boolean,
    private expansionTracker?: ExpansionTracker,
    private expansionCache?: MacroExpansionCache
  ) {}

  // ---------------------------------------------------------------------------
  // Expansion cache helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether a macro definition opts into caching.
   * Defaults to true unless explicitly set to false.
   */
  private isMacroCacheable(macro: MacroDefinition): boolean {
    return macro.cacheable !== false;
  }

  /**
   * Compute a cache key for a macro call site.
   * Returns undefined if the node text cannot be retrieved (synthetic nodes).
   */
  private computeCallSiteCacheKey(
    macroName: string,
    node: ts.Node,
    args: readonly ts.Node[]
  ): string | undefined {
    if (!this.expansionCache) return undefined;
    try {
      const sourceText = node.getText(this.ctx.sourceFile);
      const argTexts = args.map((a) => a.getText(this.ctx.sourceFile));
      return this.expansionCache.computeKey(macroName, sourceText, argTexts);
    } catch {
      return undefined;
    }
  }

  /**
   * Try to retrieve a cached single-expression expansion.
   * Returns the parsed expression on hit, undefined on miss.
   */
  private getCachedExpression(cacheKey: string): ts.Expression | undefined {
    if (!this.expansionCache) return undefined;
    const cached = this.expansionCache.get(cacheKey);
    if (cached === undefined) return undefined;
    try {
      return this.ctx.parseExpression(cached);
    } catch {
      this.expansionCache.invalidate(cacheKey);
      return undefined;
    }
  }

  /**
   * Store a single-expression expansion result in the cache.
   */
  private cacheExpression(cacheKey: string, result: ts.Node): void {
    if (!this.expansionCache) return;
    const printed = this.printNodeSafe(result);
    if (printed) {
      this.expansionCache.set(cacheKey, printed);
    }
  }

  /**
   * Safely print a node to string. Returns undefined if printing fails.
   */
  private printNodeSafe(node: ts.Node): string | undefined {
    try {
      const printer = ts.createPrinter();
      return printer.printNode(ts.EmitHint.Unspecified, node, this.ctx.sourceFile);
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Implicit scope management
  // ---------------------------------------------------------------------------

  /**
   * Get the current implicit scope (combined from all enclosing functions
   * with `= implicit()` params). Inner scopes shadow outer ones.
   */
  private getCurrentImplicitScope(): ImplicitScope | undefined {
    if (this.implicitScopeStack.length === 0) return undefined;

    const combined = new Map<string, string>();
    for (const scope of this.implicitScopeStack) {
      for (const [key, value] of scope.available) {
        combined.set(key, value);
      }
    }

    return { available: combined };
  }

  /**
   * Visit a function with `= implicit()` params, tracking them in scope
   * so that nested calls can use them (propagation).
   */
  private visitImplicitParamsFunction(node: ts.FunctionLikeDeclaration): ts.Node | ts.Node[] {
    if (this.verbose) {
      const name =
        ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
          ? (node.name as ts.Identifier | undefined)?.text
          : undefined;
      console.log(`[typesugar] Entering function with implicit params: ${name ?? "(anonymous)"}`);
    }

    const scope = buildImplicitScopeFromDecl(node);
    this.implicitScopeStack.push(scope);

    try {
      // tryTransform may expand decorators or other macros on this node.
      // The scope is already pushed, so any recursive visit() calls from
      // within tryTransform (e.g. tryExpandAttributeMacros line 2904) will
      // see the implicit scope on the stack — no extra re-visit needed.
      const transformed = this.tryTransform(node);
      if (transformed !== undefined) {
        return transformed;
      }

      return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    } finally {
      this.implicitScopeStack.pop();
    }
  }

  /**
   * Try to transform a call whose callee has `= implicit()` default params.
   * Uses the current implicit scope for propagation.
   */
  private tryTransformImplicitsCall(node: ts.CallExpression): ts.Expression | undefined {
    const currentScope = this.getCurrentImplicitScope();
    const result = transformImplicitsCall(this.ctx, node, currentScope);
    if (result) {
      if (this.verbose) {
        let funcName = "";
        if (ts.isIdentifier(node.expression)) {
          funcName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          funcName = node.expression.name.text;
        }
        const fromScope = currentScope ? " (with propagation)" : "";
        console.log(`[typesugar] Filling implicit parameters for call: ${funcName}()${fromScope}`);
      }
      // Use visitEachChild (not visitNode) so the arguments get visited for
      // nested macro expansion, but the call itself is not re-fed through
      // tryTransform — which would trigger auto-specialization and inline the
      // function body instead of preserving the call with the resolved instance.
      const visited = ts.visitEachChild(
        result,
        this.visit.bind(this),
        this.ctx.transformContext
      ) as ts.Expression;
      return preserveSourceMap(visited, node);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Import tracking for macro-import cleanup
  // ---------------------------------------------------------------------------

  /**
   * Record that a symbol resolved to a macro, so its import specifier can be
   * removed after the visitor pass.
   *
   * Walks the *original* (pre-alias) symbol's declarations to find the
   * ImportSpecifier, NamespaceImport, or ImportClause (default import) that
   * brought it into scope, then adds it to `macroImportSpecifiers`.
   */
  private recordMacroImport(originalSymbol: ts.Symbol): void {
    const declarations = originalSymbol.getDeclarations();
    if (!declarations) return;

    for (const decl of declarations) {
      // Named import: import { comptime } or import { comptime as ct }
      if (ts.isImportSpecifier(decl)) {
        const namedBindings = decl.parent; // NamedImports
        const importClause = namedBindings.parent; // ImportClause
        const importDecl = importClause.parent; // ImportDeclaration
        if (ts.isImportDeclaration(importDecl)) {
          let set = this.macroImportSpecifiers.get(importDecl);
          if (!set) {
            set = new Set();
            this.macroImportSpecifiers.set(importDecl, set);
          }
          set.add(decl);
        }
        return;
      }

      // Namespace import: import * as M from "typesugar"
      if (ts.isNamespaceImport(decl)) {
        const importClause = decl.parent; // ImportClause
        const importDecl = importClause.parent; // ImportDeclaration
        if (ts.isImportDeclaration(importDecl)) {
          let set = this.macroImportSpecifiers.get(importDecl);
          if (!set) {
            set = new Set();
            this.macroImportSpecifiers.set(importDecl, set);
          }
          set.add("namespace");
        }
        return;
      }

      // Default import: import comptime from "typesugar"
      if (ts.isImportClause(decl) && decl.name) {
        const importDecl = decl.parent; // ImportDeclaration
        if (ts.isImportDeclaration(importDecl)) {
          let set = this.macroImportSpecifiers.get(importDecl);
          if (!set) {
            set = new Set();
            this.macroImportSpecifiers.set(importDecl, set);
          }
          set.add("default");
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Import-scoped macro resolution
  // ---------------------------------------------------------------------------

  /**
   * Import-scoped extension resolution.
   *
   * When a method call like `x.clamp(0, 100)` fails to resolve through the
   * typeclass and standalone registries, scan the current file's imports for
   * a matching function or namespace property. This implements Scala 3-style
   * "extensions are scoped to what's imported".
   *
   * Two patterns are recognized:
   *   1. Namespace: `import { NumberExt } from "@typesugar/std"`
   *      → if NumberExt has a callable `clamp` whose first param matches
   *        the receiver type, rewrite to `NumberExt.clamp(receiver, args)`
   *   2. Bare function: `import { clamp } from "@typesugar/std"`
   *      → if `clamp`'s first param matches the receiver type, rewrite to
   *        `clamp(receiver, args)`
   *
   * Results are cached per (receiverType, methodName) pair.
   */
  private resolveExtensionFromImports(
    node: ts.CallExpression,
    methodName: string,
    receiverType: ts.Type
  ): StandaloneExtensionInfo | undefined {
    const sourceFile = node.getSourceFile();

    // Cache lookup
    let methodCache = this.importExtensionCache.get(receiverType);
    if (!methodCache) {
      methodCache = new Map();
      this.importExtensionCache.set(receiverType, methodCache);
    }

    if (methodCache.has(methodName)) {
      return methodCache.get(methodName);
    }

    // Pass the node for error reporting on first resolution (not cached lookups)
    const result = this.scanImportsForExtension(sourceFile, methodName, receiverType, node);
    methodCache.set(methodName, result);
    return result;
  }

  /**
   * Extended extension info that tracks the import source for error messages.
   */
  private scanImportsForExtension(
    sourceFile: ts.SourceFile,
    methodName: string,
    receiverType: ts.Type,
    node?: ts.Node
  ): StandaloneExtensionInfo | undefined {
    // Guard against synthetic source files that lack statements
    if (!sourceFile || !sourceFile.statements) {
      return undefined;
    }

    // Collect all matching extensions for ambiguity detection
    const matches: Array<{ ext: StandaloneExtensionInfo; importSource: string }> = [];

    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;

      const clause = stmt.importClause;
      if (!clause) continue;

      const moduleSpecifier = stmt.moduleSpecifier;
      const importSource = ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : "unknown";

      // Check named imports: import { NumberExt, clamp } from "..."
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          const result = this.checkImportedSymbolForExtension(spec.name, methodName, receiverType);
          if (result) {
            matches.push({ ext: result, importSource });
          }
        }
      }

      // Check namespace import: import * as std from "..."
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const result = this.checkImportedSymbolForExtension(
          clause.namedBindings.name,
          methodName,
          receiverType
        );
        if (result) {
          matches.push({ ext: result, importSource });
        }
      }

      // Check default import: import Foo from "..."
      if (clause.name) {
        const result = this.checkImportedSymbolForExtension(clause.name, methodName, receiverType);
        if (result) {
          matches.push({ ext: result, importSource });
        }
      }
    }

    // No matches
    if (matches.length === 0) {
      return undefined;
    }

    // Single match - no ambiguity
    if (matches.length === 1) {
      return matches[0].ext;
    }

    // Multiple matches - check for ambiguity
    // If all matches have the same qualifier, they're the same extension (e.g., imported from multiple paths)
    const uniqueQualifiers = new Set(matches.map((m) => m.ext.qualifier ?? ""));
    if (uniqueQualifiers.size === 1) {
      // All matches point to the same extension
      return matches[0].ext;
    }

    // True ambiguity - multiple different extensions could apply
    const typeName = this.ctx.typeChecker.typeToString(receiverType);
    const sources = matches
      .map((m) => {
        const qual = m.ext.qualifier ? `${m.ext.qualifier}.${methodName}` : methodName;
        return `  - ${qual} (from "${m.importSource}")`;
      })
      .join("\n");

    const errorMessage =
      `Ambiguous extension method '${methodName}' for type '${typeName}'. ` +
      `Multiple extensions match:\n${sources}\n` +
      `Use an explicit qualifier or rename one of the imports to disambiguate.`;

    if (node) {
      this.ctx.reportError(node, errorMessage);
    }

    // Return the first match anyway so compilation can continue
    return matches[0].ext;
  }

  /**
   * Check if an imported identifier provides an extension method.
   *
   * Extension methods "just work" (UFCS-style): any imported function
   * whose first parameter matches the receiver type can be called as a method.
   *
   * Handles two cases:
   *   - The identifier IS a function named `methodName` whose first param
   *     matches the receiver type → bare function extension
   *   - The identifier is an object with a callable property named `methodName`
   *     whose first param matches → namespace extension
   *
   * The @extension decorator and "use extension" directive are used for:
   *   - Documentation: explicitly mark which functions are extensions
   *   - Re-exports: preserve extension status through module boundaries
   */
  private checkImportedSymbolForExtension(
    ident: ts.Identifier,
    methodName: string,
    receiverType: ts.Type
  ): StandaloneExtensionInfo | undefined {
    const symbol = this.ctx.typeChecker.getSymbolAtLocation(ident);
    if (!symbol) return undefined;

    const identType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(symbol, ident);

    // Case 1: bare function import — name matches methodName and first
    // param is assignable from the receiver type
    if (ident.text === methodName) {
      const callSigs = identType.getCallSignatures();
      for (const sig of callSigs) {
        const params = sig.getParameters();
        if (params.length === 0) continue;
        const firstParamType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(params[0], ident);
        if (this.isTypeCompatible(receiverType, firstParamType)) {
          return { methodName, forType: "", qualifier: undefined };
        }
      }
    }

    // Case 2: namespace object — has a property named methodName that is
    // callable with first param assignable from the receiver type
    const prop = identType.getProperty(methodName);
    if (!prop) return undefined;

    const propType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(prop, ident);
    const callSigs = propType.getCallSignatures();
    for (const sig of callSigs) {
      const params = sig.getParameters();
      if (params.length === 0) continue;
      const firstParamType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(params[0], ident);
      if (this.isTypeCompatible(receiverType, firstParamType)) {
        return { methodName, forType: "", qualifier: ident.text };
      }
    }

    return undefined;
  }

  /**
   * Check if a symbol is extension-enabled.
   * Returns true if:
   *   - The symbol's source file has "use extension" directive
   *   - The symbol has @extension decorator on its declaration
   *
   * This is used when we need to explicitly check extension status,
   * e.g., for re-exports or disambiguation.
   */

  // ---------------------------------------------------------------------------
  // PEP-027: Emit extension registration calls for "use extension" files
  // ---------------------------------------------------------------------------

  /**
   * For a "use extension" source file, scan its output statements for exported
   * functions and emit `globalThis.__typesugar_registerExtension?.({ methodName, forType })`
   * calls so the compiled dist self-registers its extensions at module load time.
   */
  private emitExtensionRegistrations(statements: ts.Statement[]): ts.Statement[] {
    const factory = this.ctx.factory;
    const registrations: ts.Statement[] = [];

    for (const stmt of statements) {
      // Handle: export function foo(self: Type, ...): RetType { ... }
      if (
        ts.isFunctionDeclaration(stmt) &&
        hasExportModifier(stmt) &&
        stmt.name &&
        stmt.parameters.length > 0
      ) {
        const forType = extractForTypeFromParam(stmt.parameters[0]);
        if (forType) {
          registrations.push(createRegistrationCall(factory, stmt.name.text, forType, undefined));
        }
      }

      // Handle: export const foo = (self: Type, ...) => { ... }
      if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
            decl.initializer.parameters.length > 0
          ) {
            const forType = extractForTypeFromParam(decl.initializer.parameters[0]);
            if (forType) {
              registrations.push(
                createRegistrationCall(factory, decl.name.text, forType, undefined)
              );
            }
          }
        }
      }
    }

    return registrations;
  }

  private isExtensionEnabled(symbol: ts.Symbol): boolean {
    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return false;
    }

    for (const decl of declarations) {
      const sourceFile = decl.getSourceFile();
      const fileName = sourceFile.fileName;

      // Declaration files (.d.ts) can only have @extension decorator
      if (sourceFile.isDeclarationFile) {
        if (this.hasExtensionDecorator(decl)) {
          return true;
        }
        continue;
      }

      // For source files, check both directive and decorator
      if (fileName !== this.ctx.sourceFile.fileName) {
        scanImportsForScope(sourceFile, globalResolutionScope);
      }

      if (globalResolutionScope.hasUseExtension(fileName)) {
        return true;
      }

      if (this.hasExtensionDecorator(decl)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a declaration has the @extension decorator.
   */
  private hasExtensionDecorator(node: ts.Node): boolean {
    if (!ts.canHaveDecorators(node)) return false;

    const decorators = ts.getDecorators(node);
    if (!decorators) return false;

    for (const decorator of decorators) {
      const expr = decorator.expression;
      if (ts.isIdentifier(expr) && expr.text === "extension") {
        return true;
      }
      if (
        ts.isCallExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "extension"
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if `source` is assignable to `target` (for extension method
   * first-parameter matching). Handles primitives, classes, and interfaces.
   */
  private isTypeCompatible(source: ts.Type, target: ts.Type): boolean {
    // Use the type checker's assignability check
    return this.ctx.typeChecker.isTypeAssignableTo(source, target);
  }

  /**
   * Resolve an identifier to a macro definition via import tracking.
   */
  private resolveMacroFromSymbol(
    node: ts.Node,
    macroName: string,
    kind: MacroDefinition["kind"]
  ): MacroDefinition | undefined {
    let symbol: ts.Symbol | undefined;
    try {
      symbol = this.ctx.typeChecker.getSymbolAtLocation(node);
    } catch {
      // Type checker may fail on nodes from preprocessed source files
      // that aren't part of the original program. Fall back to import-aware name lookup.
      return this.fallbackNameLookupWithImports(macroName, kind);
    }
    if (!symbol) {
      return this.fallbackNameLookupWithImports(macroName, kind);
    }

    const symbolId = (symbol as unknown as { id?: number }).id;
    if (symbolId !== undefined && this.symbolMacroCache.has(symbolId)) {
      return this.symbolMacroCache.get(symbolId) ?? undefined;
    }

    const result = this.resolveSymbolToMacro(symbol, macroName, kind);

    if (symbolId !== undefined) {
      this.symbolMacroCache.set(symbolId, result ?? null);
    }

    // Track the import specifier so we can remove it later
    if (result) {
      this.recordMacroImport(symbol);
    }

    return result;
  }

  /**
   * Core symbol resolution: follow aliases to find the original declaration,
   * then check if it comes from a known macro module.
   */
  private resolveSymbolToMacro(
    symbol: ts.Symbol,
    macroName: string,
    kind: MacroDefinition["kind"]
  ): MacroDefinition | undefined {
    let resolved = symbol;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      try {
        resolved = this.ctx.typeChecker.getAliasedSymbol(resolved);
      } catch {
        // getAliasedSymbol can throw for unresolvable symbols
      }
    }

    const declarations = resolved.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return this.fallbackNameLookupWithImports(macroName, kind);
    }

    for (const decl of declarations) {
      const sourceFile = decl.getSourceFile();
      const fileName = sourceFile.fileName;

      const moduleSpecifier = this.resolveModuleSpecifier(fileName);
      if (moduleSpecifier) {
        const exportName = resolved.name;
        const macro = globalRegistry.getByModuleExport(moduleSpecifier, exportName);
        if (macro && macro.kind === kind) {
          return macro;
        }
        if (exportName !== macroName) {
          const macroByName = globalRegistry.getByModuleExport(moduleSpecifier, macroName);
          if (macroByName && macroByName.kind === kind) {
            return macroByName;
          }
        }
      }
    }

    // Symbol resolved but didn't match a macro module -- try name-based
    // lookup. Use the local call-site name first, then the resolved
    // (original export) name for renamed imports like `import { foo as bar }`.
    const byLocalName = this.fallbackNameLookupWithImports(macroName, kind);
    if (byLocalName) return byLocalName;

    const originalName = resolved.name;
    if (originalName !== macroName) {
      const byOriginalName = this.fallbackNameLookupWithImports(originalName, kind);
      if (byOriginalName) return byOriginalName;
    }

    return undefined;
  }

  /**
   * Map a file path back to a module specifier like "typesugar" or "@typesugar/units".
   */
  private resolveModuleSpecifier(fileName: string): string | undefined {
    const normalized = fileName.replace(/\\/g, "/");

    // Check for scoped packages in node_modules
    const nodeModulesMatch = normalized.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (nodeModulesMatch) {
      const pkgName = nodeModulesMatch[1];
      if (pkgName.startsWith("@typesugar/")) {
        return pkgName;
      }
      if (pkgName === "typesugar") {
        return "typesugar";
      }
      return pkgName;
    }

    // Development mode: detect from source tree structure using generic regex
    // Matches /packages/<package-name>/ and returns @typesugar/<package-name>
    const packagesMatch = normalized.match(/\/packages\/([a-z0-9-]+)\//);
    if (packagesMatch) {
      const pkgName = packagesMatch[1];
      // Special case: the main "typesugar" package
      if (pkgName === "typesugar") {
        return "typesugar";
      }
      return `@typesugar/${pkgName}`;
    }

    return undefined;
  }

  /**
   * Fall back to name-based lookup for macros without module requirement.
   */
  private fallbackNameLookup(
    name: string,
    kind: MacroDefinition["kind"]
  ): MacroDefinition | undefined {
    let macro: MacroDefinition | undefined;
    switch (kind) {
      case "expression":
        macro = globalRegistry.getExpression(name);
        break;
      case "attribute":
        macro = globalRegistry.getAttribute(name);
        break;
      case "derive":
        macro = globalRegistry.getDerive(name);
        break;
      case "tagged-template":
        macro = globalRegistry.getTaggedTemplate(name);
        break;
      case "type":
        macro = globalRegistry.getType(name);
        break;
      case "labeled-block":
        macro = globalRegistry.getLabeledBlock(name);
        break;
    }

    if (macro?.module) {
      return undefined;
    }

    return macro;
  }

  /**
   * Fall back to name-based lookup with import verification.
   * When symbol resolution fails but the name is imported from a known
   * typesugar module, allow macros that require specific modules.
   */
  private fallbackNameLookupWithImports(
    name: string,
    kind: MacroDefinition["kind"]
  ): MacroDefinition | undefined {
    let macro: MacroDefinition | undefined;
    switch (kind) {
      case "expression":
        macro = globalRegistry.getExpression(name);
        break;
      case "attribute":
        macro = globalRegistry.getAttribute(name);
        break;
      case "derive":
        macro = globalRegistry.getDerive(name);
        break;
      case "tagged-template":
        macro = globalRegistry.getTaggedTemplate(name);
        break;
      case "type":
        macro = globalRegistry.getType(name);
        break;
      case "labeled-block":
        macro = globalRegistry.getLabeledBlock(name);
        break;
    }

    if (!macro) return undefined;

    // If macro doesn't require a specific module, allow it
    if (!macro.module) {
      return macro;
    }

    // Macro requires a specific module - check if the name is imported
    // from a matching module
    const importedModule = this.findImportModuleForName(name);
    if (!importedModule) {
      return undefined;
    }

    // Check if the imported module matches the macro's required module
    if (this.moduleMatchesMacro(importedModule, macro.module)) {
      return macro;
    }

    return undefined;
  }

  /**
   * Scan the source file's imports to find the module specifier for a name.
   */
  private findImportModuleForName(name: string): string | undefined {
    const sourceFile = this.ctx.sourceFile;

    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;

      const moduleSpecifier = stmt.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) continue;

      const moduleName = moduleSpecifier.text;
      const importClause = stmt.importClause;
      if (!importClause) continue;

      // Named imports: import { comptime } from "typesugar"
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          if (localName === name) {
            return moduleName;
          }
        }
      }

      // Namespace import: import * as ts from "typesugar"
      // In this case, the name would be accessed as ts.comptime, which we
      // handle separately via property access expression
    }

    return undefined;
  }

  /**
   * Check if an imported module matches the macro's required module.
   * Handles aliases and legacy project names (typemacro, ttfx, macrots).
   */
  private moduleMatchesMacro(importedModule: string, macroModule: string): boolean {
    // Direct match
    if (importedModule === macroModule) return true;

    // Legacy project names that should match any @typesugar/* import
    const legacyAliases = ["typemacro", "ttfx", "macrots"];

    // Known aliases: support legacy project names for backwards compatibility
    const aliases: Record<string, string[]> = {
      typesugar: legacyAliases,
      typemacro: ["typesugar", "ttfx", "macrots"],
    };

    const importAliases = aliases[importedModule];
    if (importAliases?.includes(macroModule)) return true;

    // Umbrella package "typesugar" re-exports from all @typesugar/* packages
    // so importing from "typesugar" should match any @typesugar/* macro module
    if (importedModule === "typesugar" && macroModule.startsWith("@typesugar/")) {
      return true;
    }

    // Reverse: macros registered under "typesugar" (umbrella) should match
    // when imported from any @typesugar/* sub-package
    if (macroModule === "typesugar" && importedModule.startsWith("@typesugar/")) {
      return true;
    }

    // @typesugar/* packages should match their package name AND legacy aliases
    if (importedModule.startsWith("@typesugar/")) {
      const pkgName = importedModule.slice("@typesugar/".length);
      if (macroModule === pkgName || macroModule === `@typesugar/${pkgName}`) {
        return true;
      }
      // Also match legacy project names (typemacro, ttfx, macrots)
      if (legacyAliases.includes(macroModule)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Visit a node and potentially transform it
   */
  visit(node: ts.Node): ts.Node | ts.Node[] {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
    }

    // Handle = implicit() function scope tracking for propagation
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)) &&
      hasImplicitParams(node)
    ) {
      return this.visitImplicitParamsFunction(node);
    }

    const transformed = this.tryTransform(node);
    if (transformed !== undefined) {
      return transformed;
    }

    return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
  }

  /**
   * Visit a node that contains a statement list.
   */
  private visitStatementContainer(
    node: ts.SourceFile | ts.Block | ts.ModuleBlock
  ): ts.SourceFile | ts.Block | ts.ModuleBlock {
    const statements = Array.from(node.statements);
    const newStatements: ts.Statement[] = [];
    let modified = false;

    // Scope SpecializationCache to the current block to preserve closures
    const prevSpecCache = this.specCache;
    this.specCache = new SpecializationCache();

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // ---------------------------------------------------------------
      // Expression-level do-notation: const x = let: { ... } yield: { ... }
      //
      // When TS parses `const x =\nlet: { a << e1; b << e2; }\nyield: { a + b }`,
      // it produces these fragments (because `let` is consumed as identifier initializer):
      //   [i]   VariableStatement: decls=[x=let, {a}]  (destructuring captures 1st bind name)
      //   [i+1] ExpressionStatement: << e1              (1st bind effect)
      //   [i+2] ExpressionStatement: b << e2            (subsequent binds/maps)
      //   ...
      //   [i+n] LabeledStatement: yield: { a + b }      (continuation)
      //
      // We detect this pattern, reconstruct a synthetic let: block + yield: continuation,
      // pass them to the macro, and wrap the result in `const x = <expr>`.
      // ---------------------------------------------------------------
      if (ts.isVariableStatement(stmt)) {
        const decls = stmt.declarationList.declarations;
        if (decls.length === 2) {
          const firstDecl = decls[0];
          const secondDecl = decls[1];
          if (
            firstDecl.initializer &&
            ts.isIdentifier(firstDecl.initializer) &&
            (firstDecl.initializer.text === "let" || firstDecl.initializer.text === "seq") &&
            ts.isObjectBindingPattern(secondDecl.name) &&
            secondDecl.name.elements.length >= 1
          ) {
            const labelName = firstDecl.initializer.text;
            const macro = globalRegistry.getLabeledBlock(labelName);
            if (macro) {
              // Extract first bind name from destructuring pattern { a }
              const firstBindName = secondDecl.name.elements[0].name;
              if (!ts.isIdentifier(firstBindName)) {
                // Not a valid pattern — fall through to normal processing
              } else {
                // Consume fragment statements: << e1, b << e2, if(...), etc.
                // until we hit a yield:/pure:/return: LabeledStatement or end of block
                const fragmentStmts: ts.Statement[] = [];
                let j = i + 1;

                // First fragment: ExpressionStatement with << e1 (the first bind's effect)
                let firstBindEffect: ts.Expression | undefined;
                if (j < statements.length && ts.isExpressionStatement(statements[j])) {
                  const expr = (statements[j] as ts.ExpressionStatement).expression;
                  if (
                    ts.isBinaryExpression(expr) &&
                    expr.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
                  ) {
                    // The left side is empty/invalid identifier (from the destructuring split)
                    firstBindEffect = expr.right;
                    j++;
                  }
                }

                if (firstBindEffect) {
                  // Collect remaining bind/map/guard statements
                  while (j < statements.length) {
                    const frag = statements[j];
                    // Stop at yield:/pure:/return: continuation
                    if (
                      ts.isLabeledStatement(frag) &&
                      macro.continuationLabels?.includes(frag.label.text)
                    ) {
                      break;
                    }
                    // Accept ExpressionStatements (binds, maps) and IfStatements (guards)
                    if (ts.isExpressionStatement(frag) || ts.isIfStatement(frag)) {
                      fragmentStmts.push(frag);
                      j++;
                      continue;
                    }
                    break; // Unknown statement type — stop consuming
                  }

                  // Check for yield:/pure:/return: continuation
                  let continuation: ts.LabeledStatement | undefined;
                  if (
                    j < statements.length &&
                    ts.isLabeledStatement(statements[j]) &&
                    macro.continuationLabels?.includes(
                      (statements[j] as ts.LabeledStatement).label.text
                    )
                  ) {
                    continuation = statements[j] as ts.LabeledStatement;
                    j++;
                  }

                  // Reconstruct a synthetic `let: { a << e1; b << e2; ... }` labeled statement
                  const factory = this.ctx.factory;

                  // Build the first bind: `a << e1;`
                  const firstBindStmt = factory.createExpressionStatement(
                    factory.createBinaryExpression(
                      factory.createIdentifier(firstBindName.text),
                      factory.createToken(ts.SyntaxKind.LessThanLessThanToken),
                      firstBindEffect
                    )
                  );

                  // Combine: first bind + remaining fragments
                  const blockStatements = [firstBindStmt, ...fragmentStmts];
                  const syntheticBlock = factory.createBlock(blockStatements);
                  const syntheticLabel = factory.createLabeledStatement(
                    factory.createIdentifier(labelName),
                    syntheticBlock
                  );

                  if (this.verbose) {
                    console.log(
                      `[typesugar] Reconstructed expression-level ${labelName}:/yield: for const ${firstDecl.name.getText(this.ctx.sourceFile)}`
                    );
                  }

                  try {
                    const result = this.ctx.hygiene.withScope(() =>
                      macro.expand(this.ctx, syntheticLabel, continuation)
                    );
                    let expanded = Array.isArray(result) ? result : [result];

                    // Wrap in variable declaration: const x = <expanded expr>
                    if (expanded.length === 1 && ts.isExpressionStatement(expanded[0])) {
                      const expr = expanded[0].expression;
                      const newDecl = factory.createVariableDeclaration(
                        firstDecl.name,
                        undefined,
                        undefined,
                        expr
                      );
                      const newDeclList = factory.createVariableDeclarationList(
                        [newDecl],
                        stmt.declarationList.flags
                      );
                      expanded = [factory.createVariableStatement(stmt.modifiers, newDeclList)];
                    }

                    for (const s of expanded) {
                      const visited = ts.visitNode(s, this.visit.bind(this));
                      if (visited) {
                        if (Array.isArray(visited)) {
                          newStatements.push(...(visited as ts.Node[]).filter(ts.isStatement));
                        } else {
                          newStatements.push(visited as ts.Statement);
                        }
                      }
                    }

                    // Advance past all consumed statements
                    i = j - 1;
                    modified = true;
                    continue;
                  } catch (error) {
                    this.ctx.reportError(
                      stmt,
                      `Expression-level ${labelName}:/yield: expansion failed: ${error}`
                    );
                  }
                }
              }
            }
          }
        }
      }

      if (ts.isLabeledStatement(stmt)) {
        const labelName = stmt.label.text;
        const macro = globalRegistry.getLabeledBlock(labelName);

        if (macro) {
          // Check for inline opt-out of macros
          if (isInOptedOutScope(this.ctx.sourceFile, stmt, globalResolutionScope, "macros")) {
            const visited = ts.visitNode(stmt, this.visit.bind(this));
            if (visited && ts.isStatement(visited)) {
              newStatements.push(visited);
            }
            continue;
          }

          if (this.verbose) {
            console.log(`[typesugar] Expanding labeled block macro: ${labelName}:`);
          }

          let continuation: ts.LabeledStatement | undefined;
          if (macro.continuationLabels && i + 1 < statements.length) {
            const next = statements[i + 1];
            if (ts.isLabeledStatement(next) && macro.continuationLabels.includes(next.label.text)) {
              continuation = next;
              i++;
            }
          }

          try {
            // Wrap expansion in a hygiene scope so generated names are isolated
            const result = this.ctx.hygiene.withScope(() =>
              macro.expand(this.ctx, stmt, continuation)
            );
            const expanded = Array.isArray(result) ? result : [result];

            for (const s of expanded) {
              const visited = ts.visitNode(s, this.visit.bind(this));
              if (visited) {
                if (Array.isArray(visited)) {
                  newStatements.push(...(visited as ts.Node[]).filter(ts.isStatement));
                } else {
                  newStatements.push(visited as ts.Statement);
                }
              }
            }
          } catch (error) {
            this.ctx.reportError(stmt, `Labeled block macro expansion failed: ${error}`);
            newStatements.push(
              this.createMacroErrorStatement(
                `typesugar: labeled block '${labelName}:' expansion failed: ${error}`
              )
            );
          }

          modified = true;
          continue;
        }
      }

      // Call visit directly instead of ts.visitNode to handle array returns
      const visited = this.visit(stmt);
      if (visited) {
        if (Array.isArray(visited)) {
          for (const n of visited as ts.Node[]) {
            if (!ts.isStatement(n)) continue;
            if (isRemovedStatement(n)) {
              const replacement = createCommentReplacement(this.ctx.factory, n);
              if (replacement) newStatements.push(replacement);
              modified = true;
            } else {
              newStatements.push(n);
            }
          }
          modified = true;
        } else if (ts.isStatement(visited)) {
          if (isRemovedStatement(visited)) {
            const replacement = createCommentReplacement(this.ctx.factory, visited);
            if (replacement) newStatements.push(replacement);
            modified = true;
          } else {
            newStatements.push(visited);
          }
        }
      }
    }

    // Clean up macro imports (only for source files — imports live at top level)
    let cleanedStatements = ts.isSourceFile(node)
      ? this.cleanupMacroImports(newStatements)
      : newStatements;

    // For source files: inject pending aliased imports from reference hygiene,
    // hoisted specialization declarations, and type-rewrite method erasure imports
    if (ts.isSourceFile(node)) {
      // Get pending aliased imports from FileBindingCache (for reference hygiene)
      const pendingImports = this.ctx.fileBindingCache.getPendingImports();

      // Get hoisted specialization declarations
      const hoistedDecls = this.specCache.getHoistedDeclarations();

      // Build type-rewrite import declarations (PEP-012 Wave 3)
      const typeRewriteImports = this.buildTypeRewriteImportDeclarations();

      const hasInjections =
        pendingImports.length > 0 || hoistedDecls.length > 0 || typeRewriteImports.length > 0;

      if (hasInjections) {
        // Find insertion point after existing imports
        let insertIndex = 0;
        for (let i = 0; i < cleanedStatements.length; i++) {
          if (ts.isImportDeclaration(cleanedStatements[i])) {
            insertIndex = i + 1;
          } else {
            break;
          }
        }

        // Inject: [existing imports..., type-rewrite imports, aliased imports, hoisted decls, rest of file...]
        cleanedStatements = [
          ...cleanedStatements.slice(0, insertIndex),
          ...typeRewriteImports,
          ...pendingImports,
          ...hoistedDecls,
          ...cleanedStatements.slice(insertIndex),
        ];

        if (this.verbose) {
          if (typeRewriteImports.length > 0) {
            console.log(
              `[typesugar] Injected ${typeRewriteImports.length} type-rewrite import(s) for method erasure`
            );
          }
          if (pendingImports.length > 0) {
            console.log(
              `[typesugar] Injected ${pendingImports.length} aliased import(s) for reference hygiene`
            );
          }
          if (hoistedDecls.length > 0) {
            console.log(
              `[typesugar] Hoisted ${hoistedDecls.length} specialized function(s) to local scope`
            );
          }
        }

        // Log hygiene stats if verbose
        this.ctx.fileBindingCache.logStats(this.ctx.sourceFile.fileName);
      }
    } else {
      // For blocks (not source files), only inject hoisted declarations
      const hoistedDecls = this.specCache.getHoistedDeclarations();
      if (hoistedDecls.length > 0) {
        cleanedStatements = [...hoistedDecls, ...cleanedStatements];

        if (this.verbose) {
          console.log(
            `[typesugar] Hoisted ${hoistedDecls.length} specialized function(s) to local scope`
          );
        }
      }
    }

    // Restore previous scope's specialization cache
    this.specCache = prevSpecCache;

    if (ts.isSourceFile(node)) {
      cleanedStatements = eliminateDeadDerivedInstances(
        cleanedStatements,
        this.inlinedInstanceNames,
        this.verbose
      );
    }

    // PEP-027: Emit extension registration calls for "use extension" files.
    // When a file has the "use extension" directive, append registration calls
    // for each exported function so the dist self-registers its extensions.
    if (ts.isSourceFile(node) && globalResolutionScope.hasUseExtension(node.fileName)) {
      const regCalls = this.emitExtensionRegistrations(cleanedStatements);
      if (regCalls.length > 0) {
        cleanedStatements = [...cleanedStatements, ...regCalls];
        if (this.verbose) {
          console.log(
            `[typesugar] Emitted ${regCalls.length} extension registration call(s) for ${node.fileName}`
          );
        }
      }
    }

    const factory = this.ctx.factory;
    if (ts.isSourceFile(node)) {
      return factory.updateSourceFile(node, cleanedStatements);
    } else if (ts.isBlock(node)) {
      return factory.updateBlock(node, cleanedStatements);
    } else {
      return factory.updateModuleBlock(node, cleanedStatements);
    }
  }

  // ---------------------------------------------------------------------------
  // Import cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove or trim import declarations whose specifiers resolved to macros.
   *
   * For each import declaration that had at least one specifier recorded in
   * `macroImportSpecifiers`:
   *
   *  - If *all* named specifiers (and default/namespace binding) are macro-only,
   *    the entire import declaration is removed.
   *  - If only *some* named specifiers are macro-only, those specifiers are
   *    removed and the import is preserved with the remaining ones.
   *  - Namespace imports (`import * as M`) are removed only if the sentinel
   *    `"namespace"` was recorded.
   *  - Side-effect-only imports (`import "module"`) are never touched.
   */
  private cleanupMacroImports(statements: ts.Statement[]): ts.Statement[] {
    if (this.macroImportSpecifiers.size === 0) return statements;

    const factory = this.ctx.factory;
    const result: ts.Statement[] = [];

    for (const stmt of statements) {
      if (!ts.isImportDeclaration(stmt)) {
        result.push(stmt);
        continue;
      }

      const tracked = this.macroImportSpecifiers.get(stmt);
      if (!tracked) {
        result.push(stmt);
        continue;
      }

      const importClause = stmt.importClause;
      if (!importClause) {
        result.push(stmt);
        continue;
      }

      const hasDefaultImport = importClause.name !== undefined;
      const defaultIsMacro = tracked.has("default");
      const keepDefault = hasDefaultImport && !defaultIsMacro;

      const namedBindings = importClause.namedBindings;
      let newNamedBindings: ts.NamedImportBindings | undefined;

      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) {
          if (tracked.has("namespace")) {
            newNamedBindings = undefined;
          } else {
            newNamedBindings = namedBindings;
          }
        } else if (ts.isNamedImports(namedBindings)) {
          const remainingSpecifiers = namedBindings.elements.filter((spec) => !tracked.has(spec));

          if (remainingSpecifiers.length === namedBindings.elements.length) {
            newNamedBindings = namedBindings;
          } else if (remainingSpecifiers.length > 0) {
            newNamedBindings = factory.updateNamedImports(namedBindings, remainingSpecifiers);
          } else {
            newNamedBindings = undefined;
          }
        }
      }

      if (!keepDefault && !newNamedBindings) {
        if (this.verbose) {
          const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
            ? stmt.moduleSpecifier.text
            : "<unknown>";
          console.log(`[typesugar] Removing macro-only import: import ... from "${moduleSpec}"`);
        }
        continue;
      }

      const newImportClause = factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        keepDefault ? importClause.name : undefined,
        newNamedBindings
      );

      const newImport = factory.updateImportDeclaration(
        stmt,
        stmt.modifiers,
        newImportClause,
        stmt.moduleSpecifier,
        stmt.attributes
      );

      if (this.verbose) {
        const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : "<unknown>";
        console.log(`[typesugar] Trimmed macro specifiers from import: "${moduleSpec}"`);
      }

      result.push(newImport);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Auto-specialization
  // ---------------------------------------------------------------------------

  /**
   * Get the instance dictionary name from an expression.
   * Handles direct identifiers, property accesses, and type assertions.
   */
  private getInstanceName(expr: ts.Expression): string | undefined {
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      // Return full dotted path for companion paths (e.g. "Point.Eq")
      const objName = this.getInstanceName(expr.expression);
      if (objName) {
        return `${objName}.${expr.name.text}`;
      }
      return expr.name.text;
    }
    if (ts.isParenthesizedExpression(expr)) {
      return this.getInstanceName(expr.expression);
    }
    if (ts.isAsExpression(expr)) {
      return this.getInstanceName(expr.expression);
    }
    return undefined;
  }

  /**
   * Check if a variable declaration has @impl or @instance in its JSDoc.
   * Auto-specialization happens for ALL @impl instances where method bodies
   * can be extracted from the source object literal.
   * Handles JSDoc on both the declaration and its parent statement.
   */
  private hasImplAnnotation(decl: ts.Declaration): boolean {
    // Check the declaration itself
    const jsDocs = ts.getJSDocTags(decl);
    for (const tag of jsDocs) {
      if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
        return true;
      }
    }

    // Check the parent statement (JSDoc is often attached to VariableStatement)
    if (ts.isVariableDeclaration(decl)) {
      const parent = decl.parent?.parent; // VariableDeclaration -> VariableDeclarationList -> VariableStatement
      if (parent && ts.isVariableStatement(parent)) {
        const parentTags = ts.getJSDocTags(parent);
        for (const tag of parentTags) {
          if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract the brand (type name) from @impl annotation.
   * E.g., @impl Functor<Array> → "Array"
   * Handles JSDoc on both the declaration and its parent statement.
   */
  private extractBrandFromImpl(decl: ts.Declaration): string | undefined {
    const extractFromTags = (tags: readonly ts.JSDocTag[]): string | undefined => {
      for (const tag of tags) {
        if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
          const comment =
            typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
          if (comment) {
            const extracted = extractTypeArgumentsContent(comment.trim());
            if (extracted !== undefined) return extracted;
          }
        }
      }
      return undefined;
    };

    // Check the declaration itself
    const result = extractFromTags(ts.getJSDocTags(decl));
    if (result) return result;

    // Check the parent statement (JSDoc is often attached to VariableStatement)
    if (ts.isVariableDeclaration(decl)) {
      const parent = decl.parent?.parent; // VariableDeclaration -> VariableDeclarationList -> VariableStatement
      if (parent && ts.isVariableStatement(parent)) {
        return extractFromTags(ts.getJSDocTags(parent));
      }
    }

    return undefined;
  }

  /**
   * Try to extract instance methods from source for auto-specialization.
   * Auto-specialization happens automatically for ALL @impl instances where
   * method bodies can be extracted from the source object literal.
   * No @specialize annotation needed - @impl is sufficient.
   *
   * @param argExpr - The argument expression (identifier or property access)
   * @returns DictMethodMap if @impl is found and methods can be extracted, undefined otherwise
   */
  private tryExtractInstanceFromSource(argExpr: ts.Expression): DictMethodMap | undefined {
    const argName = this.getInstanceName(argExpr);
    if (!argName) return undefined;

    try {
      // Resolve the argument to its declaration
      const symbol = this.ctx.typeChecker.getSymbolAtLocation(argExpr);
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const decl of declarations) {
        // Auto-specialize all @impl instances
        if (!this.hasImplAnnotation(decl)) continue;

        // Find the object literal initializer
        let objLiteral: ts.ObjectLiteralExpression | undefined;
        let varDecl: ts.VariableDeclaration | undefined;

        if (ts.isVariableDeclaration(decl)) {
          varDecl = decl;
          if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
            objLiteral = decl.initializer;
          }
        }

        if (!objLiteral) continue;

        // Extract brand from @impl annotation or infer from type annotation
        let brand = this.extractBrandFromImpl(decl);

        // Fallback: try to infer brand from type annotation
        if (!brand && varDecl?.type) {
          try {
            // Try to get the type argument from the type annotation
            if (ts.isTypeReferenceNode(varDecl.type) && varDecl.type.typeArguments) {
              const firstTypeArg = varDecl.type.typeArguments[0];
              if (firstTypeArg) {
                brand = safeGetNodeText(firstTypeArg, this.ctx.sourceFile);
              }
            }

            // Fallback: use getText() if type reference extraction didn't work
            if (!brand) {
              const typeStr = varDecl.type.getText(this.ctx.sourceFile);
              const extracted = extractTypeArgumentsContent(typeStr);
              if (extracted) {
                brand = extracted;
              }
            }
          } catch {
            // Brand extraction from type annotation failed, continue with fallbacks
          }
        }

        // Fallback: use the variable name as brand
        if (!brand) {
          brand = argName;
        }

        // Extract methods from the object literal
        const methods = extractMethodsFromObjectLiteral(objLiteral, this.ctx.hygiene);
        if (methods.size > 0) {
          // Register for caching (so subsequent calls in the same file use cache)
          registerInstanceMethodsFromAST(argName, brand, methods);
          return { brand, methods };
        }
      }
    } catch {
      // Fallback to registry-based lookup on error
    }

    return undefined;
  }

  /**
   * Resolve a function expression to its body for auto-specialization.
   */
  private resolveAutoSpecFunctionBody(
    fnExpr: ts.Expression
  ): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined {
    if (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)) {
      return fnExpr;
    }

    if (ts.isIdentifier(fnExpr)) {
      try {
        const symbol = this.ctx.typeChecker.getSymbolAtLocation(fnExpr);
        if (!symbol) return undefined;
        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;

        for (const decl of declarations) {
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              return decl.initializer;
            }
          }
          // Only return function declarations that have a body
          // (skip ambient declarations like `declare function foo()`)
          if (ts.isFunctionDeclaration(decl) && decl.body) {
            return decl;
          }
        }
      } catch {
        return undefined;
      }
    }

    if (ts.isPropertyAccessExpression(fnExpr)) {
      try {
        const symbol = this.ctx.typeChecker.getSymbolAtLocation(fnExpr);
        if (!symbol) return undefined;
        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return undefined;

        for (const decl of declarations) {
          if (ts.isVariableDeclaration(decl) && decl.initializer) {
            if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
              return decl.initializer;
            }
          }
          // Only return function declarations that have a body
          if (ts.isFunctionDeclaration(decl) && decl.body) {
            return decl;
          }
        }
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Rewrite dictionary method calls (D.method(args)) with inlined implementations.
   */
  private rewriteDictCallsForAutoSpec(
    node: ts.Node,
    dictParamMap: Map<string, DictMethodMap>
  ): ts.Node {
    const self = this;

    function visit(n: ts.Node): ts.Node {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression)
      ) {
        const dictParamName = n.expression.expression.text;
        const dictMethods = dictParamMap.get(dictParamName);

        if (dictMethods) {
          const methodName = n.expression.name.text;
          const method = dictMethods.methods.get(methodName);

          if (method) {
            const inlined = inlineMethod(self.ctx, method, Array.from(n.arguments));
            if (inlined) {
              const mapped = preserveSourceMap(inlined, n);
              return ts.visitEachChild(mapped, visit, self.ctx.transformContext);
            }
          }
        }
      }

      return ts.visitEachChild(n, visit, self.ctx.transformContext);
    }

    return ts.visitNode(node, visit) as ts.Node;
  }

  /**
   * Inline dictionary method calls for hoisting — returns the specialized function
   * expression (not a call), which can be hoisted to module scope.
   */
  private inlineAutoSpecializeForHoisting(
    fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    instanceArgs: { index: number; name: string; methods: DictMethodMap }[],
    _fnName: string
  ): ts.Expression | undefined {
    const params = Array.from(fn.parameters);
    if (params.length === 0) return undefined;

    const dictParamMap = new Map<string, DictMethodMap>();
    const dictParamIndices = new Set<number>();

    for (const instArg of instanceArgs) {
      if (instArg.index < params.length) {
        const param = params[instArg.index];
        const paramName = ts.isIdentifier(param.name) ? param.name.text : undefined;
        if (paramName) {
          dictParamMap.set(paramName, instArg.methods);
          dictParamIndices.add(instArg.index);
        }
      }
    }

    if (dictParamMap.size === 0) return undefined;

    const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
    if (!body) return undefined;

    const remainingParams = params.filter((_, i) => !dictParamIndices.has(i));
    const specializedBody = this.rewriteDictCallsForAutoSpec(body, dictParamMap);

    if (remainingParams.length === 0) {
      if (ts.isExpression(specializedBody)) {
        return this.ctx.factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          this.ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          specializedBody
        );
      }
      if (ts.isBlock(specializedBody)) {
        return this.ctx.factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          this.ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          specializedBody
        );
      }
    }

    return this.ctx.factory.createArrowFunction(
      undefined,
      undefined,
      remainingParams,
      undefined,
      this.ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      specializedBody as ts.ConciseBody
    );
  }

  /**
   * Auto-specialize a function call when arguments are registered typeclass instances.
   *
   * When a function call passes a typeclass instance dictionary as an argument,
   * this method auto-inlines the dictionary methods and hoists a specialized function.
   * This is the core zero-cost mechanism.
   */
  private tryAutoSpecialize(node: ts.CallExpression): ts.Expression | undefined {
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    // Check for opt-out comments
    const isSyntheticNode = node.pos === -1 || node.end === -1;
    // Suppress warnings for synthetic nodes (generated code) since there's
    // no meaningful source location to report
    let suppressWarnings = isSyntheticNode;

    if (!isSyntheticNode) {
      try {
        const sourceText = node.getSourceFile().text;
        const nodeStart = node.getStart();
        const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
        const lineText = sourceText.slice(lineStart, nodeStart);

        if (lineText.includes("@no-specialize")) {
          return undefined;
        }
        suppressWarnings = lineText.includes("@no-specialize-warn");
      } catch {
        // Proceed with auto-specialization if we can't read comments
      }
    }

    // Find which arguments are instance dictionaries (source-based or registry-based)
    const instanceArgs: {
      index: number;
      name: string;
      methods: DictMethodMap;
    }[] = [];

    for (let i = 0; i < node.arguments.length; i++) {
      const arg = node.arguments[i];
      const argName = this.getInstanceName(arg);
      if (!argName) continue;

      // Try source-based detection first (via @impl annotation)
      // Auto-specialization happens for all @impl instances per PEP-004
      let methods = this.tryExtractInstanceFromSource(arg);

      // Fall back to registry-based lookup for backwards compatibility
      if (!methods && isRegisteredInstance(argName)) {
        methods = getInstanceMethods(argName);
      }

      if (methods) {
        instanceArgs.push({ index: i, name: argName, methods });
      }
    }

    if (instanceArgs.length === 0) {
      return undefined;
    }

    const fnName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : "<anonymous>";

    // Try to resolve the called function to its body
    const fnBody = this.resolveAutoSpecFunctionBody(node.expression);
    if (!fnBody) {
      if (!suppressWarnings) {
        this.ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `function body not resolvable. ` +
            `Use explicit specialize() if you need guaranteed inlining.`
        );
      }
      return undefined;
    }

    // Check if the function body has patterns that prevent inlining
    const body = ts.isFunctionDeclaration(fnBody) ? fnBody.body : fnBody.body;
    if (body && ts.isBlock(body)) {
      const classification = classifyInlineFailureDetailed(body);
      if (classification.reason && !classification.canFlatten) {
        if (!suppressWarnings) {
          const help = getInlineFailureHelp(classification.reason);
          this.ctx.reportWarning(
            node,
            `[TS9602] Auto-specialization of ${fnName} skipped — ` +
              `${classification.reason}. ${help}`
          );
        }
        return undefined;
      }
    }

    if (this.verbose) {
      console.log(
        `[typesugar] Auto-specializing call to ${fnName} with instance: ${instanceArgs.map((a) => a.name).join(", ")}`
      );
    }

    // Compute cache key for deduplication
    let fnSymbolId = fnName;
    try {
      const fnSymbol = this.ctx.typeChecker.getSymbolAtLocation(node.expression);
      if (fnSymbol) {
        fnSymbolId = (fnSymbol as unknown as { id?: number }).id?.toString() ?? fnName;
      }
    } catch {
      // Use fnName as fallback
    }
    const dictBrands = instanceArgs.map((a) => a.methods.brand);
    const cacheKey = SpecializationCache.computeKey(fnSymbolId, dictBrands);

    // Check if this specialization is already cached
    const cachedEntry = this.specCache.get(cacheKey);
    if (cachedEntry) {
      if (this.verbose) {
        console.log(`[typesugar] Reusing cached specialization: ${cachedEntry.ident.text}`);
      }
      const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
      const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
      return this.ctx.factory.createCallExpression(
        cachedEntry.ident,
        node.typeArguments,
        remainingArgs
      );
    }

    // Specialize the function body by inlining dictionary method calls
    try {
      const specialized = this.inlineAutoSpecializeForHoisting(fnBody, instanceArgs, fnName);

      if (specialized) {
        const hoistedIdent = SpecializationCache.generateHoistedName(
          fnName,
          dictBrands,
          this.ctx.hygiene
        );
        const hoistedDecl = createHoistedSpecialization(
          this.ctx.factory,
          hoistedIdent,
          specialized
        );

        this.specCache.set(cacheKey, hoistedIdent, hoistedDecl);

        if (this.verbose) {
          console.log(`[typesugar] Created hoisted specialization: ${hoistedIdent.text}`);
        }

        const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
        const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
        return this.ctx.factory.createCallExpression(
          hoistedIdent,
          node.typeArguments,
          remainingArgs
        );
      } else {
        if (!suppressWarnings) {
          this.ctx.reportWarning(
            node,
            `[TS9602] Auto-specialization of ${fnName} skipped — ` +
              `inlining returned no result. ` +
              `Use explicit specialize() if you need guaranteed inlining.`
          );
        }
      }
    } catch (error) {
      if (!suppressWarnings) {
        this.ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `${error}. Use explicit specialize() if you need guaranteed inlining.`
        );
      }
      if (this.verbose) {
        console.log(`[typesugar] Auto-specialization failed: ${error}`);
      }
    }

    return undefined;
  }

  /**
   * Inline a direct method call on a known derived typeclass instance.
   *
   * Handles: eqPoint.eq(p1, p2) → p1.x === p2.x && p1.y === p2.y
   */
  private tryInlineDerivedInstanceCall(node: ts.CallExpression): ts.Expression | undefined {
    if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
    if (!ts.isIdentifier(node.expression.expression)) return undefined;

    const instanceName = node.expression.expression.text;
    const methodName = node.expression.name.text;

    let methodMap = getInstanceOrIntrinsicMethods(instanceName);

    if (!methodMap) {
      methodMap = this.tryExtractInstanceFromSource(node.expression.expression);
    }

    if (!methodMap) return undefined;

    const method = methodMap.methods.get(methodName);
    if (!method) return undefined;

    const inlined = inlineMethod(this.ctx, method, Array.from(node.arguments));
    if (!inlined) return undefined;

    const result = this.recursivelyInlineInstanceCalls(inlined, 0);
    return preserveSourceMap(stripCommentsDeep(result), node);
  }

  private recursivelyInlineInstanceCalls(node: ts.Expression, depth: number): ts.Expression {
    if (depth >= 10) return node;

    const self = this;
    function visit(n: ts.Node): ts.Node {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression)
      ) {
        const instName = n.expression.expression.text;
        const methName = n.expression.name.text;

        const methods = getInstanceOrIntrinsicMethods(instName);
        if (methods) {
          const method = methods.methods.get(methName);
          if (method) {
            const inlined = inlineMethod(self.ctx, method, Array.from(n.arguments));
            if (inlined) {
              const deeper = self.recursivelyInlineInstanceCalls(inlined, depth + 1);
              return ts.visitEachChild(deeper, visit, self.ctx.transformContext);
            }
          }
        }
      }

      return ts.visitEachChild(n, visit, self.ctx.transformContext);
    }

    return ts.visitNode(node, visit) as ts.Expression;
  }

  /**
   * Print an expression to text and re-parse it to sever all associations
   * with the original source file. This prevents TypeScript's printer from
   * emitting stray comments from the original source into macro-generated code.
   */
  private reparseExpression(expr: ts.Expression, original: ts.Node): ts.Expression {
    const text = commentFreePrinter.printNode(ts.EmitHint.Expression, expr, this.ctx.sourceFile);
    const reparsed = this.ctx.parseExpression(text);
    return preserveSourceMap(reparsed, original);
  }

  /**
   * Try to specialize a function call based on the expected return type.
   *
   * When a function returning Result<E, T> is called in a context expecting
   * Option<T>, Either<E, T>, or bare T, this method automatically specializes
   * the function body by replacing ok()/err() with the target type's constructors.
   */
  private tryReturnTypeDrivenSpecialize(node: ts.CallExpression): ts.Expression | undefined {
    // 1. Get the return type of the called function
    let fnType: ts.Type;
    try {
      fnType = this.ctx.typeChecker.getTypeAtLocation(node.expression);
    } catch {
      return undefined;
    }
    const callSigs = fnType.getCallSignatures();
    if (!callSigs.length) return undefined;

    const returnType = callSigs[0].getReturnType();

    // 2. Check if return type is Result-like
    const returnTypeName = this.getTypeName(returnType);
    if (
      returnTypeName !== "Result" &&
      returnTypeName !== "Either" &&
      returnTypeName !== "Validation"
    ) {
      return undefined;
    }

    // 3. Get the contextual (expected) type
    const contextualType = this.getContextualTypeForCall(node);
    if (!contextualType) {
      return undefined;
    }

    // 4. Get the target type name
    const targetTypeName = this.getTypeName(contextualType);
    if (!targetTypeName) {
      return undefined;
    }

    // 5. Check if different from the return type
    if (returnTypeName === targetTypeName) {
      return undefined;
    }

    // 6. Look up the Result algebra for the target type
    const algebra = getResultAlgebra(targetTypeName);
    if (!algebra) {
      return undefined;
    }

    // 7. Get function name for diagnostics
    const fnName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : "<anonymous>";

    if (this.verbose) {
      console.log(
        `[typesugar] Return-type-driven specialization: ${fnName} from ${returnTypeName ?? "Result"} to ${targetTypeName}`
      );
    }

    // 8. Try to resolve the function body
    const fnBody = this.resolveAutoSpecFunctionBody(node.expression);
    if (!fnBody) {
      return undefined;
    }

    // 9. Compute cache key for deduplication
    let fnSymbolId = fnName;
    try {
      const fnSymbol = this.ctx.typeChecker.getSymbolAtLocation(node.expression);
      if (fnSymbol) {
        fnSymbolId = (fnSymbol as unknown as { id?: number }).id?.toString() ?? fnName;
      }
    } catch {
      // Use fnName as fallback
    }
    const cacheKey = SpecializationCache.computeKey(fnSymbolId, [algebra.name]);

    // 10. Check cache
    const cachedEntry = this.specCache.get(cacheKey);
    if (cachedEntry) {
      if (this.verbose) {
        console.log(
          `[typesugar] Reusing cached result-type specialization: ${cachedEntry.ident.text}`
        );
      }
      return this.ctx.factory.createCallExpression(
        cachedEntry.ident,
        node.typeArguments,
        Array.from(node.arguments)
      );
    }

    // 11. Specialize the function body by rewriting ok()/err() calls
    const specialized = this.specializeForResultAlgebra(fnBody, algebra);
    if (!specialized) {
      return undefined;
    }

    // 12. Generate a hoisted name and create the declaration
    const hoistedIdent = SpecializationCache.generateHoistedName(
      fnName,
      [algebra.name],
      this.ctx.hygiene
    );
    const hoistedDecl = createHoistedSpecialization(this.ctx.factory, hoistedIdent, specialized);

    // 13. Cache for reuse
    this.specCache.set(cacheKey, hoistedIdent, hoistedDecl);

    if (this.verbose) {
      console.log(`[typesugar] Created hoisted result-type specialization: ${hoistedIdent.text}`);
    }

    // 14. Call the hoisted specialized function
    return this.ctx.factory.createCallExpression(
      hoistedIdent,
      node.typeArguments,
      Array.from(node.arguments)
    );
  }

  // ---------------------------------------------------------------------------
  // Return-type-driven specialization helpers
  // ---------------------------------------------------------------------------

  private getTypeName(type: ts.Type): string | undefined {
    if (type.isUnion()) {
      for (const t of type.types) {
        if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue;
        const name = this.getTypeName(t);
        if (name) return name;
      }
    }
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    if (symbol) {
      return symbol.getName();
    }
    const typeStr = this.ctx.typeChecker.typeToString(type);
    const match = typeStr.match(/^(\w+)(?:<|$)/);
    return match ? match[1] : undefined;
  }

  private getContextualTypeForCall(node: ts.CallExpression): ts.Type | undefined {
    try {
      const contextual = this.ctx.typeChecker.getContextualType(node);
      if (contextual) return contextual;
    } catch {
      // Fall through to parent-based detection
    }

    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.type) {
      try {
        return this.ctx.typeChecker.getTypeFromTypeNode(parent.type);
      } catch {
        return undefined;
      }
    }

    if (ts.isReturnStatement(parent)) {
      let current: ts.Node | undefined = parent.parent;
      while (current) {
        if (
          (ts.isFunctionDeclaration(current) ||
            ts.isArrowFunction(current) ||
            ts.isFunctionExpression(current) ||
            ts.isMethodDeclaration(current)) &&
          current.type
        ) {
          try {
            return this.ctx.typeChecker.getTypeFromTypeNode(current.type);
          } catch {
            return undefined;
          }
        }
        current = current.parent;
      }
    }

    return undefined;
  }

  /**
   * Specialize a function for a Result algebra by rewriting ok()/err() calls.
   */
  private specializeForResultAlgebra(
    fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    algebra: ResultAlgebra
  ): ts.Expression | undefined {
    const params = Array.from(fn.parameters);
    const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
    if (!body) return undefined;

    const rewrittenBody = this.rewriteResultCalls(body, algebra);

    let finalBody: ts.ConciseBody = rewrittenBody as ts.ConciseBody;

    if (ts.isBlock(rewrittenBody)) {
      const analysis = analyzeForFlattening(rewrittenBody);
      if (analysis.canFlatten) {
        const flattened = flattenReturnsToExpression(this.ctx, rewrittenBody);
        if (flattened) {
          finalBody = flattened;
        }
      }
    }

    return this.ctx.factory.createArrowFunction(
      undefined,
      undefined,
      params,
      undefined,
      this.ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      finalBody
    );
  }

  /**
   * Rewrite ok() and err() calls in a function body using the target algebra.
   */
  private rewriteResultCalls(node: ts.Node, algebra: ResultAlgebra): ts.Node {
    const self = this;

    function visit(n: ts.Node): ts.Node {
      if (ts.isCallExpression(n)) {
        if (ts.isIdentifier(n.expression) && n.expression.text === "ok") {
          if (n.arguments.length >= 1) {
            const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteOk(self.ctx, visitedValue);
          }
          return algebra.rewriteOk(self.ctx, self.ctx.factory.createIdentifier("undefined"));
        }

        if (ts.isIdentifier(n.expression) && n.expression.text === "err") {
          if (n.arguments.length >= 1) {
            const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteErr(self.ctx, visitedError);
          }
          return algebra.rewriteErr(self.ctx, self.ctx.factory.createIdentifier("undefined"));
        }

        if (ts.isPropertyAccessExpression(n.expression)) {
          const obj = n.expression.expression;
          const method = n.expression.name.text;

          if (ts.isIdentifier(obj) && (obj.text === "Result" || obj.text === "R")) {
            if (method === "ok" && n.arguments.length >= 1) {
              const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
              return algebra.rewriteOk(self.ctx, visitedValue);
            }
            if (method === "err" && n.arguments.length >= 1) {
              const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
              return algebra.rewriteErr(self.ctx, visitedError);
            }
          }
        }
      }

      return ts.visitEachChild(n, visit, self.ctx.transformContext);
    }

    return ts.visitNode(node, visit) as ts.Node;
  }

  // ---------------------------------------------------------------------------
  // Macro expansion
  // ---------------------------------------------------------------------------

  /**
   * Try to transform a node if it's a macro invocation
   */
  private tryTransform(node: ts.Node): ts.Node | ts.Node[] | undefined {
    // PEP-019: Strip opaque type annotations before visiting children,
    // so `const x: Option<T> = Some(v)` becomes `const x = v`.
    if (ts.isVariableDeclaration(node)) {
      const stripped = this.tryStripOpaqueVarDeclAnnotation(node);
      if (stripped !== undefined) {
        return stripped;
      }
    }

    if (ts.isParameter(node)) {
      const stripped = this.tryStripOpaqueParamAnnotation(node);
      if (stripped !== undefined) {
        return stripped;
      }
    }

    if (ts.isFunctionDeclaration(node) && node.type) {
      if (this.shouldStripOpaqueReturnType(node.type)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.FunctionDeclaration;
        return this.ctx.factory.updateFunctionDeclaration(
          visited,
          visited.modifiers,
          visited.asteriskToken,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.body
        );
      }
    }
    if (ts.isFunctionExpression(node) && node.type) {
      if (this.shouldStripOpaqueReturnType(node.type)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.FunctionExpression;
        return this.ctx.factory.updateFunctionExpression(
          visited,
          visited.modifiers,
          visited.asteriskToken,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.body
        );
      }
    }
    if (ts.isArrowFunction(node) && node.type) {
      if (this.shouldStripOpaqueReturnType(node.type)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.ArrowFunction;
        return this.ctx.factory.updateArrowFunction(
          visited,
          visited.modifiers,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.equalsGreaterThanToken,
          visited.body
        );
      }
    }

    // fn.specialize(dict) must be checked before expression macros because
    // the expression macro dispatcher would otherwise match "specialize" as
    // a registered macro name from `sortWith.specialize(...)`.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "specialize"
    ) {
      const result = this.tryRewriteSpecializeExtension(node);
      if (result !== undefined) {
        return result;
      }
    }

    // Chain macro detection: fluent APIs like match(x).case(42).then("yes")
    // Must run before expression macros to intercept the outermost chain call
    // before visitEachChild would expand the root call in isolation.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chainResult = this.tryExpandChainMacro(node);
      if (chainResult !== undefined) {
        return chainResult;
      }
    }

    if (ts.isCallExpression(node)) {
      const result = this.tryExpandExpressionMacro(node);
      if (result !== undefined) {
        return result;
      }

      const implicitsResult = this.tryTransformImplicitsCall(node);
      if (implicitsResult !== undefined) {
        return implicitsResult;
      }

      const autoSpecResult = this.tryAutoSpecialize(node);
      if (autoSpecResult !== undefined) {
        return autoSpecResult;
      }

      const derivedInlineResult = this.tryInlineDerivedInstanceCall(node);
      if (derivedInlineResult !== undefined) {
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression)
        ) {
          this.inlinedInstanceNames.add(node.expression.expression.text);
        }
        return derivedInlineResult;
      }

      const returnTypeResult = this.tryReturnTypeDrivenSpecialize(node);
      if (returnTypeResult !== undefined) {
        return returnTypeResult;
      }
    }

    if (this.hasDecorators(node)) {
      const result = this.tryExpandAttributeMacros(node as ts.HasDecorators);
      if (result !== undefined) {
        return result;
      }
    }

    // JSDoc-triggered macros: @typeclass, @impl, @deriving
    // This allows preprocessor-free syntax for typeclass features
    if (this.hasJSDocMacroTags(node)) {
      const result = this.tryExpandJSDocMacros(node);
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const result = this.tryExpandTaggedTemplate(node);
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isTypeReferenceNode(node)) {
      const result = this.tryExpandTypeMacro(node);
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const result = this.tryRewriteExtensionMethod(node);
      if (result !== undefined) {
        return result;
      }
    }

    // PEP-012 Wave 4: Constructor erasure — `Some(x)` → `x`, `None` → `null`
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const result = this.tryEraseConstructorCall(node);
      if (result !== undefined) {
        return result;
      }
    }

    // PEP-012 Wave 4: Constant constructor identifier erasure — `None` → `null`
    // Handles bare identifier references to constant constructors (not call expressions).
    // Guard: node.parent may be undefined on synthetic nodes created during transformation.
    if (ts.isIdentifier(node) && (!node.parent || !ts.isCallExpression(node.parent))) {
      const result = this.tryEraseConstantConstructorRef(node);
      if (result !== undefined) {
        return result;
      }
    }

    // PEP-012 Wave 4: Accessor erasure — `x.value` → `x` (non-call property access)
    // Skip when the property access is the callee of a call expression (that's a method call,
    // handled by tryRewriteExtensionMethod above).
    // Guard: node.parent may be undefined on synthetic nodes.
    if (ts.isPropertyAccessExpression(node)) {
      const isCallCallee =
        node.parent != null && ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!isCallCallee) {
        const result = this.tryEraseAccessor(node);
        if (result !== undefined) {
          return result;
        }
      }
    }

    if (ts.isBinaryExpression(node)) {
      const result = this.tryRewriteTypeclassOperator(node);
      if (result !== undefined) {
        let finalExpr: ts.Expression;
        if (ts.isCallExpression(result)) {
          const inlined = this.tryInlineDerivedInstanceCall(result);
          if (inlined !== undefined) {
            if (
              ts.isPropertyAccessExpression(result.expression) &&
              ts.isIdentifier(result.expression.expression)
            ) {
              this.inlinedInstanceNames.add(result.expression.expression.text);
            }
            finalExpr = this.reparseExpression(inlined, node);
          } else {
            finalExpr = this.reparseExpression(result, node);
          }
        } else {
          finalExpr = this.reparseExpression(result, node);
        }
        // Record for preserveBlankLines surgical replacement
        if (this.expansionTracker) {
          const expandedText = this.printNodeSafe(finalExpr);
          if (expandedText) {
            this.expansionTracker.recordExpansion(
              "operator",
              node,
              this.ctx.sourceFile,
              expandedText
            );
          }
        }
        return finalExpr;
      }
    }

    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const result = this.tryTransformHKTDeclaration(node);
      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  private hasDecorators(node: ts.Node): node is ts.HasDecorators {
    if (ts.canHaveDecorators(node) && ts.getDecorators(node) !== undefined) {
      return true;
    }
    // TypeScript's parser creates decorator nodes on interfaces, type aliases,
    // and function declarations for error recovery, but ts.canHaveDecorators()
    // returns false for them. We need to detect these to support @derive() on
    // interfaces/type aliases and = implicit() parameter detection.
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      const modifiers = node.modifiers;
      if (modifiers) {
        return modifiers.some((m) => m.kind === ts.SyntaxKind.Decorator);
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // JSDoc macro tag handling
  // ---------------------------------------------------------------------------

  /**
   * Map of JSDoc tag names to macro names for lookup.
   * JSDoc tags use shortened names (impl vs instance) as the primary form.
   */
  private static readonly JSDOC_MACRO_TAGS: ReadonlyMap<string, string> = new Map([
    ["typeclass", "typeclass"],
    ["impl", "impl"],
    ["instance", "instance"],
    ["deriving", "deriving"],
    ["extension", "extension"],
    ["reflect", "reflect"],
    ["hkt", "hkt"],
    ["adt", "adt"],
  ]);

  /**
   * Node types that can have JSDoc macro tags.
   * These are all ts.Declaration subtypes.
   */
  private isJSDocMacroTargetNode(
    node: ts.Node
  ): node is
    | ts.InterfaceDeclaration
    | ts.ClassDeclaration
    | ts.TypeAliasDeclaration
    | ts.VariableStatement
    | ts.VariableDeclaration {
    return (
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isVariableStatement(node) ||
      ts.isVariableDeclaration(node)
    );
  }

  /**
   * Check if a node has JSDoc tags that should trigger macro expansion.
   *
   * Only fires on:
   * - InterfaceDeclaration (@typeclass, @deriving)
   * - TypeAliasDeclaration (@deriving)
   * - VariableStatement / VariableDeclaration (@impl)
   */
  private hasJSDocMacroTags(node: ts.Node): boolean {
    // Only check node types that can have our macro tags
    if (!this.isJSDocMacroTargetNode(node)) {
      return false;
    }

    const tags = ts.getJSDocTags(node);
    for (const tag of tags) {
      if (MacroTransformer.JSDOC_MACRO_TAGS.has(tag.tagName.text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Expand macros triggered by JSDoc tags.
   *
   * This synthesizes the equivalent of decorator-triggered expansion
   * but reads macro intent from JSDoc instead.
   */
  private tryExpandJSDocMacros(node: ts.Node): ts.Node | ts.Node[] | undefined {
    // Check for opt-out
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    // Narrow the node type - only declarations can have JSDoc macro tags
    if (!this.isJSDocMacroTargetNode(node)) {
      return undefined;
    }

    const tags = ts.getJSDocTags(node);
    const results: ts.Node[] = [];

    // For VariableStatement, we need to get the declaration inside
    let targetDecl: ts.Declaration;
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.length === 0) {
        return undefined;
      }
      targetDecl = node.declarationList.declarations[0];
    } else {
      targetDecl = node;
    }

    let currentNode: ts.Declaration = targetDecl;

    for (const tag of tags) {
      const macroName = MacroTransformer.JSDOC_MACRO_TAGS.get(tag.tagName.text);
      if (!macroName) continue;

      // Handle @derive/@deriving JSDoc directly through the transformer's derive handler
      // (the macro-system derive attribute was removed in PEP-032; the transformer owns derive processing)
      if (macroName === "deriving" || macroName === "derive") {
        const args = this.parseJSDocMacroArgs(tag, macroName);
        if (
          ts.isInterfaceDeclaration(currentNode) ||
          ts.isClassDeclaration(currentNode) ||
          ts.isTypeAliasDeclaration(currentNode)
        ) {
          const syntheticDecorator = this.createSyntheticDecorator(tag, macroName, args);
          const derives = this.expandDeriveDecorator(syntheticDecorator, currentNode, args);
          if (derives) {
            results.push(...derives);
          }
        }
        continue;
      }

      const macro = globalRegistry.getAttribute(macroName);
      if (!macro) {
        this.ctx.reportWarning(tag, `Unknown JSDoc macro tag @${tag.tagName.text}`);
        continue;
      }

      // Synthesize arguments from JSDoc comment
      const args = this.parseJSDocMacroArgs(tag, macroName);

      // Create a synthetic decorator for the macro's expand function
      const syntheticDecorator = this.createSyntheticDecorator(tag, macroName, args);

      try {
        if (this.verbose) {
          console.log(`[typesugar] Expanding JSDoc macro: @${tag.tagName.text}`);
        }

        const expanded = macro.expand(this.ctx, syntheticDecorator, currentNode, args);

        if (expanded === undefined) continue;

        if (Array.isArray(expanded)) {
          // Multiple nodes returned - first is the updated target, rest are additional
          if (expanded.length > 0) {
            currentNode = expanded[0] as ts.Declaration;
            results.push(...expanded.slice(1));
          }
        } else {
          currentNode = expanded as ts.Declaration;
        }
      } catch (err) {
        const macroTag = tag.tagName.text;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.ctx.reportError(
          tag,
          `@${macroTag} macro failed (this may be transient — try saving again)`
        );
        if (this.verbose) {
          console.error(
            `[typesugar] @${macroTag} expand threw: ${err instanceof Error ? err.stack : errMsg}`
          );
        }
      }
    }

    // Check if we expanded anything
    const wasExpanded = currentNode !== targetDecl || results.length > 0;
    if (!wasExpanded) {
      return undefined;
    }

    // For VariableStatement, we need to return the updated statement with results
    let returnNodes: ts.Node | ts.Node[];
    if (ts.isVariableStatement(node)) {
      // Create updated VariableStatement with the modified declaration
      const factory = this.ctx.factory;
      const updatedDecl = currentNode as ts.VariableDeclaration;
      const updatedDeclList = factory.updateVariableDeclarationList(node.declarationList, [
        updatedDecl,
        ...node.declarationList.declarations.slice(1),
      ]);
      const updatedStmt = factory.updateVariableStatement(node, node.modifiers, updatedDeclList);
      returnNodes = results.length > 0 ? [updatedStmt, ...results] : updatedStmt;
    } else {
      // For other declaration types, return directly
      returnNodes = results.length > 0 ? [currentNode, ...results] : currentNode;
    }

    return returnNodes;
  }

  /**
   * Parse JSDoc tag comment into macro arguments.
   *
   * Each macro tag has its own argument format:
   * - @typeclass: no args, or optional JSON config
   * - @impl Eq<Point>: string argument for typeclass instance
   * - @impl (bare): infer from type annotation
   * - @deriving Show, Eq, Ord: comma-separated list of typeclass names
   */
  private parseJSDocMacroArgs(tag: ts.JSDocTag, macroName: string): ts.Expression[] {
    const comment =
      typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);

    const trimmed = comment?.trim() ?? "";

    switch (macroName) {
      case "typeclass":
        // No args or optional JSON config
        if (!trimmed) return [];
        try {
          // Try to parse as JSON for config options
          JSON.parse(trimmed);
          return [this.ctx.factory.createStringLiteral(trimmed)];
        } catch {
          return [];
        }

      case "impl":
      case "instance":
        // @impl Eq<Point> or bare @impl
        if (!trimmed) return [];
        return [this.ctx.factory.createStringLiteral(trimmed)];

      case "deriving":
        // @deriving Show, Eq, Ord
        if (!trimmed) return [];
        const tcNames = trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return tcNames.map((name) => this.ctx.factory.createIdentifier(name));

      default:
        return [];
    }
  }

  /**
   * Create a synthetic decorator node for use with attribute macro expand().
   * The decorator's position info is borrowed from the JSDoc tag.
   */
  private createSyntheticDecorator(
    tag: ts.JSDocTag,
    macroName: string,
    args: ts.Expression[]
  ): ts.Decorator {
    const factory = this.ctx.factory;

    // Build the decorator expression: @macroName or @macroName(args...)
    let expression: ts.Expression;
    if (args.length === 0) {
      expression = factory.createIdentifier(macroName);
    } else {
      expression = factory.createCallExpression(
        factory.createIdentifier(macroName),
        undefined,
        args
      );
    }

    // Create the decorator node
    const decorator = factory.createDecorator(expression);

    // Copy position info from the tag for error reporting
    // Note: This is a best-effort - synthetic nodes may not have valid positions
    return ts.setTextRange(decorator, tag);
  }

  // ---------------------------------------------------------------------------
  // Chain macro expansion (fluent API support)
  // ---------------------------------------------------------------------------

  /**
   * Walk down a method-call chain to find its root CallExpression.
   * e.g. match(x).case(42).then("yes").else("no") → match(x)
   */
  private findChainRoot(node: ts.CallExpression): ts.CallExpression | undefined {
    let current: ts.Expression = node;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      current = current.expression.expression;
    }
    return ts.isCallExpression(current) ? current : undefined;
  }

  /**
   * Check if this call is the outermost in a method chain.
   * Returns false if the parent is `.method(...)` wrapping this node.
   */
  private isOutermostChainCall(node: ts.CallExpression): boolean {
    const parent = node.parent;
    if (!parent) return true;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.parent &&
      ts.isCallExpression(parent.parent)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Detect and expand chainable expression macros.
   * For a chain like match(x).case(42).then("yes"), this finds the root
   * macro (match), verifies it's chainable, and passes the outermost
   * CallExpression to expand().
   */
  private tryExpandChainMacro(node: ts.CallExpression): ts.Expression | undefined {
    const rootCall = this.findChainRoot(node);
    if (!rootCall) return undefined;

    if (!ts.isIdentifier(rootCall.expression)) return undefined;
    const macroName = rootCall.expression.text;

    const macro = this.resolveMacroFromSymbol(rootCall.expression, macroName, "expression") as
      | ExpressionMacro
      | undefined;
    if (!macro?.chainable) return undefined;

    if (!this.isOutermostChainCall(node)) return undefined;

    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    if (this.verbose) {
      console.log(`[typesugar] Expanding chain macro: ${macroName} (chain depth)`);
    }

    try {
      const result = this.ctx.hygiene.withScope(() =>
        macro.expand(this.ctx, node, Array.from(rootCall.arguments))
      );

      // Record expansion for source maps and preserveBlankLines surgical replacement
      if (this.expansionTracker) {
        const expandedText = this.printNodeSafe(result);
        if (expandedText) {
          this.expansionTracker.recordExpansion(macroName, node, this.ctx.sourceFile, expandedText);
        }
      }

      if (this.verbose) {
        console.log(`[typesugar] Chain macro ${macroName} expanded`);
      }

      if (result === (node as ts.Expression)) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Chain macro expansion failed: ${error}`);
      return this.createMacroErrorExpression(
        `typesugar: chain expansion of '${macroName}' failed: ${error}`
      );
    }
  }

  private tryExpandExpressionMacro(node: ts.CallExpression): ts.Expression | undefined {
    // Check for inline opt-out
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    let macroName: string | undefined;
    let identNode: ts.Node | undefined;

    if (ts.isIdentifier(node.expression)) {
      macroName = node.expression.text;
      identNode = node.expression;
    } else if (ts.isPropertyAccessExpression(node.expression)) {
      if (ts.isIdentifier(node.expression.expression)) {
        if (node.expression.expression.text === "macro") {
          macroName = node.expression.name.text;
          identNode = node.expression.name;
        } else {
          macroName = node.expression.name.text;
          identNode = node.expression;
        }
      }
    }

    if (!macroName || !identNode) return undefined;

    const macro = this.resolveMacroFromSymbol(identNode, macroName, "expression") as
      | ExpressionMacro
      | undefined;
    if (!macro) return undefined;

    if (this.verbose) {
      console.log(`[typesugar] Expanding expression macro: ${macroName}`);
    }

    // Check disk cache first (if macro is cacheable)
    const cacheKey = this.isMacroCacheable(macro)
      ? this.computeCallSiteCacheKey(macroName, node, Array.from(node.arguments))
      : undefined;

    if (cacheKey) {
      const cached = this.getCachedExpression(cacheKey);
      if (cached) {
        if (this.verbose) {
          console.log(`[typesugar] Cache hit for macro: ${macroName}`);
        }
        // Record expansion even for cache hits (for source map accuracy)
        if (this.expansionTracker) {
          const expandedText = this.printNodeSafe(cached);
          if (expandedText) {
            this.expansionTracker.recordExpansion(
              macroName,
              node,
              this.ctx.sourceFile,
              expandedText,
              true // fromCache
            );
          }
        }
        const visited = ts.visitNode(cached, this.visit.bind(this)) as ts.Expression;
        return preserveSourceMap(visited, node);
      }
    }

    try {
      // Wrap expansion in a hygiene scope so generated names are isolated
      const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, node.arguments));

      // Store in disk cache
      if (cacheKey) {
        this.cacheExpression(cacheKey, result);
      }

      // Record expansion for source maps and diagnostics
      if (this.expansionTracker) {
        const expandedText = this.printNodeSafe(result);
        if (expandedText) {
          this.expansionTracker.recordExpansion(macroName, node, this.ctx.sourceFile, expandedText);
        }
      }

      if (result === node) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Macro expansion failed: ${error}`);
      return this.createMacroErrorExpression(
        `typesugar: expansion of '${macroName}' failed: ${error}`
      );
    }
  }

  private tryExpandAttributeMacros(node: ts.HasDecorators): ts.Node | ts.Node[] | undefined {
    // ts.getDecorators() returns undefined for function declarations, interfaces,
    // and type aliases even though decorators may be present in modifiers.
    // Extract decorators from modifiers for these node types.
    let decorators = ts.getDecorators(node);
    if (!decorators || decorators.length === 0) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)
      ) {
        const nodeWithModifiers = node as
          | ts.FunctionDeclaration
          | ts.InterfaceDeclaration
          | ts.TypeAliasDeclaration;
        if (nodeWithModifiers.modifiers) {
          const modifierDecorators = nodeWithModifiers.modifiers.filter(
            (m): m is ts.Decorator => m.kind === ts.SyntaxKind.Decorator
          );
          if (modifierDecorators.length > 0) {
            decorators = modifierDecorators as unknown as readonly ts.Decorator[];
          }
        }
      }
    }
    if (!decorators || decorators.length === 0) return undefined;

    // Check for inline opt-out (using the first decorator as the anchor)
    if (isInOptedOutScope(this.ctx.sourceFile, decorators[0], globalResolutionScope, "macros")) {
      return undefined;
    }

    const sortedDecorators = this.sortDecoratorsByDependency(decorators);

    let currentNode: ts.Node = node;
    const extraStatements: ts.Statement[] = [];
    const remainingDecorators: ts.Decorator[] = [];
    let wasTransformed = false;

    for (const decorator of sortedDecorators) {
      const { macroName, args, identNode } = this.parseDecorator(decorator);

      // Check for derive-specific opt-out
      if (
        macroName === "derive" &&
        isInOptedOutScope(this.ctx.sourceFile, decorator, globalResolutionScope, "derive")
      ) {
        remainingDecorators.push(decorator);
        continue;
      }

      if (macroName === "derive") {
        // @derive(Eq, Clone, ...) is always handled specially - no need to check
        // for a "derive" attribute macro since individual derives are registered
        const derives = this.expandDeriveDecorator(decorator, node, args);
        if (derives) {
          extraStatements.push(...derives);
          wasTransformed = true;
          continue;
        }
      }

      const macro = (
        identNode
          ? this.resolveMacroFromSymbol(identNode, macroName, "attribute")
          : globalRegistry.getAttribute(macroName)
      ) as AttributeMacro | undefined;
      if (macro) {
        if (this.verbose) {
          console.log(`[typesugar] Expanding attribute macro: ${macroName}`);
        }

        try {
          // Wrap expansion in a hygiene scope so generated names are isolated
          const result = this.ctx.hygiene.withScope(() =>
            macro.expand(this.ctx, decorator, currentNode as ts.Declaration, args)
          );

          if (Array.isArray(result)) {
            if (result.length > 0) {
              currentNode = result[0];
              extraStatements.push(...result.slice(1).filter(ts.isStatement));
            }
          } else {
            currentNode = result;
          }
          wasTransformed = true;
        } catch (error) {
          this.ctx.reportError(decorator, `Attribute macro expansion failed: ${error}`);
          extraStatements.push(
            this.createMacroErrorStatement(
              `typesugar: attribute macro '${macroName}' failed: ${error}`
            )
          );
          remainingDecorators.push(decorator);
          wasTransformed = true;
        }
      } else {
        remainingDecorators.push(decorator);
      }
    }

    if (!wasTransformed) return undefined;

    if (remainingDecorators.length !== decorators.length) {
      currentNode = this.updateDecorators(currentNode, remainingDecorators);
    }

    let visited: ts.Node;
    try {
      visited = ts.visitNode(currentNode, this.visit.bind(this)) as ts.Node;
    } catch (error) {
      this.ctx.reportError(node, `Visiting attribute macro result failed: ${error}`);
      visited = ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }
    const mappedNode = preserveSourceMap(visited, node);

    if (extraStatements.length > 0) {
      return [mappedNode, ...extraStatements];
    }

    return mappedNode;
  }

  private parseDecorator(decorator: ts.Decorator): {
    macroName: string;
    args: ts.Expression[];
    identNode: ts.Node | undefined;
  } {
    const expr = decorator.expression;

    if (ts.isIdentifier(expr)) {
      return { macroName: expr.text, args: [], identNode: expr };
    }

    if (ts.isCallExpression(expr)) {
      if (ts.isIdentifier(expr.expression)) {
        return {
          macroName: expr.expression.text,
          args: Array.from(expr.arguments),
          identNode: expr.expression,
        };
      }
    }

    return { macroName: "", args: [], identNode: undefined };
  }

  /**
   * Topologically sort decorators based on their macros' `expandAfter` declarations.
   * Decorators whose macros declare `expandAfter: ["X"]` are moved after the
   * decorator for macro "X". Uses Kahn's algorithm. Falls back to original
   * order on cycles or when no dependencies exist.
   */
  private sortDecoratorsByDependency(decorators: readonly ts.Decorator[]): ts.Decorator[] {
    const parsed = decorators.map((d) => ({
      decorator: d,
      ...this.parseDecorator(d),
    }));

    const nameToIndex = new Map<string, number>();
    for (let i = 0; i < parsed.length; i++) {
      const name = parsed[i].macroName;
      if (name) nameToIndex.set(name, i);
    }

    let hasDeps = false;
    for (const p of parsed) {
      if (!p.macroName) continue;
      const macro =
        globalRegistry.getAttribute(p.macroName) ?? globalRegistry.getDerive(p.macroName);
      if (macro?.expandAfter && macro.expandAfter.length > 0) {
        hasDeps = true;
        break;
      }
    }
    if (!hasDeps) return [...decorators];

    const n = parsed.length;
    const inDegree = new Array<number>(n).fill(0);
    const adj: number[][] = [];
    for (let i = 0; i < n; i++) adj.push([]);

    for (let i = 0; i < n; i++) {
      const name = parsed[i].macroName;
      if (!name) continue;
      const macro = globalRegistry.getAttribute(name) ?? globalRegistry.getDerive(name);
      if (!macro?.expandAfter) continue;
      for (const dep of macro.expandAfter) {
        const depIdx = nameToIndex.get(dep);
        if (depIdx !== undefined) {
          adj[depIdx].push(i);
          inDegree[i]++;
        }
      }
    }

    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    const sorted: ts.Decorator[] = [];
    while (queue.length > 0) {
      queue.sort((a, b) => a - b);
      const idx = queue.shift()!;
      sorted.push(parsed[idx].decorator);
      for (const next of adj[idx]) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      }
    }

    if (sorted.length < n) {
      return [...decorators];
    }

    return sorted;
  }

  /**
   * Known dependency relationships between builtin typeclasses.
   * If Ord depends on Eq, then Eq must be derived before Ord.
   */
  private static readonly BUILTIN_DERIVE_DEPS: Record<string, string[]> = {
    Ord: ["Eq"],
    Monoid: ["Semigroup"],
  };

  /**
   * Sort derive arguments by dependency order using Kahn's algorithm.
   * Respects both registered derive macro `expandAfter` declarations
   * and builtin typeclass dependency relationships.
   */
  private sortDeriveArgsByDependency(args: ts.Expression[]): ts.Expression[] {
    const identArgs = args.filter(ts.isIdentifier);
    if (identArgs.length < 2) return [...args];

    const nameToIndex = new Map<string, number>();
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (ts.isIdentifier(a)) nameToIndex.set(a.text, i);
    }

    let hasDeps = false;
    const n = args.length;
    const inDegree = new Array<number>(n).fill(0);
    const adj: number[][] = [];
    for (let i = 0; i < n; i++) adj.push([]);

    for (let i = 0; i < n; i++) {
      const a = args[i];
      if (!ts.isIdentifier(a)) continue;
      const name = a.text;

      const deps: string[] = [];

      // Check registered derive macro expandAfter
      const deriveMacro = globalRegistry.getDerive(name);
      if (deriveMacro?.expandAfter) {
        deps.push(...deriveMacro.expandAfter);
      }

      // Check {Name}TC convention macro
      const tcMacro = globalRegistry.getDerive(`${name}TC`);
      if (tcMacro?.expandAfter) {
        deps.push(...tcMacro.expandAfter);
      }

      // Check builtin typeclass dependencies
      const builtinDeps = MacroTransformer.BUILTIN_DERIVE_DEPS[name];
      if (builtinDeps) {
        deps.push(...builtinDeps);
      }

      for (const dep of deps) {
        const depIdx = nameToIndex.get(dep);
        if (depIdx !== undefined) {
          adj[depIdx].push(i);
          inDegree[i]++;
          hasDeps = true;
        }
      }
    }

    if (!hasDeps) return [...args];

    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    const sorted: ts.Expression[] = [];
    while (queue.length > 0) {
      queue.sort((a, b) => a - b);
      const idx = queue.shift()!;
      sorted.push(args[idx]);
      for (const next of adj[idx]) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      }
    }

    if (sorted.length < n) {
      return [...args];
    }

    return sorted;
  }

  private expandDeriveDecorator(
    decorator: ts.Decorator,
    node: ts.Node,
    args: ts.Expression[]
  ): ts.Statement[] | undefined {
    if (
      !ts.isInterfaceDeclaration(node) &&
      !ts.isClassDeclaration(node) &&
      !ts.isTypeAliasDeclaration(node)
    ) {
      this.ctx.reportError(
        decorator,
        "@derive can only be applied to interfaces, classes, or type aliases"
      );
      return undefined;
    }

    const sortedArgs = this.sortDeriveArgsByDependency(args);
    const statements: ts.Statement[] = [];
    const typeInfo = this.extractTypeInfo(node);
    const typeName = node.name?.text ?? "Anonymous";

    for (const arg of sortedArgs) {
      if (!ts.isIdentifier(arg)) {
        this.ctx.reportError(arg, "derive arguments must be identifiers");
        continue;
      }

      const deriveName = arg.text;

      // 1. Check for a registered derive macro (code-gen derives)
      const deriveMacro = globalRegistry.getDerive(deriveName);
      if (deriveMacro) {
        if (this.verbose) {
          console.log(`[typesugar] Expanding derive macro: ${deriveName}`);
        }

        try {
          // Wrap expansion in a hygiene scope so generated names are isolated
          const result = this.ctx.hygiene.withScope(() =>
            deriveMacro.expand(this.ctx, node, typeInfo)
          );
          statements.push(...result);
        } catch (error) {
          this.ctx.reportError(arg, `Derive macro expansion failed: ${error}`);
        }
        continue;
      }

      // 2. Check for a built-in typeclass derivation strategy (auto-derivation)
      const typeclassDerivation = builtinDerivations[deriveName];
      if (typeclassDerivation) {
        if (this.verbose) {
          console.log(
            `[typesugar] Auto-deriving typeclass instance: ${deriveName} for ${typeName}`
          );
        }

        // Check for empty types (no fields to derive from)
        if (typeInfo.fields.length === 0 && !ts.isTypeAliasDeclaration(node)) {
          this.ctx
            .diagnostic(TS9104)
            .at(arg)
            .withArgs({ typeclass: deriveName, type: typeName })
            .emit();
          continue;
        }

        // Check for non-derivable field types (functions)
        if (["Eq", "Ord", "Hash", "Clone"].includes(deriveName)) {
          for (const field of typeInfo.fields) {
            if (field.typeString.includes("=>") || field.typeString.startsWith("(")) {
              this.ctx
                .diagnostic(TS9101)
                .at(arg)
                .withArgs({
                  typeclass: deriveName,
                  type: typeName,
                  field: field.name,
                  fieldType: field.typeString,
                })
                .emit();
            }
          }
        }

        // Check for union without discriminant
        if (ts.isTypeAliasDeclaration(node)) {
          const sumCheck = tryExtractSumType(this.ctx, node);
          if (!sumCheck && ts.isUnionTypeNode(node.type)) {
            this.ctx
              .diagnostic(TS9103)
              .at(arg)
              .withArgs({ typeclass: deriveName, type: typeName })
              .emit();
            continue;
          }
        }

        try {
          let code: string;

          if (ts.isTypeAliasDeclaration(node)) {
            const sumInfo = tryExtractSumType(this.ctx, node);
            if (sumInfo) {
              code = typeclassDerivation.deriveSum(
                typeName,
                sumInfo.discriminant,
                sumInfo.variants
              );
            } else {
              code = typeclassDerivation.deriveProduct(typeName, typeInfo.fields);
            }
          } else {
            code = typeclassDerivation.deriveProduct(typeName, typeInfo.fields);
          }

          // Convert to companion property assignment (replaces flat const + runtime registration)
          code = convertToCompanionAssignment(code, deriveName, typeName);

          // Ensure companion const exists for interfaces/type aliases
          const isExported =
            node.modifiers?.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword) ??
            false;
          const companionCode = ensureDataTypeCompanionConst(node as any, typeName, isExported);
          if (companionCode) {
            // Only emit companion const if not already emitted for this type
            const alreadyHasCompanion = statements.some(
              (s) =>
                ts.isVariableStatement(s) &&
                s.declarationList.declarations.some(
                  (d) => ts.isIdentifier(d.name) && d.name.text === typeName
                )
            );
            if (!alreadyHasCompanion) {
              statements.push(...this.ctx.parseStatements(companionCode));
            }
          }

          const parsedStmts = this.ctx.parseStatements(code);
          statements.push(...parsedStmts);

          const uncap = deriveName.charAt(0).toLowerCase() + deriveName.slice(1);
          const varName = instanceVarName(uncap, typeName);
          instanceRegistry.push({
            typeclassName: deriveName,
            forType: typeName,
            instanceName: varName,
            companionPath: companionPath(deriveName, typeName),
            derived: true,
          });

          const specMethods = getSpecializationMethodsForDerivation(
            deriveName,
            typeName,
            typeInfo.fields
          );
          if (specMethods && Object.keys(specMethods).length > 0) {
            const methodsMap = new Map<string, { source?: string; params: string[] }>();
            for (const [name, impl] of Object.entries(specMethods)) {
              methodsMap.set(name, { source: impl.source, params: impl.params });
            }
            registerInstanceMethodsFromAST(
              companionPath(deriveName, typeName),
              typeName,
              methodsMap
            );
          }
        } catch (error) {
          this.ctx.reportError(arg, `Typeclass auto-derivation failed for ${deriveName}: ${error}`);
        }
        continue;
      }

      // 3. Check for a "{Name}TC" derive macro (typeclass derive convention)
      const tcDeriveMacro = globalRegistry.getDerive(`${deriveName}TC`);
      if (tcDeriveMacro) {
        if (this.verbose) {
          console.log(`[typesugar] Expanding typeclass derive macro: ${deriveName}TC`);
        }
        try {
          // Wrap expansion in a hygiene scope so generated names are isolated
          const result = this.ctx.hygiene.withScope(() =>
            tcDeriveMacro.expand(this.ctx, node, typeInfo)
          );
          statements.push(...result);
        } catch (error) {
          this.ctx.reportError(arg, `Typeclass derive macro expansion failed: ${error}`);
        }
        continue;
      }

      // 4. Nothing found — provide import suggestions
      const suggestions = getSuggestionsForSymbol(deriveName);
      const suggestionMsg = formatSuggestionsMessage(suggestions);
      const message = suggestionMsg
        ? `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
          `typeclass with auto-derivation, or typeclass derive macro ` +
          `('${deriveName}TC').\n\n${suggestionMsg}`
        : `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
          `typeclass with auto-derivation, or typeclass derive macro ` +
          `('${deriveName}TC').`;
      this.ctx.reportError(arg, message);
    }

    return statements.length > 0 ? statements : undefined;
  }

  private extractTypeInfo(
    node: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
  ): DeriveTypeInfo {
    const name = node.name?.text ?? "Anonymous";
    const typeParameters = node.typeParameters ? Array.from(node.typeParameters) : [];

    let type: ts.Type;
    try {
      type = this.ctx.typeChecker.getTypeAtLocation(node);
    } catch {
      return {
        name,
        fields: [],
        typeParameters,
        type: undefined as unknown as ts.Type,
        kind: "product",
      };
    }

    // Check for sum type (discriminated union)
    if (ts.isTypeAliasDeclaration(node)) {
      const sumInfo = tryExtractSumType(this.ctx, node);
      if (sumInfo) {
        return this.extractSumTypeInfo(node, name, typeParameters, type, sumInfo);
      }
    }

    // Check for primitive type alias
    if (ts.isTypeAliasDeclaration(node) && isPrimitiveType(type)) {
      return { name, fields: [], typeParameters, type, kind: "primitive" };
    }

    // Product type (interface, class, or non-union type alias)
    const fields: DeriveFieldInfo[] = [];
    let properties: ts.Symbol[];
    try {
      properties = this.ctx.typeChecker.getPropertiesOfType(type);
    } catch {
      return { name, fields: [], typeParameters, type, kind: "product" };
    }

    let isRecursive = false;
    for (const prop of properties) {
      const declarations = prop.getDeclarations();
      if (!declarations || declarations.length === 0) continue;

      const decl = declarations[0];

      // Skip method declarations and accessors — only derive for data fields
      if (
        ts.isMethodDeclaration(decl) ||
        ts.isMethodSignature(decl) ||
        ts.isGetAccessorDeclaration(decl) ||
        ts.isSetAccessorDeclaration(decl)
      ) {
        continue;
      }

      let propType: ts.Type;
      let propTypeString: string;
      try {
        propType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
        propTypeString = this.ctx.typeChecker.typeToString(propType);
      } catch {
        propType = type;
        propTypeString = "unknown";
      }

      if (propTypeString === name || propTypeString.includes(`${name}<`)) {
        isRecursive = true;
      }

      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const readonly =
        ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
          ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
          : false;

      fields.push({
        name: prop.name,
        typeString: propTypeString,
        type: propType,
        optional,
        readonly,
        symbol: prop,
      });
    }

    return { name, fields, typeParameters, type, kind: "product", isRecursive };
  }

  private extractSumTypeInfo(
    node: ts.TypeAliasDeclaration,
    name: string,
    typeParameters: ts.TypeParameterDeclaration[],
    type: ts.Type,
    sumInfo: { discriminant: string; variants: Array<{ tag: string; typeName: string }> }
  ): DeriveTypeInfo {
    const variants: DeriveVariantInfo[] = [];
    let isRecursive = false;

    if (ts.isUnionTypeNode(node.type)) {
      for (const member of node.type.types) {
        if (!ts.isTypeReferenceNode(member)) continue;

        const memberTypeName = ts.isIdentifier(member.typeName)
          ? member.typeName.text
          : safeGetNodeText(member.typeName, this.ctx.sourceFile);
        const variantInfo = sumInfo.variants.find((v) => v.typeName === memberTypeName);
        if (!variantInfo) continue;

        const memberType = this.ctx.typeChecker.getTypeFromTypeNode(member);
        const fields: DeriveFieldInfo[] = [];

        try {
          const props = this.ctx.typeChecker.getPropertiesOfType(memberType);
          for (const prop of props) {
            if (prop.name === sumInfo.discriminant) continue;

            const declarations = prop.getDeclarations();
            if (!declarations || declarations.length === 0) continue;

            const decl = declarations[0];
            let propType: ts.Type;
            let propTypeString: string;
            try {
              propType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
              propTypeString = this.ctx.typeChecker.typeToString(propType);
            } catch {
              propType = memberType;
              propTypeString = "unknown";
            }

            if (propTypeString === name || propTypeString.includes(`${name}<`)) {
              isRecursive = true;
            }

            const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
            const readonly =
              ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
                ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
                : false;

            fields.push({
              name: prop.name,
              typeString: propTypeString,
              type: propType,
              optional,
              readonly,
              symbol: prop,
            });
          }
        } catch {
          // Skip variant if we can't get its properties
        }

        variants.push({
          tag: variantInfo.tag,
          typeName: variantInfo.typeName,
          fields,
        });
      }
    }

    return {
      name,
      fields: [],
      typeParameters,
      type,
      kind: "sum",
      variants,
      discriminant: sumInfo.discriminant,
      isRecursive,
    };
  }

  private tryExpandTaggedTemplate(node: ts.TaggedTemplateExpression): ts.Expression | undefined {
    // Check for inline opt-out
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    if (!ts.isIdentifier(node.tag)) return undefined;

    const tagName = node.tag.text;

    const taggedMacro = this.resolveMacroFromSymbol(node.tag, tagName, "tagged-template") as
      | TaggedTemplateMacroDef
      | undefined;
    if (taggedMacro) {
      if (this.verbose) {
        console.log(`[typesugar] Expanding tagged template macro: ${tagName}`);
      }

      try {
        if (taggedMacro.validate && !taggedMacro.validate(this.ctx, node)) {
          this.ctx.reportError(node, `Tagged template validation failed for '${tagName}'`);
          return this.createMacroErrorExpression(
            `typesugar: tagged template '${tagName}' validation failed`
          );
        }

        // Wrap expansion in a hygiene scope so generated names are isolated
        const result = this.ctx.hygiene.withScope(() => taggedMacro.expand(this.ctx, node));
        if (result === (node as ts.Node)) {
          return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
        }
        const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
        return preserveSourceMap(visited, node);
      } catch (error) {
        this.ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
        return this.createMacroErrorExpression(
          `typesugar: tagged template '${tagName}' expansion failed: ${error}`
        );
      }
    }

    const exprMacro = this.resolveMacroFromSymbol(node.tag, tagName, "expression") as
      | ExpressionMacro
      | undefined;
    if (!exprMacro) return undefined;

    if (this.verbose) {
      console.log(`[typesugar] Expanding tagged template via expression macro: ${tagName}`);
    }

    try {
      // Wrap expansion in a hygiene scope so generated names are isolated
      const result = this.ctx.hygiene.withScope(() =>
        exprMacro.expand(this.ctx, node as unknown as ts.CallExpression, [
          node.template as unknown as ts.Expression,
        ])
      );
      if (result === (node as unknown as ts.Expression)) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
      return this.createMacroErrorExpression(
        `typesugar: tagged template '${tagName}' expansion failed: ${error}`
      );
    }
  }

  private tryExpandTypeMacro(node: ts.TypeReferenceNode): ts.TypeNode | undefined {
    // Check for inline opt-out
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    let macroName: string | undefined;
    let identNode: ts.Node | undefined;

    if (ts.isIdentifier(node.typeName)) {
      macroName = node.typeName.text;
      identNode = node.typeName;
    } else if (ts.isQualifiedName(node.typeName)) {
      if (
        ts.isIdentifier(node.typeName.left) &&
        (node.typeName.left.text === "typesugar" || node.typeName.left.text === "typemacro")
      ) {
        macroName = node.typeName.right.text;
        identNode = node.typeName;
      }
    }

    if (!macroName || !identNode) return undefined;

    const macro = this.resolveMacroFromSymbol(identNode, macroName, "type") as
      | TypeMacro
      | undefined;
    if (!macro) return undefined;

    if (this.verbose) {
      console.log(`[typesugar] Expanding type macro: ${macroName}`);
    }

    try {
      const typeArgs = node.typeArguments ? Array.from(node.typeArguments) : [];
      // Wrap expansion in a hygiene scope so generated names are isolated
      const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, typeArgs));
      if (result === (node as ts.Node)) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.TypeNode;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Type macro expansion failed: ${error}`);
      return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }
  }

  /**
   * Try to rewrite `fn.specialize(dict)` — the extension method syntax for
   * explicit specialization. Creates an inlined, specialized function by
   * removing dictionary parameters and substituting method bodies.
   */
  private tryRewriteSpecializeExtension(node: ts.CallExpression): ts.Expression | undefined {
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    const propAccess = node.expression as ts.PropertyAccessExpression;
    const fnExpr = propAccess.expression;

    // Receiver must be callable (has call signatures)
    const fnType = this.ctx.typeChecker.getTypeAtLocation(fnExpr);
    const callSignatures = fnType.getCallSignatures();
    if (callSignatures.length === 0) {
      return undefined;
    }

    // Must have at least one argument (the dictionary)
    if (node.arguments.length === 0) {
      this.ctx.reportError(
        node,
        "fn.specialize() requires at least one typeclass instance argument"
      );
      return node;
    }

    const dictArgs = Array.from(node.arguments);

    if (this.verbose) {
      const fnName = ts.isIdentifier(fnExpr) ? fnExpr.text : "<expr>";
      const dictNames = dictArgs.map((d) => (ts.isIdentifier(d) ? d.text : "<expr>")).join(", ");
      console.log(`[typesugar] Rewriting ${fnName}.specialize(${dictNames})`);
    }

    const specialized = createSpecializedFunction(this.ctx, {
      fnExpr,
      dictExprs: dictArgs,
      callExpr: node,
      suppressWarnings: false,
    });

    try {
      const visited = ts.visitNode(specialized, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `specialize() extension method failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Try to rewrite an implicit extension method call.
   *
   * Resolution order:
   * 1. Type rewrite registry (PEP-012) — authoritative for @opaque types
   * 2. Standalone extension registry (pre-registered)
   * 3. Import-scoped extension scanning (Scala 3-style)
   */
  private tryRewriteExtensionMethod(node: ts.CallExpression): ts.Expression | undefined {
    // Check for inline opt-out of extensions
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "extensions")) {
      return undefined;
    }

    const propAccess = node.expression as ts.PropertyAccessExpression;
    const methodName = propAccess.name.text;
    const receiver = propAccess.expression;

    if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
      const calleeName = receiver.expression.text;
      const calleeMacro = this.resolveMacroFromSymbol(
        receiver.expression,
        calleeName,
        "expression"
      );
      if (calleeMacro) {
        return undefined;
      }
    }

    const receiverType = this.ctx.typeChecker.getTypeAtLocation(receiver);

    if (!this.ctx.isTypeReliable(receiverType)) {
      const couldBeExtension = getAllStandaloneExtensions().some(
        (e) => e.methodName === methodName
      );
      if (couldBeExtension) {
        this.ctx.reportWarning(
          node,
          `typesugar skipped extension method '${methodName}' rewrite because the receiver type could not be resolved. Fix upstream type errors first.`
        );
      }
      return undefined;
    }

    // -----------------------------------------------------------------------
    // PEP-012 Wave 3: Type rewrite registry resolution (checked FIRST)
    //
    // For @opaque types, the interface declares the method (for type checking),
    // but at runtime the method must be erased to a standalone function call.
    // The registry is authoritative — if the type is registered and the method
    // is in its methods map, we rewrite without import scanning.
    // -----------------------------------------------------------------------
    const typeRewriteResult = this.tryResolveFromTypeRewriteRegistry(
      node,
      receiver,
      methodName,
      receiverType
    );
    if (typeRewriteResult) {
      return typeRewriteResult;
    }

    const existingProp = receiverType.getProperty(methodName);

    // If the property exists natively, we usually skip rewriting.
    // However, if the user has augmented the interface (e.g. `interface Number { clamp: ... }`)
    // to satisfy the type checker, `existingProp` will be defined but point to a declaration
    // that has no implementation.
    //
    // We check if an explicit extension is available in scope (via import scanning).
    // If so, we prioritize the extension over the (likely empty) interface augmentation.
    //
    // Exception: if the extension is found on the same object as the receiver (e.g.,
    // `config.set(...)` where `config` is an imported object with a `set` method), we
    // should NOT rewrite, as that would incorrectly pass the receiver as the first argument.
    let forceRewrite = false;
    if (existingProp) {
      const potentialExt = this.resolveExtensionFromImports(node, methodName, receiverType);
      if (potentialExt) {
        // Check if the extension is on the same object as the receiver.
        // If receiver is `config` and potentialExt.qualifier is "config", skip rewriting.
        const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
        const isSameObject = receiverText && potentialExt.qualifier === receiverText;
        if (!isSameObject) {
          forceRewrite = true;
        }
      }
    }

    if (existingProp && !forceRewrite) {
      return undefined;
    }

    const typeName = this.ctx.typeChecker.typeToString(receiverType);

    // Normalize literal types to their base type for extension lookup:
    // Normalize literal types to their base type using TypeFlags (not string matching).
    // NumberLiteral (95), StringLiteral ("hello"), BooleanLiteral (true/false)
    // map to "number", "string", "boolean" for extension registry lookup.
    let normalizedType = typeName;
    if (receiverType.flags & ts.TypeFlags.NumberLiteral) normalizedType = "number";
    else if (receiverType.flags & ts.TypeFlags.StringLiteral) normalizedType = "string";
    else if (receiverType.flags & ts.TypeFlags.BooleanLiteral) normalizedType = "boolean";

    // Check standalone extensions — first the pre-registered registry (from registerExtensions),
    // then scan imports in the current file (Scala 3-style: extensions are scoped to what's imported).
    let standaloneExt = findStandaloneExtension(methodName, normalizedType);
    if (!standaloneExt && normalizedType !== typeName) {
      standaloneExt = findStandaloneExtension(methodName, typeName);
    }
    if (!standaloneExt) {
      const baseTypeName = stripTypeArguments(typeName);
      if (baseTypeName !== typeName) {
        standaloneExt = findStandaloneExtension(methodName, baseTypeName);
      }
    }

    // Import-scoped resolution: scan the current file's imports for a matching function
    // or namespace property. This is the primary extension resolution mechanism.
    if (!standaloneExt) {
      standaloneExt = this.resolveExtensionFromImports(node, methodName, receiverType);
      // Avoid rewriting if the extension is on the same object as the receiver
      if (standaloneExt) {
        const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
        if (receiverText && standaloneExt.qualifier === receiverText) {
          standaloneExt = undefined;
        }
      }
    }

    if (!standaloneExt) {
      return undefined;
    }

    if (this.verbose) {
      const qual = standaloneExt.qualifier
        ? `${standaloneExt.qualifier}.${standaloneExt.methodName}`
        : standaloneExt.methodName;
      console.log(
        `[typesugar] Rewriting standalone extension: ${typeName}.${methodName}() → ${qual}(...)`
      );
    }

    const rewritten = buildStandaloneExtensionCall(
      this.ctx.factory,
      standaloneExt,
      receiver,
      Array.from(node.arguments)
    );

    try {
      const visited = ts.visitNode(rewritten, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Extension method rewrite failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Resolve the type rewrite registry key for a TypeScript type.
   *
   * `typeToString` output is presentation-dependent — it can emit qualified names
   * like `import("./foo").MyType` when the type is imported from another module.
   * This helper tries multiple strategies to find the registered name:
   *
   * 1. Direct `typeToString` result (fast path, covers the common case)
   * 2. `type.symbol?.name` / `type.aliasSymbol?.name` (works for cross-module types)
   * 3. Strip `import(...)` prefix from the `typeToString` output
   */
  private resolveTypeRewriteName(type: ts.Type): string | undefined {
    const typeStr = this.ctx.typeChecker.typeToString(type);
    if (findTypeRewrite(typeStr)) return typeStr;

    const symbolName = type.symbol?.name ?? type.aliasSymbol?.name;
    if (symbolName && symbolName !== typeStr && findTypeRewrite(symbolName)) return symbolName;

    const importMatch = typeStr.match(/^import\([^)]+\)\.(.+)$/);
    if (importMatch && findTypeRewrite(importMatch[1])) return importMatch[1];

    return undefined;
  }

  /**
   * Resolve a method call via the type rewrite registry (PEP-012).
   *
   * If the receiver's type is registered as an @opaque type and the method
   * is in its methods map, rewrites `x.method(args)` → `fn(x, args)` and
   * schedules an import injection for `fn` from the registry entry's sourceModule.
   *
   * @returns The rewritten expression, or `undefined` if the registry doesn't apply
   */
  private tryResolveFromTypeRewriteRegistry(
    node: ts.CallExpression,
    receiver: ts.Expression,
    methodName: string,
    receiverType: ts.Type
  ): ts.Expression | undefined {
    const typeName = this.resolveTypeRewriteName(receiverType);
    if (!typeName) return undefined;
    const entry = findTypeRewrite(typeName)!;

    // Check transparent scope: skip rewriting inside the defining module
    if (entry.transparent && entry.sourceModule) {
      const currentFile = this.ctx.sourceFile.fileName;
      if (this.isWithinSourceModule(currentFile, entry.sourceModule)) {
        return undefined;
      }
    }

    const methods = entry.methods;
    if (!methods) return undefined;

    const standaloneFnName = methods.get(methodName);
    if (!standaloneFnName) return undefined;

    // Try inline pattern first (zero-cost: null-check instead of function call)
    const inlinePattern = entry.methodInlines?.get(methodName);
    if (inlinePattern) {
      const visitedReceiver = ts.visitNode(receiver, this.visit.bind(this)) as ts.Expression;
      const visitedArgs = node.arguments.map(
        (a) => ts.visitNode(a, this.visit.bind(this)) as ts.Expression
      );
      const result = buildOpaqueInlineExpressionStatic(
        this.ctx.factory,
        inlinePattern,
        visitedReceiver,
        visitedArgs,
        this.verbose,
        typeName,
        methodName
      );
      if (result) return preserveSourceMap(result, node);
    }

    // Schedule import injection if we have a sourceModule
    if (entry.sourceModule) {
      this.scheduleTypeRewriteImport(standaloneFnName, entry.sourceModule);
    }

    if (this.verbose) {
      console.log(
        `[typesugar] Type rewrite: ${typeName}.${methodName}() → ${standaloneFnName}(...)`
      );
    }

    const ext: StandaloneExtensionInfo = {
      methodName: standaloneFnName,
      forType: entry.typeName,
    };

    const rewritten = buildStandaloneExtensionCall(
      this.ctx.factory,
      ext,
      receiver,
      Array.from(node.arguments)
    );

    try {
      const visited = ts.visitNode(rewritten, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Type rewrite method erasure failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Erase a constructor call for an @opaque type (PEP-012 Wave 4).
   *
   * For identity constructors (e.g., `Some(x)`), replaces with the argument.
   * For constant constructors (e.g., `None`), replaces with the constant.
   * Constant constructors that are identifiers (not calls) are handled as
   * identifier references elsewhere; this method only handles call expressions.
   *
   * @returns The erased expression, or `undefined` if not a registered constructor
   */
  private tryEraseConstructorCall(node: ts.CallExpression): ts.Expression | undefined {
    if (!ts.isIdentifier(node.expression)) return undefined;

    const ctorName = node.expression.text;

    // Search all registered types for a matching constructor
    for (const entry of this.iterTypeRewriteEntries()) {
      if (!entry.constructors) continue;

      const ctor = entry.constructors.get(ctorName);
      if (!ctor) continue;

      // Transparent scope: skip erasure inside the defining module
      if (entry.transparent && entry.sourceModule) {
        const currentFile = this.ctx.sourceFile.fileName;
        if (this.isWithinSourceModule(currentFile, entry.sourceModule)) {
          return undefined;
        }
      }

      if (ctor.kind === "identity") {
        if (node.arguments.length !== 1) {
          this.ctx.reportWarning(
            node,
            `Identity constructor '${ctorName}' expects exactly 1 argument, got ${node.arguments.length}`
          );
          return undefined;
        }

        if (this.verbose) {
          console.log(`[typesugar] Constructor erasure: ${ctorName}(arg) → arg`);
        }

        const arg = node.arguments[0];
        const visited = ts.visitNode(arg, this.visit.bind(this)) as ts.Expression;
        return preserveSourceMap(visited, node);
      }

      if (ctor.kind === "constant") {
        if (this.verbose) {
          console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
        }

        const constant = this.buildConstantExpression(ctor.value ?? "undefined");
        return preserveSourceMap(constant, node);
      }

      if (ctor.kind === "custom" && ctor.value) {
        if (this.verbose) {
          console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
        }

        const custom = this.ctx.factory.createIdentifier(ctor.value);
        return preserveSourceMap(custom, node);
      }
    }

    return undefined;
  }

  /**
   * Erase a bare identifier reference to a constant constructor (PEP-012 Wave 4).
   *
   * Handles `None` → `null` where `None` is used as an identifier (not a call).
   * Only applies to constant constructors — identity constructors are calls
   * and handled by {@link tryEraseConstructorCall}.
   *
   * Guards against false positives by checking that the identifier resolves to
   * a symbol whose declaration is in the constructor's source module.
   */
  private tryEraseConstantConstructorRef(node: ts.Identifier): ts.Expression | undefined {
    const name = node.text;

    // Skip identifiers in declaration positions (e.g., `const None = ...`)
    if (
      node.parent &&
      ((ts.isVariableDeclaration(node.parent) && node.parent.name === node) ||
        (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) ||
        (ts.isParameter(node.parent) && node.parent.name === node) ||
        (ts.isPropertyDeclaration(node.parent) && node.parent.name === node) ||
        ts.isImportSpecifier(node.parent) ||
        ts.isExportSpecifier(node.parent))
    ) {
      return undefined;
    }

    // Skip identifiers that are property names in property access or member access
    if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
      return undefined;
    }

    for (const entry of this.iterTypeRewriteEntries()) {
      if (!entry.constructors) continue;

      const ctor = entry.constructors.get(name);
      if (!ctor || ctor.kind !== "constant") continue;

      // Transparent scope: skip erasure inside the defining module
      if (entry.transparent && entry.sourceModule) {
        const currentFile = this.ctx.sourceFile.fileName;
        if (this.isWithinSourceModule(currentFile, entry.sourceModule)) {
          return undefined;
        }
      }

      if (this.verbose) {
        console.log(`[typesugar] Constant constructor ref erasure: ${name} → ${ctor.value}`);
      }

      return preserveSourceMap(this.buildConstantExpression(ctor.value ?? "undefined"), node);
    }

    return undefined;
  }

  /**
   * Erase a property access on an @opaque type (PEP-012 Wave 4).
   *
   * For identity accessors (e.g., `x.value`), replaces with the receiver.
   * For custom accessors, replaces with the custom expression.
   *
   * @returns The erased expression, or `undefined` if not a registered accessor
   */
  private tryEraseAccessor(node: ts.PropertyAccessExpression): ts.Expression | undefined {
    const propName = node.name.text;
    const receiver = node.expression;

    let receiverType: ts.Type;
    try {
      receiverType = this.ctx.typeChecker.getTypeAtLocation(receiver);
    } catch {
      return undefined;
    }

    if (!this.ctx.isTypeReliable(receiverType)) return undefined;

    const typeName = this.resolveTypeRewriteName(receiverType);
    if (!typeName) return undefined;
    const entry = findTypeRewrite(typeName)!;
    if (!entry.accessors) return undefined;

    const accessor = entry.accessors.get(propName);
    if (!accessor) return undefined;

    // Transparent scope: skip erasure inside the defining module
    if (entry.transparent && entry.sourceModule) {
      const currentFile = this.ctx.sourceFile.fileName;
      if (this.isWithinSourceModule(currentFile, entry.sourceModule)) {
        return undefined;
      }
    }

    if (accessor.kind === "identity") {
      if (this.verbose) {
        console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} → receiver`);
      }

      const visited = ts.visitNode(receiver, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    }

    if (accessor.kind === "custom" && accessor.value) {
      if (this.verbose) {
        console.log(`[typesugar] Accessor erasure: ${typeName}.${propName} → ${accessor.value}`);
      }

      const custom = this.ctx.factory.createIdentifier(accessor.value);
      return preserveSourceMap(custom, node);
    }

    return undefined;
  }

  /**
   * Build a constant expression AST node from a string value.
   */
  private buildConstantExpression(value: string): ts.Expression {
    switch (value) {
      case "null":
        return this.ctx.factory.createNull();
      case "undefined":
        return this.ctx.factory.createIdentifier("undefined");
      case "true":
        return this.ctx.factory.createTrue();
      case "false":
        return this.ctx.factory.createFalse();
      default: {
        const num = Number(value);
        if (!isNaN(num)) {
          return this.ctx.factory.createNumericLiteral(num);
        }
        if (value.startsWith('"') || value.startsWith("'")) {
          return this.ctx.factory.createStringLiteral(value.slice(1, -1));
        }
        return this.ctx.factory.createIdentifier(value);
      }
    }
  }

  /**
   * Iterate over all type rewrite entries for constructor/accessor lookup.
   */
  private *iterTypeRewriteEntries(): Iterable<TypeRewriteEntry> {
    yield* getAllTypeRewrites();
  }

  // ---------------------------------------------------------------------------
  // PEP-019 Wave 1: @opaque type annotation erasure
  // ---------------------------------------------------------------------------

  /**
   * Extract an opaque type rewrite entry from a TypeNode (e.g., `Option<Money>`).
   */
  private getOpaqueEntryFromTypeNode(typeNode: ts.TypeNode): TypeRewriteEntry | undefined {
    if (!ts.isTypeReferenceNode(typeNode)) return undefined;

    const typeName = ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : ts.isQualifiedName(typeNode.typeName)
        ? typeNode.typeName.right.text
        : undefined;

    if (!typeName) return undefined;
    return findTypeRewrite(typeName);
  }

  /**
   * Check if an initializer expression would be erased by opaque constructor
   * erasure for the given type rewrite entry.
   */
  private wouldBeOpaqueErased(init: ts.Expression, entry: TypeRewriteEntry): boolean {
    if (!entry.constructors) return false;

    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
      return entry.constructors.has(init.expression.text);
    }

    if (ts.isIdentifier(init)) {
      const ctor = entry.constructors.get(init.text);
      return ctor !== undefined && ctor.kind === "constant";
    }

    return false;
  }

  /**
   * Strip opaque type annotation from a variable declaration when its
   * initializer would be erased by opaque constructor/constant erasure.
   *
   * `const x: Option<Money> = Some(m)` → `const x = m`
   * `const x: Option<Money> = None` → `const x = null`
   */
  private tryStripOpaqueVarDeclAnnotation(
    node: ts.VariableDeclaration
  ): ts.VariableDeclaration | undefined {
    if (!node.type || !node.initializer) return undefined;

    const opaqueEntry = this.getOpaqueEntryFromTypeNode(node.type);
    if (!opaqueEntry) return undefined;

    if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
      if (this.isWithinSourceModule(this.ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
        return undefined;
      }
    }

    if (!this.wouldBeOpaqueErased(node.initializer, opaqueEntry)) return undefined;

    if (this.verbose) {
      console.log(
        `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from variable declaration`
      );
    }

    const visit = this.visit.bind(this);
    const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
    const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

    return preserveSourceMap(
      this.ctx.factory.updateVariableDeclaration(
        node,
        visitedName,
        node.exclamationToken,
        undefined,
        visitedInit
      ),
      node
    );
  }

  /**
   * Strip opaque type annotation from a function parameter when its default
   * value would be erased by opaque constructor/constant erasure.
   *
   * `function f(x: Option<Money> = Some(m))` → `function f(x = m)`
   */
  private tryStripOpaqueParamAnnotation(
    node: ts.ParameterDeclaration
  ): ts.ParameterDeclaration | undefined {
    if (!node.type || !node.initializer) return undefined;

    const opaqueEntry = this.getOpaqueEntryFromTypeNode(node.type);
    if (!opaqueEntry) return undefined;

    if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
      if (this.isWithinSourceModule(this.ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
        return undefined;
      }
    }

    if (!this.wouldBeOpaqueErased(node.initializer, opaqueEntry)) return undefined;

    if (this.verbose) {
      console.log(
        `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from parameter`
      );
    }

    const visit = this.visit.bind(this);
    const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
    const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

    return preserveSourceMap(
      this.ctx.factory.updateParameterDeclaration(
        node,
        node.modifiers,
        node.dotDotDotToken,
        visitedName,
        node.questionToken,
        undefined,
        visitedInit
      ),
      node
    );
  }

  private shouldStripOpaqueReturnType(returnType: ts.TypeNode): boolean {
    const opaqueEntry = this.getOpaqueEntryFromTypeNode(returnType);
    if (!opaqueEntry) return false;

    if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
      if (this.isWithinSourceModule(this.ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check whether a file path is within a given source module (for transparent scope).
   *
   * Handles two forms of `sourceModule`:
   * - Absolute file path (from `@opaque` macro's `resolveSourceModule`): direct comparison
   * - Module specifier like `@typesugar/fp/data/option`: path-segment containment check
   */
  private isWithinSourceModule(filePath: string, sourceModule: string): boolean {
    const normFile = filePath.replace(/\\/g, "/");
    const normModule = sourceModule.replace(/\\/g, "/");

    // If sourceModule looks like an absolute path, compare directly
    if (normModule.startsWith("/") || /^[A-Za-z]:\//.test(normModule)) {
      return normFile === normModule;
    }

    // Module specifier form: strip leading @ and check that the file path
    // ends with the module's path segments (e.g., "typesugar/fp/data/option"
    // matches ".../typesugar/fp/data/option.ts")
    const modulePath = normModule.replace(/^@/, "");
    const fileNoExt = normFile.replace(/\.[^/.]+$/, "");
    return (
      fileNoExt.endsWith(modulePath) ||
      normFile.includes("/" + modulePath + "/") ||
      normFile.includes("/" + modulePath + ".")
    );
  }

  /**
   * Schedule an import for a standalone function used by type-rewrite method erasure.
   * Deduplicates by function name + module.
   */
  private scheduleTypeRewriteImport(fnName: string, sourceModule: string): void {
    // Check if this function is already imported in the current file
    if (this.isAlreadyImported(fnName)) return;

    const key = `${fnName}::${sourceModule}`;
    if (!this.pendingTypeRewriteImports.has(key)) {
      this.pendingTypeRewriteImports.set(key, { name: fnName, module: sourceModule });
    }
  }

  /**
   * Check whether a name is already imported in the current source file.
   */
  private isAlreadyImported(name: string): boolean {
    for (const stmt of this.ctx.sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      const clause = stmt.importClause;
      if (!clause) continue;

      // Check named imports
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          if (spec.name.text === name) return true;
        }
      }

      // Check namespace import — would shadow via qualifier
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        if (clause.namedBindings.name.text === name) return true;
      }

      // Check default import
      if (clause.name && clause.name.text === name) return true;
    }
    return false;
  }

  /**
   * Build import declarations for type-rewrite method erasure functions.
   * Groups by module for cleaner output.
   */
  private buildTypeRewriteImportDeclarations(): ts.ImportDeclaration[] {
    if (this.pendingTypeRewriteImports.size === 0) return [];

    const factory = this.ctx.factory;

    // Group by module
    const byModule = new Map<string, string[]>();
    for (const { name, module } of this.pendingTypeRewriteImports.values()) {
      const list = byModule.get(module);
      if (list) {
        if (!list.includes(name)) list.push(name);
      } else {
        byModule.set(module, [name]);
      }
    }

    const imports: ts.ImportDeclaration[] = [];
    for (const [module, names] of byModule) {
      const specifiers = names.map((n) =>
        factory.createImportSpecifier(false, undefined, factory.createIdentifier(n))
      );
      imports.push(
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(false, undefined, factory.createNamedImports(specifiers)),
          factory.createStringLiteral(module)
        )
      );
    }

    return imports;
  }

  /**
   * Transform HKT declarations with F<_> kind syntax.
   *
   * Auto-detects interface/type declarations that use F<_> to denote
   * type constructor parameters, and transforms F<A> usages to Kind<F, A>.
   *
   * If the preprocessor already rewrote the F<_> syntax at the text level,
   * isKindAnnotation() won't find the <_> pattern in the source text
   * and this method returns undefined — no double-rewrite.
   */
  private tryTransformHKTDeclaration(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  ): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
    const typeParams = node.typeParameters;
    if (!typeParams) return undefined;

    let hasKindAnnotation = false;
    for (const param of typeParams) {
      if (isKindAnnotation(param)) {
        hasKindAnnotation = true;
        break;
      }
    }

    if (!hasKindAnnotation) return undefined;

    if (this.verbose) {
      const name = node.name?.text ?? "Anonymous";
      console.log(`[typesugar] Transforming HKT declaration: ${name}`);
    }

    try {
      const transformed = transformHKTDeclaration(this.ctx, node);
      const visited = ts.visitEachChild(
        transformed,
        this.visit.bind(this),
        this.ctx.transformContext
      ) as ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `HKT transformation failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Rewrite a binary expression using typeclass operator overloading.
   *
   * When a typeclass method has `@op +`, any usage of `+` on types with an
   * instance of that typeclass gets rewritten to a direct method call
   * (or inlined for zero-cost).
   */
  /**
   * Infer the result type of an identifier by looking at its initializer.
   * If the variable was assigned from a binary expression that would be rewritten,
   * returns the instance's forType instead of the TypeChecker's inferred type.
   */
  private inferIdentifierResultType(node: ts.Identifier): string | undefined {
    const symbol = this.ctx.typeChecker.getSymbolAtLocation(node);
    if (!symbol) return undefined;

    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) return undefined;

    for (const decl of decls) {
      if (ts.isVariableDeclaration(decl) && decl.initializer) {
        // Unwrap parentheses
        let init: ts.Expression = decl.initializer;
        while (ts.isParenthesizedExpression(init)) {
          init = init.expression;
        }

        if (ts.isBinaryExpression(init)) {
          const inferred = this.inferBinaryExprResultType(init);
          if (inferred) return inferred;
        }
      }
    }

    return undefined;
  }

  /**
   * Get (or compute and cache) the set of base member names for a type alias.
   * Returns null if the type alias is not found or is not a union.
   */
  private getUnionMembers(candidateBase: string): Set<string> | null {
    if (this.unionMemberCache.has(candidateBase)) {
      return this.unionMemberCache.get(candidateBase)!;
    }

    let result: Set<string> | null = null;
    for (const sf of this.ctx.program.getSourceFiles()) {
      for (const stmt of sf.statements) {
        if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === candidateBase) {
          const aliasType = this.ctx.typeChecker.getTypeAtLocation(stmt.type);
          if (aliasType.isUnion?.()) {
            result = new Set<string>();
            for (const unionMember of aliasType.types) {
              const memberName = this.ctx.typeChecker.typeToString(unionMember);
              result.add(stripTypeArguments(memberName));
            }
          }
          break;
        }
      }
      if (result !== null) break;
    }

    this.unionMemberCache.set(candidateBase, result);
    return result;
  }

  /**
   * Infer the result type of a binary expression, accounting for potential typeclass rewriting.
   * If the expression would be rewritten to a typeclass method call, returns the instance's forType.
   */
  private inferBinaryExprResultType(node: ts.BinaryExpression): string | undefined {
    const opString = getOperatorString(node.operatorToken.kind);
    if (!opString) return undefined;

    const entries = getSyntaxForOperator(opString);
    if (!entries || entries.length === 0) return undefined;

    // Unwrap parenthesized expressions
    let unwrappedLeft: ts.Expression = node.left;
    while (ts.isParenthesizedExpression(unwrappedLeft)) {
      unwrappedLeft = unwrappedLeft.expression;
    }

    // Get the type of the left operand, recursively inferring if it's also a binary expression
    let leftTypeName: string;
    if (ts.isBinaryExpression(unwrappedLeft)) {
      const inferred = this.inferBinaryExprResultType(unwrappedLeft);
      leftTypeName =
        inferred ??
        this.ctx.typeChecker.typeToString(this.ctx.typeChecker.getTypeAtLocation(unwrappedLeft));
    } else {
      leftTypeName = this.ctx.typeChecker.typeToString(
        this.ctx.typeChecker.getTypeAtLocation(node.left)
      );
    }

    const baseTypeName = stripTypeArguments(leftTypeName);
    const typeArg = extractTypeArgumentsContent(leftTypeName) ?? "";

    const currentFileName = this.ctx.sourceFile.fileName;
    // Check if there's an instance for this type and operator
    for (const entry of entries) {
      let inst =
        findInstance(entry.typeclass, leftTypeName, currentFileName) ??
        findInstance(entry.typeclass, baseTypeName, currentFileName);

      // Check union membership if no direct match
      if (!inst) {
        const candidateInstances = instanceRegistry.filter(
          (i) => i.typeclassName === entry.typeclass
        );
        for (const candidate of candidateInstances) {
          const candidateBase = stripTypeArguments(candidate.forType);
          const candidateArg = extractTypeArgumentsContent(candidate.forType) ?? "";
          const members = this.getUnionMembers(candidateBase);
          if (
            members?.has(baseTypeName) &&
            (candidateArg === typeArg || candidateArg === typeArg.split("<")[0] || !candidateArg)
          ) {
            inst = candidate;
            break;
          }
        }
      }

      if (inst) {
        // Found an instance - the result type is the instance's forType
        return inst.forType;
      }
    }

    return undefined;
  }

  private tryRewriteTypeclassOperator(node: ts.BinaryExpression): ts.Expression | undefined {
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "extensions")) {
      return undefined;
    }

    const opString = getOperatorString(node.operatorToken.kind);
    if (!opString) return undefined;

    const entries = getSyntaxForOperator(opString);
    if (!entries || entries.length === 0) return undefined;

    // Get the type of the left operand, inferring from nested binary expressions if needed
    // Unwrap parenthesized expressions to find the underlying expression
    let unwrappedLeft: ts.Expression = node.left;
    while (ts.isParenthesizedExpression(unwrappedLeft)) {
      unwrappedLeft = unwrappedLeft.expression;
    }

    let typeName: string;
    if (ts.isBinaryExpression(unwrappedLeft)) {
      const inferred = this.inferBinaryExprResultType(unwrappedLeft);
      typeName =
        inferred ??
        this.ctx.typeChecker.typeToString(this.ctx.typeChecker.getTypeAtLocation(unwrappedLeft));
    } else if (ts.isIdentifier(unwrappedLeft)) {
      // For variable references, check if the initializer is a binary expression we'd rewrite
      const inferred = this.inferIdentifierResultType(unwrappedLeft);
      typeName =
        inferred ??
        this.ctx.typeChecker.typeToString(this.ctx.typeChecker.getTypeAtLocation(node.left));
    } else {
      const leftType = this.ctx.typeChecker.getTypeAtLocation(node.left);
      typeName = this.ctx.typeChecker.typeToString(leftType);
    }
    const baseTypeName = stripTypeArguments(typeName);
    const typeArg = extractTypeArgumentsContent(typeName) ?? "";

    // Skip primitive types - native JS operators work correctly and we don't want to
    // generate unnecessary method calls or require imports
    const PRIMITIVE_TYPES = new Set([
      "number",
      "string",
      "boolean",
      "bigint",
      "null",
      "undefined",
      "any",
      "unknown",
    ]);
    if (PRIMITIVE_TYPES.has(baseTypeName)) {
      return undefined;
    }

    let matchedEntry: { typeclass: string; method: string } | undefined;
    let matchedInstance:
      | {
          typeclassName: string;
          forType: string;
          instanceName: string;
          companionPath?: string;
          sourceModule?: string;
        }
      | undefined;

    const sfn = this.ctx.sourceFile.fileName;
    for (const entry of entries) {
      // First try exact match
      let inst =
        findInstance(entry.typeclass, typeName, sfn) ??
        findInstance(entry.typeclass, baseTypeName, sfn);

      // If no exact match, try to find an instance via union membership
      // e.g., Variable<number> → Expression<number> (if Expression is a union containing Variable)
      if (!inst) {
        const candidateInstances = instanceRegistry.filter(
          (i) => i.typeclassName === entry.typeclass
        );
        for (const candidate of candidateInstances) {
          const candidateBase = stripTypeArguments(candidate.forType);
          const candidateArg = extractTypeArgumentsContent(candidate.forType) ?? "";
          const members = this.getUnionMembers(candidateBase);
          if (
            members?.has(baseTypeName) &&
            (candidateArg === typeArg || candidateArg === typeArg.split("<")[0] || !candidateArg)
          ) {
            inst = candidate;
            break;
          }
        }
      }

      if (inst) {
        if (matchedEntry) {
          this.ctx.reportError(
            node,
            `Ambiguous operator '${opString}' for type '${typeName}': ` +
              `both ${matchedEntry.typeclass}.${matchedEntry.method} and ` +
              `${entry.typeclass}.${entry.method} apply. ` +
              `Use explicit method calls to disambiguate.`
          );
          return undefined;
        }
        matchedEntry = entry;
        matchedInstance = inst;
      }
    }

    if (!matchedEntry || !matchedInstance) {
      return undefined;
    }

    // Guard: don't rewrite comparisons with null or undefined.
    // `x === undefined` and `x === null` must stay as native checks —
    // rewriting to Eq.equals(x, undefined) crashes at runtime.
    if (isNullOrUndefinedExpression(node.right) || isNullOrUndefinedExpression(node.left)) {
      return undefined;
    }

    // Also guard when either operand's *type* is null | undefined (e.g., `x == null`).
    // getTypeAtLocation always returns a type; flags check is safe.
    const rightType = this.ctx.typeChecker.getTypeAtLocation(node.right);
    const leftType = this.ctx.typeChecker.getTypeAtLocation(node.left);
    if (
      (rightType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0 ||
      (leftType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0
    ) {
      return undefined;
    }

    if (this.verbose) {
      console.log(
        `[typesugar] Rewriting operator: ${typeName} ${opString} → ` +
          `${matchedEntry.typeclass}.${matchedEntry.method}()`
      );
    }

    const factory = this.ctx.factory;
    const left = ts.visitNode(node.left, this.visit.bind(this)) as ts.Expression;
    const right = ts.visitNode(node.right, this.visit.bind(this)) as ts.Expression;

    // Try zero-cost inlining if instance methods are available
    const dictMethodMap = getInstanceMethods(
      matchedInstance.companionPath || matchedInstance.instanceName
    );
    if (dictMethodMap) {
      const dictMethod = dictMethodMap.methods.get(matchedEntry.method);
      if (dictMethod && dictMethod.source) {
        // TODO: Full inlining will be added in Step 6 (auto-specialization).
        // For now, fall through to the method call below.
      }
    }

    // If the instance comes from another module, schedule an import injection
    // With companion paths, we import the base type (e.g., "Point" from "Point.Eq")
    const importName = matchedInstance.companionPath
      ? matchedInstance.companionPath.split(".")[0]
      : matchedInstance.instanceName;
    if (matchedInstance.sourceModule && !this.isAlreadyImported(importName)) {
      const key = `${importName}::${matchedInstance.sourceModule}`;
      if (!this.pendingTypeRewriteImports.has(key)) {
        this.pendingTypeRewriteImports.set(key, {
          name: importName,
          module: matchedInstance.sourceModule,
        });
      }
    }

    // Emit instanceRef.method(left, right)
    // Use companion path if available (e.g., Point.Eq.equals via namespace merging)
    const instName = matchedInstance.companionPath || matchedInstance.instanceName;
    const instanceRef = instName.includes(".")
      ? factory.createPropertyAccessExpression(
          factory.createIdentifier(instName.split(".")[0]),
          instName.split(".")[1]
        )
      : factory.createIdentifier(instName);
    const methodAccess = factory.createPropertyAccessExpression(instanceRef, matchedEntry.method);
    const rewritten = factory.createCallExpression(methodAccess, undefined, [
      stripCommentsDeep(left),
      stripCommentsDeep(right),
    ]);
    return preserveSourceMap(rewritten, node);
  }

  private createMacroErrorExpression(message: string): ts.Expression {
    const factory = this.ctx.factory;
    return factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock([
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
                factory.createStringLiteral(message),
              ])
            ),
          ])
        )
      ),
      undefined,
      []
    );
  }

  private createMacroErrorStatement(message: string): ts.Statement {
    const factory = this.ctx.factory;
    return factory.createThrowStatement(
      factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
        factory.createStringLiteral(message),
      ])
    );
  }

  private updateDecorators(node: ts.Node, decorators: ts.Decorator[]): ts.Node {
    const modifiers = decorators.length > 0 ? decorators : undefined;
    const factory = this.ctx.factory;

    if (ts.isClassDeclaration(node)) {
      return factory.updateClassDeclaration(
        node,
        modifiers
          ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.name,
        node.typeParameters,
        node.heritageClauses,
        node.members
      );
    }

    if (ts.isFunctionDeclaration(node)) {
      return factory.updateFunctionDeclaration(
        node,
        modifiers
          ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body
      );
    }

    if (ts.isMethodDeclaration(node)) {
      return factory.updateMethodDeclaration(
        node,
        modifiers
          ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.asteriskToken,
        node.name,
        node.questionToken,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body
      );
    }

    if (ts.isInterfaceDeclaration(node)) {
      return factory.updateInterfaceDeclaration(
        node,
        modifiers
          ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.name,
        node.typeParameters,
        node.heritageClauses,
        node.members
      );
    }

    if (ts.isTypeAliasDeclaration(node)) {
      return factory.updateTypeAliasDeclaration(
        node,
        modifiers
          ? [...modifiers, ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? [])]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.name,
        node.typeParameters,
        node.type
      );
    }

    return node;
  }
}

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

// ============================================================================
// Derived Instance DCE
// ============================================================================

function eliminateDeadDerivedInstances(
  statements: ts.Statement[],
  inlinedInstanceNames: ReadonlySet<string>,
  verbose: boolean
): ts.Statement[] {
  if (inlinedInstanceNames.size === 0) return statements;

  const instanceDecls = new Map<string, { declIndex: number; regIndex?: number }>();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          inlinedInstanceNames.has(decl.name.text)
        ) {
          instanceDecls.set(decl.name.text, { declIndex: i });
        }
      }
    }

    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isPropertyAccessExpression(stmt.expression.expression) &&
      stmt.expression.expression.name.text === "registerInstance" &&
      stmt.expression.arguments.length >= 2
    ) {
      const lastArg = stmt.expression.arguments[stmt.expression.arguments.length - 1];
      if (ts.isIdentifier(lastArg) && instanceDecls.has(lastArg.text)) {
        instanceDecls.get(lastArg.text)!.regIndex = i;
      }
    }
  }

  if (instanceDecls.size === 0) return statements;

  const toRemove = new Set<number>();

  for (const [name, { declIndex, regIndex }] of instanceDecls) {
    let hasExternalRef = false;

    for (let i = 0; i < statements.length; i++) {
      if (i === declIndex || i === regIndex) continue;
      if (containsIdentifierRef(statements[i], name)) {
        hasExternalRef = true;
        break;
      }
    }

    if (!hasExternalRef) {
      toRemove.add(declIndex);
      if (regIndex !== undefined) toRemove.add(regIndex);
      if (verbose) {
        console.log(`[typesugar] DCE: removed fully-inlined instance '${name}'`);
      }
    }
  }

  if (toRemove.size === 0) return statements;

  return statements.filter((_, i) => !toRemove.has(i));
}

function containsIdentifierRef(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsIdentifierRef(child, name)) {
      found = true;
    }
  });

  return found;
}

export {
  TransformCache,
  DependencyGraph,
  createTransformCache,
  hashContent,
  type PreprocessedCacheEntry,
  type TransformCacheEntry,
} from "./cache.js";

export { generateManifest, createDefaultManifest, type MacroManifest } from "./manifest.js";
