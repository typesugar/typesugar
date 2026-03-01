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
  registerExtensionMethods,
  tryExtractSumType,
  getImplicitsFunction,
  transformImplicitsCall,
  buildImplicitScope,
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
  registerTypeclassSyntax,
  extractOpFromReturnType,
  type ImplicitScope,
  type ImplicitsFunctionInfo,
  type DictMethodMap,
  type DictMethod,
  type ResultAlgebra,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  createMacroContext,
  globalRegistry,
  globalExtensionRegistry,
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
  // Expansion tracking
  ExpansionTracker,
  globalExpansionTracker,
  // Expansion caching
  MacroExpansionCache,
} from "@typesugar/core";

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
 * Quick heuristic check for custom syntax that requires preprocessing.
 *
 * Checks for:
 * - `|>` (pipeline operator) outside string literals
 * - `<_>` (HKT declaration syntax) in type context
 * - `::` (cons operator) in value context (rough heuristic)
 *
 * This is intentionally fast and loose — false positives are fine (the
 * preprocessor will just return the code unchanged), but false negatives
 * mean custom syntax won't be handled.
 */
const NEEDS_PREPROCESS_RE = /\|>|<_>|[)\]}\w]\s*::\s*[(\[{A-Za-z_$]/;

/**
 * Detect whether a source file needs preprocessing and, if so, create a
 * new SourceFile from the preprocessed text.
 *
 * CAVEATS:
 * - The type checker was built against the original (non-preprocessed) program,
 *   so type resolution may be incomplete for preprocessed constructs. Macros
 *   that rely on the type checker (e.g. @implicits, extension methods) may
 *   not resolve correctly in preprocessed regions.
 * - For full type-aware transformation of files with custom syntax, use
 *   `unplugin-typesugar` or the `TransformationPipeline` which creates a
 *   fresh program from preprocessed content.
 * - This inline preprocessing is a best-effort fallback for `tsc` + ts-patch
 *   users who have files with custom syntax mixed with macros.
 */
function maybePreprocess(sourceFile: ts.SourceFile, verbose: boolean): ts.SourceFile {
  const text = sourceFile.text;

  if (!NEEDS_PREPROCESS_RE.test(text)) {
    return sourceFile;
  }

  try {
    const result = preprocess(text, { fileName: sourceFile.fileName });

    if (!result.changed) {
      return sourceFile;
    }

    if (verbose) {
      console.log(`[typesugar] Preprocessing: ${sourceFile.fileName}`);
    }

    const scriptKind =
      sourceFile.fileName.endsWith(".tsx") || sourceFile.fileName.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : sourceFile.fileName.endsWith(".mts") || sourceFile.fileName.endsWith(".cts")
          ? ts.ScriptKind.TS
          : ts.ScriptKind.TS;

    return ts.createSourceFile(
      sourceFile.fileName,
      result.code,
      sourceFile.languageVersion,
      /* setParentNodes */ true,
      scriptKind
    );
  } catch (e) {
    if (verbose) {
      console.log(`[typesugar] Preprocessing failed for ${sourceFile.fileName}: ${e}`);
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

  // Scan method signatures for Op<> return type annotations
  for (const member of targetInterface.members) {
    if (!ts.isMethodSignature(member)) continue;
    if (!member.name || !ts.isIdentifier(member.name)) continue;

    const methodName = member.name.text;
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
                  registerTypeclassSyntax(tcName, opsMap);
                }
              } else {
                // No explicit ops argument — extract Op<> from interface definition
                // This is the zero-cost path: syntax is extracted at transform time
                const opsMap = extractOpsFromInterface(importedSf, tcName);
                if (opsMap && opsMap.size > 0) {
                  if (verbose) {
                    console.log(
                      `[typesugar] Pre-registered syntax (from interface): ${tcName}: ${[...opsMap.entries()].map(([k, v]) => `${k}->${v}`).join(", ")}`
                    );
                  }
                  registerTypeclassSyntax(tcName, opsMap);
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

          // Handle registerTypeclassSyntax("Name", ...)
          if (fnName === "registerTypeclassSyntax" && node.arguments.length >= 2) {
            const nameArg = node.arguments[0];
            const syntaxArg = node.arguments[1];

            if (ts.isStringLiteral(nameArg)) {
              const tcName = nameArg.text;
              const syntaxMap = extractSyntaxMapFromArg(syntaxArg);
              if (syntaxMap && syntaxMap.size > 0) {
                if (verbose) {
                  console.log(
                    `[typesugar] Pre-registered syntax (call): ${tcName}: ${[...syntaxMap.entries()].map(([k, v]) => `${k}->${v}`).join(", ")}`
                  );
                }
                registerTypeclassSyntax(tcName, syntaxMap);
              }
            }
          }
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
 */
export default function macroTransformerFactory(
  program: ts.Program,
  config?: MacroTransformerConfig
): ts.TransformerFactory<ts.SourceFile> {
  const verbose = config?.verbose ?? false;
  const trackExpansions = config?.trackExpansions ?? false;

  // Apply conditional compilation config if provided
  if (config?.cfgConfig) {
    setCfgConfig(config.cfgConfig);
  }

  // Clear per-compilation caches (stale mirrors/derivations from watch-mode rebuilds)
  clearDerivationCaches();

  // Create a shared hygiene context for the entire compilation
  const hygiene = new HygieneContext();

  // Use the global expansion tracker (or a fresh one per compilation)
  const expansionTracker = trackExpansions ? globalExpansionTracker : undefined;

  // Instantiate the disk-backed expansion cache (one per compilation)
  const cacheDir = config?.cacheDir;
  const expansionCache =
    cacheDir !== false ? new MacroExpansionCache(cacheDir ?? ".typesugar-cache") : undefined;

  // Lazily load macro packages based on what the program actually imports.
  // This replaces eager side-effect imports that caused dependency cycles.
  loadMacroPackages(program, verbose);

  // Track which files have been scanned for registrations (prevents cycles)
  const scannedFiles = new Set<string>();

  if (verbose) {
    console.log("[typesugar] Initializing transformer");
    console.log(
      `[typesugar] Registered macros: ${globalRegistry
        .getAll()
        .map((m) => m.name)
        .join(", ")}`
    );
    if (expansionCache) {
      console.log(`[typesugar] Expansion cache loaded: ${expansionCache.size} entries`);
    }
  }

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      if (verbose) {
        console.log(`[typesugar] Processing: ${sourceFile.fileName}`);
      }

      // Phase 1: Preprocess custom syntax (|>, ::, F<_>) into valid TypeScript.
      // This must happen before macro expansion because the original source may
      // contain syntax that TypeScript couldn't parse correctly.
      sourceFile = maybePreprocess(sourceFile, verbose);

      const ctx = createMacroContext(program, sourceFile, context, hygiene);

      // Scan for imports and opt-out directives
      scanImportsForScope(sourceFile, globalResolutionScope);

      // Load macro packages based on this file's imports.
      // This is important for the language service where the initial program
      // may not include all files that will be transformed.
      loadMacroPackagesFromFile(sourceFile, verbose);

      // Pre-scan imported workspace files for instance() and typeclass() registrations.
      // This ensures instances are registered before operator rewriting encounters them.
      ensureImportedRegistrations(sourceFile, program, scannedFiles, verbose);

      // Check for file-level opt-out
      const fileScope = globalResolutionScope.getScope(sourceFile.fileName);
      if (fileScope.optedOut) {
        if (verbose) {
          console.log(`[typesugar] Skipping: ${sourceFile.fileName} (opted out)`);
        }
        return sourceFile;
      }

      const transformer = new MacroTransformer(ctx, verbose, expansionTracker, expansionCache);

      const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));

      // Report diagnostics through the TS diagnostic pipeline
      const macroDiagnostics = ctx.getDiagnostics();
      for (const diag of macroDiagnostics) {
        // Safely get start position - synthetic nodes throw on getStart
        let start = 0;
        let length = 0;
        try {
          start = diag.node ? diag.node.getStart(sourceFile) : 0;
          length = diag.node ? diag.node.getWidth(sourceFile) : 0;
        } catch {
          if (verbose) {
            console.log(`[typesugar] Warning: diagnostic node has no position: ${diag.message}`);
          }
        }

        const tsDiag: ts.Diagnostic = {
          file: sourceFile,
          start,
          length,
          messageText: `[typesugar] ${diag.message}`,
          category:
            diag.severity === "error" ? ts.DiagnosticCategory.Error : ts.DiagnosticCategory.Warning,
          code: 90000,
          source: "typesugar",
        };

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
   * Stack of implicit scopes from enclosing @implicits functions.
   * Pushed when entering an @implicits function body, popped on exit.
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
   * Get the current implicit scope (combined from all enclosing @implicits functions).
   * Inner scopes shadow outer ones.
   */
  private getCurrentImplicitScope(): ImplicitScope | undefined {
    if (this.implicitScopeStack.length === 0) return undefined;

    const combined = new Map<string, string>();
    for (const scope of this.implicitScopeStack) {
      for (const entry of Array.from(scope.available.entries())) {
        combined.set(entry[0], entry[1]);
      }
    }

    return { available: combined };
  }

  /**
   * Visit an @implicits function, tracking its implicit params in scope
   * so that nested calls can use them (propagation).
   */
  private visitImplicitsFunction(
    node: ts.FunctionDeclaration,
    funcInfo: ImplicitsFunctionInfo
  ): ts.Node | ts.Node[] {
    if (this.verbose) {
      console.log(
        `[typesugar] Entering @implicits function: ${funcInfo.functionName} ` +
          `(${funcInfo.implicitParams.length} implicit params)`
      );
    }

    const scope = buildImplicitScope(funcInfo, new Map());
    this.implicitScopeStack.push(scope);

    try {
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
   * Try to transform a call to an @implicits function.
   * If the function has implicit params and not all are provided, fill them in.
   * Uses the current implicit scope for propagation.
   */
  private tryTransformImplicitsCall(node: ts.CallExpression): ts.Expression | undefined {
    if (this.verbose && ts.isIdentifier(node.expression)) {
      const fnInfo = getImplicitsFunction(node.expression.text);
      console.log(
        `[typesugar] tryTransformImplicitsCall: ${node.expression.text}, registered=${!!fnInfo}`
      );
    }
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
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
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

    const result = this.scanImportsForExtension(sourceFile, methodName, receiverType);
    methodCache.set(methodName, result);
    return result;
  }

  private scanImportsForExtension(
    sourceFile: ts.SourceFile,
    methodName: string,
    receiverType: ts.Type
  ): StandaloneExtensionInfo | undefined {
    // Guard against synthetic source files that lack statements
    if (!sourceFile || !sourceFile.statements) {
      return undefined;
    }
    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;

      const clause = stmt.importClause;
      if (!clause) continue;

      // Check named imports: import { NumberExt, clamp } from "..."
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          const result = this.checkImportedSymbolForExtension(spec.name, methodName, receiverType);
          if (result) return result;
        }
      }

      // Check namespace import: import * as std from "..."
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const result = this.checkImportedSymbolForExtension(
          clause.namedBindings.name,
          methodName,
          receiverType
        );
        if (result) return result;
      }

      // Check default import: import Foo from "..."
      if (clause.name) {
        const result = this.checkImportedSymbolForExtension(clause.name, methodName, receiverType);
        if (result) return result;
      }
    }

    return undefined;
  }

  /**
   * Check if an imported identifier provides an extension method.
   *
   * Handles two cases:
   *   - The identifier IS a function named `methodName` whose first param
   *     matches the receiver type → bare function extension
   *   - The identifier is an object with a callable property named `methodName`
   *     whose first param matches → namespace extension
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

    // Handle @implicits function scope tracking for propagation
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcInfo = getImplicitsFunction(node.name.text, this.ctx.sourceFile.fileName);
      if (funcInfo && funcInfo.implicitParams.length > 0) {
        return this.visitImplicitsFunction(node, funcInfo);
      }
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
          newStatements.push(...(visited as ts.Node[]).filter(ts.isStatement));
          modified = true;
        } else if (ts.isStatement(visited)) {
          newStatements.push(visited);
        }
      }
    }

    // Clean up macro imports (only for source files — imports live at top level)
    let cleanedStatements = ts.isSourceFile(node)
      ? this.cleanupMacroImports(newStatements)
      : newStatements;

    // For source files: inject pending aliased imports from reference hygiene
    // and hoisted specialization declarations
    if (ts.isSourceFile(node)) {
      // Get pending aliased imports from FileBindingCache (for reference hygiene)
      const pendingImports = this.ctx.fileBindingCache.getPendingImports();

      // Get hoisted specialization declarations
      const hoistedDecls = this.specCache.getHoistedDeclarations();

      if (pendingImports.length > 0 || hoistedDecls.length > 0) {
        // Find insertion point after existing imports
        let insertIndex = 0;
        for (let i = 0; i < cleanedStatements.length; i++) {
          if (ts.isImportDeclaration(cleanedStatements[i])) {
            insertIndex = i + 1;
          } else {
            break;
          }
        }

        // Inject: [existing imports..., aliased imports, hoisted decls, rest of file...]
        cleanedStatements = [
          ...cleanedStatements.slice(0, insertIndex),
          ...pendingImports,
          ...hoistedDecls,
          ...cleanedStatements.slice(insertIndex),
        ];

        if (this.verbose) {
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
      return expr.name.text;
    }
    if (ts.isAsExpression(expr)) {
      return this.getInstanceName(expr.expression);
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

    // Find which arguments are registered instance dictionaries
    const instanceArgs: {
      index: number;
      name: string;
      methods: DictMethodMap;
    }[] = [];

    for (let i = 0; i < node.arguments.length; i++) {
      const arg = node.arguments[i];
      const argName = this.getInstanceName(arg);
      if (argName && isRegisteredInstance(argName)) {
        const methods = getInstanceMethods(argName);
        if (methods) {
          instanceArgs.push({ index: i, name: argName, methods });
        }
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

    if (ts.isBinaryExpression(node)) {
      const result = this.tryRewriteTypeclassOperator(node);
      if (result !== undefined) {
        return result;
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
    // interfaces/type aliases and @implicits on function declarations.
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

    const visited = ts.visitNode(currentNode, this.visit.bind(this)) as ts.Node;
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

          const parsedStmts = this.ctx.parseStatements(code);
          statements.push(...parsedStmts);

          const uncap = deriveName.charAt(0).toLowerCase() + deriveName.slice(1);
          instanceRegistry.push({
            typeclassName: deriveName,
            forType: typeName,
            instanceName: instanceVarName(uncap, typeName),
            derived: true,
          });

          registerExtensionMethods(typeName, deriveName);
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
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.TypeNode;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Type macro expansion failed: ${error}`);
      return node;
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

    // Use the global extension registry
    let extension = globalExtensionRegistry.find(methodName, typeName);

    // Try without generic parameters
    if (!extension) {
      const baseTypeName = typeName.replace(/<.*>$/, "");
      if (baseTypeName !== typeName) {
        extension = globalExtensionRegistry.find(methodName, baseTypeName);
      }
    }

    // Check standalone extensions — first the pre-registered registry,
    // then scan imports in the current file (Scala 3-style: extensions
    // are scoped to what's imported).
    let standaloneExt = findStandaloneExtension(methodName, typeName);
    if (!standaloneExt) {
      const baseTypeName = typeName.replace(/<.*>$/, "");
      if (baseTypeName !== typeName) {
        standaloneExt = findStandaloneExtension(methodName, baseTypeName);
      }
    }

    // Import-scoped resolution: scan the current file's imports for a
    // matching function or namespace property. This is the "error recovery"
    // path — any undefined method triggers a search of what's in scope.
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

    if (standaloneExt) {
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
        this.ctx.reportError(node, `Standalone extension method rewrite failed: ${error}`);
        return undefined;
      }
    }

    if (!extension) {
      return undefined;
    }

    if (this.verbose) {
      console.log(
        `[typesugar] Rewriting implicit extension: ${typeName}.${methodName}() → ${extension.typeclassName}.summon<${typeName}>("${typeName}").${methodName}(...)`
      );
    }

    const receiverText = receiver.getText
      ? receiver.getText()
      : ts.createPrinter().printNode(ts.EmitHint.Expression, receiver, this.ctx.sourceFile);

    const extraArgs = Array.from(node.arguments)
      .map((a) =>
        a.getText
          ? a.getText()
          : ts.createPrinter().printNode(ts.EmitHint.Expression, a, this.ctx.sourceFile)
      )
      .join(", ");

    const allArgs = extraArgs ? `${receiverText}, ${extraArgs}` : receiverText;

    const code = `${extension.typeclassName}.summon<${typeName}>("${typeName}").${methodName}(${allArgs})`;

    try {
      const result = this.ctx.parseExpression(code);
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Extension method rewrite failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Transform HKT declarations with F<_> kind syntax.
   *
   * Auto-detects interface/type declarations that use F<_> to denote
   * type constructor parameters, and transforms F<A> usages to $<F, A>.
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
   * When a typeclass method is annotated with `& Op<"+">`, any usage of `+`
   * on types that have an instance of that typeclass gets rewritten to a
   * direct method call (or inlined for zero-cost).
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

    const baseTypeName = leftTypeName.replace(/<.*>$/, "");
    const typeArg = leftTypeName.match(/<(.+)>$/)?.[1] ?? "";

    // Check if there's an instance for this type and operator
    for (const entry of entries) {
      let inst =
        findInstance(entry.typeclass, leftTypeName) ?? findInstance(entry.typeclass, baseTypeName);

      // Check union membership if no direct match
      if (!inst) {
        const candidateInstances = instanceRegistry.filter(
          (i) => i.typeclassName === entry.typeclass
        );
        for (const candidate of candidateInstances) {
          const candidateBase = candidate.forType.replace(/<.*>$/, "");
          const candidateArg = candidate.forType.match(/<(.+)>$/)?.[1] ?? "";

          for (const sf of this.ctx.program.getSourceFiles()) {
            if (sf.isDeclarationFile) continue;
            for (const stmt of sf.statements) {
              if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === candidateBase) {
                const aliasType = this.ctx.typeChecker.getTypeAtLocation(stmt.type);
                if (aliasType.isUnion?.()) {
                  for (const unionMember of aliasType.types) {
                    const memberName = this.ctx.typeChecker.typeToString(unionMember);
                    const memberBase = memberName.replace(/<.*>$/, "");
                    if (
                      memberBase === baseTypeName &&
                      (candidateArg === typeArg ||
                        candidateArg === typeArg.split("<")[0] ||
                        !candidateArg)
                    ) {
                      inst = candidate;
                      break;
                    }
                  }
                }
              }
            }
            if (inst) break;
          }
          if (inst) break;
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
    // Strip intersection types with Op<> - these are return type annotations that shouldn't affect instance lookup
    typeName = typeName.replace(/\s*&\s*Op<[^>]+>/, "");
    const baseTypeName = typeName.replace(/<.*>$/, "");
    const typeArg = typeName.match(/<(.+)>$/)?.[1] ?? "";

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
      | { typeclassName: string; forType: string; instanceName: string }
      | undefined;

    for (const entry of entries) {
      // First try exact match
      let inst =
        findInstance(entry.typeclass, typeName) ?? findInstance(entry.typeclass, baseTypeName);

      // If no exact match, try to find an instance via structural subtyping
      // e.g., Variable<number> → Expression<number> (if Expression is a union containing Variable)
      if (!inst) {
        // Check if this type is a member of a registered union type
        const candidateInstances = instanceRegistry.filter(
          (i) => i.typeclassName === entry.typeclass
        );
        for (const candidate of candidateInstances) {
          const candidateBase = candidate.forType.replace(/<.*>$/, "");
          const candidateArg = candidate.forType.match(/<(.+)>$/)?.[1] ?? "";

          // Look up the candidate type alias in source files
          for (const sf of this.ctx.program.getSourceFiles()) {
            if (sf.isDeclarationFile) continue;
            for (const stmt of sf.statements) {
              if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === candidateBase) {
                // Found the type alias - get its type from the checker
                const aliasType = this.ctx.typeChecker.getTypeAtLocation(stmt.type);

                // Check if it's a union and the actual type is one of its members
                if (aliasType.isUnion?.()) {
                  for (const unionMember of aliasType.types) {
                    const memberName = this.ctx.typeChecker.typeToString(unionMember);
                    const memberBase = memberName.replace(/<.*>$/, "");
                    if (
                      memberBase === baseTypeName &&
                      (candidateArg === typeArg ||
                        candidateArg === typeArg.split("<")[0] ||
                        !candidateArg)
                    ) {
                      inst = candidate;
                      break;
                    }
                  }
                }
              }
            }
            if (inst) break;
          }
          if (inst) break;
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
    const dictMethodMap = getInstanceMethods(matchedInstance.instanceName);
    if (dictMethodMap) {
      const dictMethod = dictMethodMap.methods.get(matchedEntry.method);
      if (dictMethod && dictMethod.source) {
        // TODO: Full inlining will be added in Step 6 (auto-specialization).
        // For now, fall through to the method call below.
      }
    }

    // Emit instanceVar.method(left, right)
    const methodAccess = factory.createPropertyAccessExpression(
      factory.createIdentifier(matchedInstance.instanceName),
      matchedEntry.method
    );
    const rewritten = factory.createCallExpression(methodAccess, undefined, [left, right]);
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
  type TransformResult,
  type TransformDiagnostic,
  type PipelineOptions,
} from "./pipeline.js";

export {
  VirtualCompilerHost,
  type VirtualCompilerHostOptions,
  type PreprocessedFile,
} from "./virtual-host.js";

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
