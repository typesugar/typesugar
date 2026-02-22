/**
 * @typesugar/transformer - Main TypeScript transformer for macro expansion
 *
 * This transformer integrates with ts-patch to process macros during compilation.
 */

import * as ts from "typescript";
import { preprocess } from "@typesugar/preprocessor";
import { loadMacroPackages } from "./macro-loader.js";

import {
  getOperatorString,
  getSyntaxForOperator,
  findInstance,
  getInstanceMethods,
  createSpecializedFunction,
  isKindAnnotation,
  transformHKTDeclaration,
  builtinDerivations,
  instanceRegistry,
  instanceVarName,
  registerExtensionMethods,
  tryExtractSumType,
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
} from "@typesugar/core";

/**
 * Configuration for the transformer
 */
export interface MacroTransformerConfig {
  /** Enable verbose logging */
  verbose?: boolean;

  /** Custom macro module paths to load */
  macroModules?: string[];
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

  // Lazily load macro packages based on what the program actually imports.
  // This replaces eager side-effect imports that caused dependency cycles.
  loadMacroPackages(program, verbose);

  if (verbose) {
    console.log("[typesugar] Initializing transformer");
    console.log(
      `[typesugar] Registered macros: ${globalRegistry
        .getAll()
        .map((m) => m.name)
        .join(", ")}`
    );
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

      const ctx = createMacroContext(program, sourceFile, context);

      // Scan for imports and opt-out directives
      scanImportsForScope(sourceFile, globalResolutionScope);

      // Check for file-level opt-out
      const fileScope = globalResolutionScope.getScope(sourceFile.fileName);
      if (fileScope.optedOut) {
        if (verbose) {
          console.log(`[typesugar] Skipping: ${sourceFile.fileName} (opted out)`);
        }
        return sourceFile;
      }

      const transformer = new MacroTransformer(ctx, verbose);

      const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));

      // Report diagnostics through the TS diagnostic pipeline
      const macroDiagnostics = ctx.getDiagnostics();
      for (const diag of macroDiagnostics) {
        const start = diag.node ? diag.node.getStart(sourceFile) : 0;
        const length = diag.node ? diag.node.getWidth(sourceFile) : 0;

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

  constructor(
    private ctx: MacroContextImpl,
    private verbose: boolean
  ) {}

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
      // that aren't part of the original program. Fall back to name lookup.
      return this.fallbackNameLookup(macroName, kind);
    }
    if (!symbol) {
      return this.fallbackNameLookup(macroName, kind);
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
      return this.fallbackNameLookup(macroName, kind);
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
    const byLocalName = this.fallbackNameLookup(macroName, kind);
    if (byLocalName) return byLocalName;

    const originalName = resolved.name;
    if (originalName !== macroName) {
      const byOriginalName = this.fallbackNameLookup(originalName, kind);
      if (byOriginalName) return byOriginalName;
    }

    return undefined;
  }

  /**
   * Map a file path back to a module specifier like "typemacro" or "@typesugar/units".
   */
  private resolveModuleSpecifier(fileName: string): string | undefined {
    const normalized = fileName.replace(/\\/g, "/");

    // Check for scoped packages in node_modules
    const nodeModulesMatch = normalized.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (nodeModulesMatch) {
      const pkgName = nodeModulesMatch[1];
      // Check for @typemacro scoped packages
      if (pkgName.startsWith("@typesugar/")) {
        return pkgName;
      }
      if (pkgName === "typemacro") {
        return "typemacro";
      }
      return pkgName;
    }

    // Development mode: detect from source tree structure
    if (normalized.includes("/packages/units/")) return "@typesugar/units";
    if (normalized.includes("/packages/sql/")) return "@typesugar/sql";
    if (normalized.includes("/packages/strings/")) return "@typesugar/strings";
    if (normalized.includes("/packages/fp/")) return "@typesugar/fp";
    if (normalized.includes("/packages/comptime/")) return "@typesugar/comptime";
    if (normalized.includes("/packages/reflect/")) return "@typesugar/reflect";
    if (normalized.includes("/packages/derive/")) return "@typesugar/derive";
    if (normalized.includes("/packages/mapper/")) return "@typesugar/mapper";
    if (normalized.includes("/packages/operators/")) return "@typesugar/operators";
    if (normalized.includes("/packages/typeclass/")) return "@typesugar/typeclass";
    if (normalized.includes("/packages/specialize/")) return "@typesugar/specialize";
    if (normalized.includes("/packages/core/")) return "@typesugar/core";
    if (normalized.includes("/packages/typemacro/")) return "typemacro";

    // Legacy source tree paths (for backwards compatibility during migration)
    if (normalized.includes("/src/use-cases/units/")) return "@typesugar/units";
    if (normalized.includes("/src/use-cases/sql/")) return "@typesugar/sql";
    if (normalized.includes("/src/use-cases/strings/")) return "@typesugar/strings";
    if (
      normalized.includes("/src/index.") ||
      normalized.includes("/src/macros/") ||
      normalized.includes("/src/core/") ||
      normalized.includes("/dist/")
    ) {
      return "typemacro";
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
   * Visit a node and potentially transform it
   */
  visit(node: ts.Node): ts.Node | ts.Node[] {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
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
            const result = macro.expand(this.ctx, stmt, continuation);
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
    const cleanedStatements = ts.isSourceFile(node)
      ? this.cleanupMacroImports(newStatements)
      : newStatements;

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
    // TypeScript's parser creates decorator nodes on interfaces and type aliases
    // for error recovery, but ts.canHaveDecorators() returns false for them.
    // We need to detect these to support @derive() on interfaces/type aliases.
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
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

    try {
      const result = macro.expand(this.ctx, node, node.arguments);
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
    const decorators = ts.getDecorators(node);
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
          const result = macro.expand(this.ctx, decorator, currentNode as ts.Declaration, args);

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
          const result = deriveMacro.expand(this.ctx, node, typeInfo);
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
          this.ctx.reportError(
            arg,
            `Typeclass auto-derivation failed for ${deriveName}: ${error}`
          );
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
          const result = tcDeriveMacro.expand(this.ctx, node, typeInfo);
          statements.push(...result);
        } catch (error) {
          this.ctx.reportError(
            arg,
            `Typeclass derive macro expansion failed: ${error}`
          );
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
          : member.typeName.getText();
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

        const result = taggedMacro.expand(this.ctx, node);
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
      const result = exprMacro.expand(this.ctx, node as unknown as ts.CallExpression, [
        node.template as unknown as ts.Expression,
      ]);
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
      if (ts.isIdentifier(node.typeName.left) && node.typeName.left.text === "typemacro") {
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
      const result = macro.expand(this.ctx, node, typeArgs);
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
      const dictNames = dictArgs
        .map((d) => (ts.isIdentifier(d) ? d.text : "<expr>"))
        .join(", ");
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
    let forceRewrite = false;
    if (existingProp) {
      // Check if we have an import-scoped extension that matches
      const potentialExt = this.resolveExtensionFromImports(node, methodName, receiverType);
      if (potentialExt) {
        forceRewrite = true;
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
  private tryRewriteTypeclassOperator(node: ts.BinaryExpression): ts.Expression | undefined {
    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "extensions")) {
      return undefined;
    }

    const opString = getOperatorString(node.operatorToken.kind);
    if (!opString) return undefined;

    const entries = getSyntaxForOperator(opString);
    if (!entries || entries.length === 0) return undefined;

    const leftType = this.ctx.typeChecker.getTypeAtLocation(node.left);
    const typeName = this.ctx.typeChecker.typeToString(leftType);
    const baseTypeName = typeName.replace(/<.*>$/, "");

    let matchedEntry: { typeclass: string; method: string } | undefined;
    let matchedInstance:
      | { typeclassName: string; forType: string; instanceName: string }
      | undefined;

    for (const entry of entries) {
      const inst =
        findInstance(entry.typeclass, typeName) ?? findInstance(entry.typeclass, baseTypeName);
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
