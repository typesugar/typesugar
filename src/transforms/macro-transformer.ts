/**
 * typemacro Transformer - Main TypeScript transformer for macro expansion
 *
 * This transformer integrates with ts-patch to process macros during compilation.
 */

import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../core/context.js";
import { globalRegistry } from "../core/registry.js";
import {
  ExpressionMacro,
  AttributeMacro,
  DeriveMacro,
  MacroDefinition,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  LabeledBlockMacro,
} from "../core/types.js";
import { HygieneContext } from "../core/hygiene.js";
import {
  ExpansionTracker,
  globalExpansionTracker,
} from "../core/source-map.js";
import {
  MacroCapabilities,
  resolveCapabilities,
  createRestrictedContext,
} from "../core/capabilities.js";
import { setCfgConfig } from "../macros/cfg.js";
import { setContractConfig } from "@typesugar/contracts";
import { clearDerivationCaches } from "../macros/auto-derive.js";
import { MacroExpansionCache } from "../core/cache.js";

// Import built-in macros to register them
import "../macros/index.js";

// Import extension method registry for implicit extension method resolution
import {
  findExtensionMethod,
  typeclassRegistry,
  builtinDerivations,
  instanceRegistry,
  registerExtensionMethods,
  instanceVarName,
  tryExtractSumType,
  getSyntaxForOperator,
  findInstance,
} from "../macros/typeclass.js";

// Import operator string mapping
import { getOperatorString } from "../macros/operators.js";

// Standalone extensions for concrete types
import {
  findStandaloneExtension,
  buildStandaloneExtensionCall,
  type StandaloneExtensionInfo,
} from "../macros/extension.js";

// Import @implicits implicit resolution with propagation
import {
  transformImplicitsCall,
  getImplicitsFunction,
  buildImplicitScope,
  type ImplicitScope,
  type ImplicitsFunctionInfo,
} from "../macros/implicits.js";

// Import auto-specialization infrastructure
import {
  isRegisteredInstance,
  getInstanceMethods,
  type DictMethodMap,
  type DictMethod,
} from "../macros/specialize.js";

// Import HKT transformation for F<_> syntax
import { isKindAnnotation, transformHKTDeclaration } from "../macros/hkt.js";

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
   * Defaults to `.typemacro-cache`.
   */
  cacheDir?: string | false;

  /**
   * Contract checking configuration.
   * Controls how requires/ensures/invariant macros are compiled.
   */
  contracts?: {
    /** "full" = all checks, "assertions" = invariants only, "none" = stripped */
    mode?: "full" | "assertions" | "none";
    /** Attempt compile-time proofs to eliminate runtime checks */
    proveAtCompileTime?: boolean;
    /** Fine-grained stripping per contract type */
    strip?: {
      preconditions?: boolean;
      postconditions?: boolean;
      invariants?: boolean;
    };
  };
}

/**
 * Create the TypeScript transformer factory
 * This is the entry point called by ts-patch
 */
export default function macroTransformerFactory(
  program: ts.Program,
  config?: MacroTransformerConfig,
): ts.TransformerFactory<ts.SourceFile> {
  const verbose = config?.verbose ?? false;
  const trackExpansions = config?.trackExpansions ?? false;

  // Apply conditional compilation config if provided
  if (config?.cfgConfig) {
    setCfgConfig(config.cfgConfig);
  }

  // Apply contract configuration if provided
  if (config?.contracts) {
    setContractConfig({
      mode: config.contracts.mode ?? "full",
      proveAtCompileTime: config.contracts.proveAtCompileTime ?? false,
      strip: config.contracts.strip ?? {},
      proverPlugins: [],
    });
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
    cacheDir !== false
      ? new MacroExpansionCache(cacheDir ?? ".typemacro-cache")
      : undefined;

  if (verbose) {
    console.log("[typemacro] Initializing transformer");
    console.log(
      `[typemacro] Registered macros: ${globalRegistry
        .getAll()
        .map((m) => m.name)
        .join(", ")}`,
    );
    if (expansionCache) {
      console.log(
        `[typemacro] Expansion cache loaded: ${expansionCache.size} entries`,
      );
    }
  }

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      if (verbose) {
        console.log(`[typemacro] Processing: ${sourceFile.fileName}`);
      }

      const ctx = createMacroContext(
        program,
        sourceFile,
        context,
        hygiene,
        expansionCache,
      );
      const transformer = new MacroTransformer(
        ctx,
        verbose,
        expansionTracker,
        expansionCache,
      );

      const result = ts.visitNode(
        sourceFile,
        transformer.visit.bind(transformer),
      );

      // Report diagnostics through the TS diagnostic pipeline
      const macroDiagnostics = ctx.getDiagnostics();
      for (const diag of macroDiagnostics) {
        const start = diag.node ? diag.node.getStart(sourceFile) : 0;
        const length = diag.node ? diag.node.getWidth(sourceFile) : 0;

        const tsDiag: ts.Diagnostic = {
          file: sourceFile,
          start,
          length,
          messageText: `[typemacro] ${diag.message}`,
          category:
            diag.severity === "error"
              ? ts.DiagnosticCategory.Error
              : ts.DiagnosticCategory.Warning,
          code: 90000, // Custom diagnostic code range for typemacro
          source: "typemacro",
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
          console.log(`[typemacro ${prefix}]${loc} ${diag.message}`);
        }
      }

      // Persist the expansion cache after each file.
      // save() is a no-op if nothing changed, so this is cheap for cache hits.
      // Saving per-file rather than at the end of the compilation ensures
      // partial results are preserved if the build is interrupted.
      if (expansionCache) {
        expansionCache.save();
      }

      if (verbose && expansionCache) {
        console.log(`[typemacro] ${expansionCache.getStatsString()}`);
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
   * Bound visitor function. Created once in the constructor to avoid
   * allocating a new closure on every `ts.visitNode` / `ts.visitEachChild` call.
   */
  private readonly boundVisit: (node: ts.Node) => ts.Node | ts.Node[];

  /**
   * Shared printer instance for node-to-string conversion.
   * Lazily created on first use to avoid overhead when not needed.
   */
  private _printer: ts.Printer | undefined;

  /**
   * Cache for resolveModuleSpecifier results.
   * File paths are stable within a compilation, so we can cache aggressively.
   */
  private moduleSpecifierCache = new Map<string, string | undefined>();

  /**
   * Cache for import-scoped extension resolution.
   * Key: ts.Type object identity, Value: Map<methodName, result>
   */
  private importExtensionCache = new Map<
    ts.Type,
    Map<string, StandaloneExtensionInfo | undefined>
  >();

  /**
   * Stack of implicit scopes for propagation through nested function calls.
   * When visiting an @implicits function body, we push its implicit params
   * onto this stack. Nested calls can then resolve implicits from enclosing
   * scopes before falling back to the global registry.
   */
  private implicitScopeStack: ImplicitScope[] = [];

  constructor(
    private ctx: MacroContextImpl,
    private verbose: boolean,
    private expansionTracker?: ExpansionTracker,
    private expansionCache?: MacroExpansionCache,
  ) {
    this.boundVisit = this.visit.bind(this);
  }

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
   * Try to retrieve a cached type node expansion (type macros).
   * Parses the cached string as a type reference in a synthetic source file.
   */
  private getCachedTypeNode(cacheKey: string): ts.TypeNode | undefined {
    if (!this.expansionCache) return undefined;
    const cached = this.expansionCache.get(cacheKey);
    if (cached === undefined) return undefined;
    try {
      const tempSource = ts.createSourceFile(
        "__cache_type__.ts",
        `type __T = ${cached};`,
        ts.ScriptTarget.Latest,
        true,
      );
      const typeAlias = tempSource.statements[0];
      if (ts.isTypeAliasDeclaration(typeAlias) && typeAlias.type) {
        return typeAlias.type;
      }
      this.expansionCache.invalidate(cacheKey);
      return undefined;
    } catch {
      this.expansionCache.invalidate(cacheKey);
      return undefined;
    }
  }

  /**
   * Try to retrieve a cached multi-statement expansion (attribute/derive macros).
   * Returns parsed statements on hit, undefined on miss.
   */
  private getCachedStatements(cacheKey: string): ts.Statement[] | undefined {
    if (!this.expansionCache) return undefined;
    const cached = this.expansionCache.getMulti(cacheKey);
    if (cached === undefined) return undefined;
    try {
      const stmts: ts.Statement[] = [];
      for (const code of cached) {
        stmts.push(...this.ctx.parseStatements(code));
      }
      return stmts;
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
    try {
      const text = this.printNodeSafe(result);
      if (text !== "<unprintable node>") {
        this.expansionCache.set(cacheKey, text);
      }
    } catch {
      // Non-fatal: expansion just won't be cached
    }
  }

  /**
   * Store a multi-node expansion result in the cache.
   */
  private cacheStatements(cacheKey: string, nodes: ts.Node[]): void {
    if (!this.expansionCache) return;
    try {
      const codeStrings = nodes.map((n) => this.printNodeSafe(n));
      if (codeStrings.every((s) => s !== "<unprintable node>")) {
        this.expansionCache.setMulti(cacheKey, codeStrings);
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Compute a cache key for a call-site macro invocation.
   * Uses the macro name + source text of the call + argument texts.
   */
  private computeCallSiteCacheKey(
    macroName: string,
    node: ts.Node,
    args: readonly ts.Node[],
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
   * Get the current implicit scope (combined from all enclosing @implicits functions)
   */
  private getCurrentImplicitScope(): ImplicitScope | undefined {
    if (this.implicitScopeStack.length === 0) return undefined;

    // Merge all scopes - inner scopes shadow outer ones
    const combined = new Map<string, string>();
    for (const scope of this.implicitScopeStack) {
      for (const entry of Array.from(scope.available.entries())) {
        combined.set(entry[0], entry[1]);
      }
    }

    return { available: combined };
  }

  /** Lazily-created shared printer for extension method rewriting */
  private get printer(): ts.Printer {
    return (this._printer ??= ts.createPrinter({
      newLine: ts.NewLineKind.LineFeed,
    }));
  }

  /** Safely print a node to text, handling synthetic nodes */
  private printNodeSafe(node: ts.Node): string {
    try {
      if (ts.isExpression(node)) {
        return this.printer.printNode(
          ts.EmitHint.Expression,
          node,
          this.ctx.sourceFile,
        );
      }
      return this.printer.printNode(
        ts.EmitHint.Unspecified,
        node,
        this.ctx.sourceFile,
      );
    } catch {
      return "<unprintable node>";
    }
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
   * Resolve an identifier to a macro definition via import tracking.
   *
   * For macros that declare a `module` field, this traces the identifier's
   * symbol back through imports/re-exports to see if it originates from
   * the macro's declared module. This handles:
   *   - Direct imports:  import { comptime } from "typesugar"
   *   - Renamed imports: import { comptime as ct } from "typesugar"
   *   - Barrel re-exports: import { comptime } from "./utils"
   *                        (where ./utils re-exports from "typesugar")
   *   - Namespace imports: import * as M from "typesugar"; M.comptime()
   *
   * For macros without a `module` field, falls back to name-based lookup
   * (legacy behavior).
   */
  private resolveMacroFromSymbol(
    node: ts.Node,
    macroName: string,
    kind: MacroDefinition["kind"],
  ): MacroDefinition | undefined {
    const symbol = this.ctx.typeChecker.getSymbolAtLocation(node);
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
    kind: MacroDefinition["kind"],
  ): MacroDefinition | undefined {
    // Chase through aliases (import bindings, re-exports)
    let resolved = symbol;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      try {
        resolved = this.ctx.typeChecker.getAliasedSymbol(resolved);
      } catch {
        // getAliasedSymbol can throw for unresolvable symbols
      }
    }

    // Find the declaration of the resolved symbol
    const declarations = resolved.getDeclarations();
    if (!declarations || declarations.length === 0) {
      return this.fallbackNameLookup(macroName, kind);
    }

    // Check each declaration's source file to determine the module
    for (const decl of declarations) {
      const sourceFile = decl.getSourceFile();
      const fileName = sourceFile.fileName;

      // Determine the module specifier from the file path.
      // We check if the file belongs to a known macro module.
      const moduleSpecifier = this.resolveModuleSpecifier(fileName);
      if (moduleSpecifier) {
        const exportName = resolved.name;
        const macro = globalRegistry.getByModuleExport(
          moduleSpecifier,
          exportName,
        );
        if (macro && macro.kind === kind) {
          return macro;
        }
        // Fallback: try the local call-site name (`macroName`) in case
        // `resolved.name` didn't match. After getAliasedSymbol(),
        // `resolved.name` is normally the original export name, so this
        // branch handles edge cases where alias resolution is incomplete
        // (e.g., re-exports that don't fully resolve).
        if (exportName !== macroName) {
          const macroByName = globalRegistry.getByModuleExport(
            moduleSpecifier,
            macroName,
          );
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
   * Map a file path back to a module specifier like "typemacro" or "typemacro/units".
   * Returns undefined if the file doesn't belong to a known macro package.
   *
   * Results are cached per file path since paths are stable within a compilation.
   */
  private resolveModuleSpecifier(fileName: string): string | undefined {
    const cached = this.moduleSpecifierCache.get(fileName);
    if (cached !== undefined) return cached;
    // Distinguish "cached as undefined" from "not in cache"
    if (this.moduleSpecifierCache.has(fileName)) return undefined;

    const result = this.resolveModuleSpecifierUncached(fileName);
    this.moduleSpecifierCache.set(fileName, result);
    return result;
  }

  private resolveModuleSpecifierUncached(fileName: string): string | undefined {
    // Normalize path separators (only if needed)
    const normalized = fileName.includes("\\")
      ? fileName.replace(/\\/g, "/")
      : fileName;

    // Check for "typemacro" package paths.
    // In node_modules: .../node_modules/typemacro/...
    const nmIdx = normalized.lastIndexOf("/node_modules/");
    if (nmIdx !== -1) {
      const afterNm = normalized.slice(nmIdx + 14); // length of "/node_modules/"
      // Extract package name (handle scoped packages)
      let pkgName: string;
      if (afterNm.startsWith("@")) {
        const secondSlash = afterNm.indexOf("/", afterNm.indexOf("/") + 1);
        pkgName = secondSlash === -1 ? afterNm : afterNm.slice(0, secondSlash);
      } else {
        const firstSlash = afterNm.indexOf("/");
        pkgName = firstSlash === -1 ? afterNm : afterNm.slice(0, firstSlash);
      }

      if (pkgName === "typemacro" || pkgName === "typesugar") {
        return this.resolveTypemacroSubpath(afterNm.slice(pkgName.length));
      }
      return pkgName;
    }

    // Development mode: detect from source tree structure
    return this.resolveDevModuleSpecifier(normalized);
  }

  /**
   * Resolve subpath within the typemacro package (e.g., /use-cases/units/ → "typemacro/units").
   */
  private resolveTypemacroSubpath(afterPkg: string): string {
    if (afterPkg.includes("/use-cases/units/")) return "typemacro/units";
    if (afterPkg.includes("/use-cases/comprehensions/"))
      return "typemacro/comprehensions";
    if (afterPkg.includes("/use-cases/sql/")) return "typemacro/sql";
    if (afterPkg.includes("/use-cases/strings/")) return "typemacro/strings";
    if (afterPkg.includes("/use-cases/testing/")) return "typemacro/testing";
    return "typemacro";
  }

  /**
   * Resolve module specifier from development source tree paths.
   */
  private resolveDevModuleSpecifier(normalized: string): string | undefined {
    // Check for monorepo packages
    const packagesMatch = normalized.match(
      /\/packages\/([^/]+)\/(?:src|dist)\//,
    );
    if (packagesMatch) {
      const pkgName = packagesMatch[1];
      if (
        pkgName === "transformer" ||
        pkgName === "unplugin-typesugar" ||
        pkgName === "eslint-plugin"
      ) {
        return undefined;
      }
      return `@typesugar/${pkgName}`;
    }

    if (normalized.includes("/src/use-cases/")) {
      if (normalized.includes("/units/")) return "typemacro/units";
      if (normalized.includes("/comprehensions/"))
        return "typemacro/comprehensions";
      if (normalized.includes("/sql/")) return "typemacro/sql";
      if (normalized.includes("/strings/")) return "typemacro/strings";
      if (normalized.includes("/testing/")) return "typemacro/testing";
    }
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
   * Fall back to name-based lookup, but only for macros that don't
   * require import scoping (i.e., macros without a `module` field).
   */
  private fallbackNameLookup(
    name: string,
    kind: MacroDefinition["kind"],
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

    // If the macro requires import scoping, don't return it from name-only lookup
    if (macro?.module) {
      return undefined;
    }

    return macro;
  }

  /**
   * Topologically sort decorators based on their macros' `expandAfter` declarations.
   * Decorators whose macros declare `expandAfter: ["X"]` are moved after the
   * decorator for macro "X". Non-macro decorators and decorators with no
   * dependency constraints keep their original relative order.
   */
  private sortDecoratorsByDependency(
    decorators: readonly ts.Decorator[],
  ): ts.Decorator[] {
    // Parse all decorators to get their macro names
    const parsed = decorators.map((d) => ({
      decorator: d,
      ...this.parseDecorator(d),
    }));

    // Build adjacency: macroName → expandAfter names
    const nameToIndex = new Map<string, number>();
    for (let i = 0; i < parsed.length; i++) {
      const name = parsed[i].macroName;
      if (name) nameToIndex.set(name, i);
    }

    // Check if any decorator has expandAfter — skip sort if none do
    let hasDeps = false;
    for (const p of parsed) {
      if (!p.macroName) continue;
      const macro =
        globalRegistry.getAttribute(p.macroName) ??
        globalRegistry.getDerive(p.macroName);
      if (macro?.expandAfter && macro.expandAfter.length > 0) {
        hasDeps = true;
        break;
      }
    }
    if (!hasDeps) return [...decorators];

    // Kahn's algorithm for topological sort
    const n = parsed.length;
    const inDegree = new Array<number>(n).fill(0);
    const adj = new Array<number[]>(n);
    for (let i = 0; i < n; i++) adj[i] = [];

    for (let i = 0; i < n; i++) {
      const name = parsed[i].macroName;
      if (!name) continue;
      const macro =
        globalRegistry.getAttribute(name) ?? globalRegistry.getDerive(name);
      if (!macro?.expandAfter) continue;
      for (const dep of macro.expandAfter) {
        const depIdx = nameToIndex.get(dep);
        if (depIdx !== undefined) {
          // dep must come before i: edge depIdx → i
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
      // Among ready nodes, pick the one with the smallest original index
      // to preserve relative order for unrelated decorators
      queue.sort((a, b) => a - b);
      const idx = queue.shift()!;
      sorted.push(parsed[idx].decorator);
      for (const next of adj[idx]) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      }
    }

    // If there's a cycle, fall back to original order
    if (sorted.length < n) {
      return [...decorators];
    }

    return sorted;
  }

  /**
   * Visit a node and potentially transform it
   */
  visit(node: ts.Node): ts.Node | ts.Node[] {
    // For nodes that contain statement lists, scan for labeled-block macros
    // before visiting children. This lets us consume sibling pairs like
    // `let: { ... } yield: { ... }` as a single macro expansion.
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
    }

    // Handle @implicits function scope tracking for propagation
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcInfo = getImplicitsFunction(
        node.name.text,
        this.ctx.sourceFile.fileName,
      );
      if (funcInfo && funcInfo.implicitParams.length > 0) {
        return this.visitImplicitsFunction(node, funcInfo);
      }
    }

    // First, check for macro invocations at this node
    const transformed = this.tryTransform(node);
    if (transformed !== undefined) {
      return transformed;
    }

    // Otherwise, visit children
    return ts.visitEachChild(node, this.boundVisit, this.ctx.transformContext);
  }

  /**
   * Visit an @implicits function, tracking its implicit params in scope
   * so that nested calls can use them (propagation).
   */
  private visitImplicitsFunction(
    node: ts.FunctionDeclaration,
    funcInfo: ImplicitsFunctionInfo,
  ): ts.Node | ts.Node[] {
    if (this.verbose) {
      console.log(
        `[typemacro] Entering @implicits function: ${funcInfo.functionName} ` +
          `(${funcInfo.implicitParams.length} implicit params)`,
      );
    }

    // Build scope from function parameters
    // For now, use the type param names directly - at call sites we'll
    // infer the concrete types
    const scope = buildImplicitScope(funcInfo, new Map());
    this.implicitScopeStack.push(scope);

    try {
      // First check for macro transformations on this node
      const transformed = this.tryTransform(node);
      if (transformed !== undefined) {
        return transformed;
      }

      // Visit children with scope active
      return ts.visitEachChild(
        node,
        this.boundVisit,
        this.ctx.transformContext,
      );
    } finally {
      this.implicitScopeStack.pop();
    }
  }

  /**
   * Visit a node that contains a statement list (SourceFile, Block, ModuleBlock).
   * Scans for labeled-block macro pairs and replaces them, then visits the rest.
   */
  private visitStatementContainer(
    node: ts.SourceFile | ts.Block | ts.ModuleBlock,
  ): ts.SourceFile | ts.Block | ts.ModuleBlock {
    const statements = node.statements;
    const newStatements: ts.Statement[] = [];
    let modified = false;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      if (ts.isLabeledStatement(stmt)) {
        const labelName = stmt.label.text;
        const macro = globalRegistry.getLabeledBlock(labelName);

        if (macro) {
          if (this.verbose) {
            console.log(
              `[typemacro] Expanding labeled block macro: ${labelName}:`,
            );
          }

          // Look ahead for a continuation labeled statement
          let continuation: ts.LabeledStatement | undefined;
          if (macro.continuationLabels && i + 1 < statements.length) {
            const next = statements[i + 1];
            if (
              ts.isLabeledStatement(next) &&
              macro.continuationLabels.includes(next.label.text)
            ) {
              continuation = next;
              i++; // consume the continuation statement
            }
          }

          // Check disk cache for cacheable labeled block macros
          const lblCacheable = this.isMacroCacheable(macro);
          const lblCacheNodes: ts.Node[] = continuation
            ? [stmt, continuation]
            : [stmt];
          const lblCacheKey = lblCacheable
            ? this.computeCallSiteCacheKey(labelName, stmt, lblCacheNodes)
            : undefined;

          if (lblCacheKey) {
            const cachedStmts = this.getCachedStatements(lblCacheKey);
            if (cachedStmts) {
              if (this.verbose) {
                console.log(
                  `[typemacro] Cache hit for labeled block: ${labelName}`,
                );
              }
              for (const s of cachedStmts) {
                const visited = ts.visitNode(s, this.boundVisit);
                if (visited) {
                  if (Array.isArray(visited)) {
                    newStatements.push(
                      ...(visited as ts.Node[]).filter(ts.isStatement),
                    );
                  } else {
                    newStatements.push(visited as ts.Statement);
                  }
                }
              }
              modified = true;
              continue;
            }
          }

          try {
            const result = this.ctx.hygiene.withScope(() =>
              macro.expand(this.ctx, stmt, continuation),
            );
            const expanded = Array.isArray(result) ? result : [result];

            if (lblCacheKey) {
              this.cacheStatements(lblCacheKey, expanded);
            }

            // Visit the expanded statements for nested macros
            for (const s of expanded) {
              const visited = ts.visitNode(s, this.boundVisit);
              if (visited) {
                if (Array.isArray(visited)) {
                  newStatements.push(
                    ...(visited as ts.Node[]).filter(ts.isStatement),
                  );
                } else {
                  newStatements.push(visited as ts.Statement);
                }
              }
            }
          } catch (error) {
            this.ctx.reportError(
              stmt,
              `Labeled block macro expansion failed: ${error}`,
            );
            newStatements.push(
              this.createMacroErrorStatement(
                `typemacro: labeled block '${labelName}:' expansion failed: ${error}`,
              ),
            );
          }

          modified = true;
          continue;
        }
      }

      // Not a labeled-block macro — visit normally
      const visited = ts.visitNode(stmt, this.boundVisit);
      if (visited) {
        if (Array.isArray(visited)) {
          newStatements.push(...(visited as ts.Node[]).filter(ts.isStatement));
        } else {
          newStatements.push(visited as ts.Statement);
        }
      }
    }

    if (!modified) {
      // No labeled-block macros found; fall back to normal child visiting
      // (the statements were already visited above, so just rebuild)
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
   *    `"namespace"` was recorded — which happens when the namespace identifier
   *    resolved to a macro. (In practice, namespace imports are kept unless
   *    every property access on them was a macro call; future work could track
   *    non-macro uses to be more precise.)
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
        // This import had no macro specifiers — keep it as-is
        result.push(stmt);
        continue;
      }

      const importClause = stmt.importClause;
      if (!importClause) {
        // Side-effect import: `import "module"` — always keep
        result.push(stmt);
        continue;
      }

      // Determine what's left after removing macro bindings
      const hasDefaultImport = importClause.name !== undefined;
      const defaultIsMacro = tracked.has("default");
      const keepDefault = hasDefaultImport && !defaultIsMacro;

      const namedBindings = importClause.namedBindings;
      let newNamedBindings: ts.NamedImportBindings | undefined;

      if (namedBindings) {
        if (ts.isNamespaceImport(namedBindings)) {
          // import * as M from "..."
          if (tracked.has("namespace")) {
            newNamedBindings = undefined; // remove namespace binding
          } else {
            newNamedBindings = namedBindings; // keep it
          }
        } else if (ts.isNamedImports(namedBindings)) {
          // import { a, b, c } from "..."
          const remainingSpecifiers = namedBindings.elements.filter(
            (spec) => !tracked.has(spec),
          );

          if (remainingSpecifiers.length === namedBindings.elements.length) {
            // Nothing was removed
            newNamedBindings = namedBindings;
          } else if (remainingSpecifiers.length > 0) {
            newNamedBindings = factory.updateNamedImports(
              namedBindings,
              remainingSpecifiers,
            );
          } else {
            newNamedBindings = undefined; // all named imports were macros
          }
        }
      }

      // If nothing remains, drop the entire import
      if (!keepDefault && !newNamedBindings) {
        if (this.verbose) {
          const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
            ? stmt.moduleSpecifier.text
            : "<unknown>";
          console.log(
            `[typemacro] Removing macro-only import: import ... from "${moduleSpec}"`,
          );
        }
        continue; // drop the import
      }

      // Rebuild the import clause with the remaining bindings
      const newImportClause = factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        keepDefault ? importClause.name : undefined,
        newNamedBindings,
      );

      const newImport = factory.updateImportDeclaration(
        stmt,
        stmt.modifiers,
        newImportClause,
        stmt.moduleSpecifier,
        stmt.attributes,
      );

      if (this.verbose) {
        const moduleSpec = ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : "<unknown>";
        console.log(
          `[typemacro] Trimmed macro specifiers from import: "${moduleSpec}"`,
        );
      }

      result.push(newImport);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Macro expansion
  // ---------------------------------------------------------------------------

  /**
   * Try to transform a node if it's a macro invocation.
   *
   * Uses SyntaxKind-based dispatch for fast rejection of non-macro nodes.
   * Most nodes in a typical file are not macro invocations, so fast rejection
   * on the common path is critical for performance.
   */
  private tryTransform(node: ts.Node): ts.Node | ts.Node[] | undefined {
    switch (node.kind) {
      case ts.SyntaxKind.CallExpression: {
        const callNode = node as ts.CallExpression;
        // Check for expression macros (function calls)
        const exprResult = this.tryExpandExpressionMacro(callNode);
        if (exprResult !== undefined) return exprResult;

        // Check for @implicits implicit parameter resolution (with propagation)
        const implicitsResult = this.tryTransformImplicitsCall(callNode);
        if (implicitsResult !== undefined) return implicitsResult;

        // Check for implicit extension method calls: x.show() where .show()
        // doesn't exist on x's type but is provided by a typeclass extension
        if (
          callNode.expression.kind === ts.SyntaxKind.PropertyAccessExpression
        ) {
          const extResult = this.tryRewriteExtensionMethod(callNode);
          if (extResult !== undefined) return extResult;
        }

        // Check for auto-specialization: if any argument is a known instance
        // dictionary (e.g., optionMonad, arrayFunctor), inline the dictionary methods
        // Skip if there's a @no-specialize comment
        const autoSpecResult = this.tryAutoSpecialize(callNode);
        if (autoSpecResult !== undefined) return autoSpecResult;

        return undefined;
      }

      case ts.SyntaxKind.TaggedTemplateExpression:
        return this.tryExpandTaggedTemplate(
          node as ts.TaggedTemplateExpression,
        );

      case ts.SyntaxKind.TypeReference:
        return this.tryExpandTypeMacro(node as ts.TypeReferenceNode);

      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.FunctionDeclaration:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.PropertyDeclaration:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
        // These are the only node kinds that can have decorators
        if (this.hasDecorators(node)) {
          return this.tryExpandAttributeMacros(node as ts.HasDecorators);
        }
        return undefined;

      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        // Auto-detect and transform HKT F<_> syntax
        return this.tryTransformHKTDeclaration(
          node as ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
        );

      default:
        // Check for binary expression operator overloading via typeclasses
        if (ts.isBinaryExpression(node)) {
          const opResult = this.tryRewriteTypeclassOperator(node);
          if (opResult !== undefined) return opResult;
        }
        return undefined;
    }
  }

  /**
   * Check if a node has decorators
   */
  private hasDecorators(node: ts.Node): node is ts.HasDecorators {
    return ts.canHaveDecorators(node) && ts.getDecorators(node) !== undefined;
  }

  /**
   * Try to expand an expression macro
   */
  private tryExpandExpressionMacro(
    node: ts.CallExpression,
  ): ts.Expression | undefined {
    // Get the macro name and the identifier node to resolve
    let macroName: string | undefined;
    let identNode: ts.Node | undefined;

    if (ts.isIdentifier(node.expression)) {
      macroName = node.expression.text;
      identNode = node.expression;
    } else if (ts.isPropertyAccessExpression(node.expression)) {
      // Handle namespaced macros like `macro.comptime()` or `M.comptime()`
      if (ts.isIdentifier(node.expression.expression)) {
        if (node.expression.expression.text === "macro") {
          macroName = node.expression.name.text;
          identNode = node.expression.name;
        } else {
          // Namespace import: M.comptime() -- resolve M.comptime
          macroName = node.expression.name.text;
          identNode = node.expression;
        }
      }
    }

    if (!macroName || !identNode) return undefined;

    // Resolve through imports -- only expands if the symbol traces back
    // to a known macro module (or if the macro has no module requirement)
    const macro = this.resolveMacroFromSymbol(
      identNode,
      macroName,
      "expression",
    ) as ExpressionMacro | undefined;
    if (!macro) return undefined;

    if (this.verbose) {
      console.log(`[typemacro] Expanding expression macro: ${macroName}`);
    }

    // Check disk cache for cacheable macros
    const cacheable = this.isMacroCacheable(macro);
    const cacheKey = cacheable
      ? this.computeCallSiteCacheKey(
          macroName,
          node,
          Array.from(node.arguments),
        )
      : undefined;

    if (cacheKey) {
      const cached = this.getCachedExpression(cacheKey);
      if (cached) {
        if (this.verbose) {
          console.log(
            `[typemacro] Cache hit for expression macro: ${macroName}`,
          );
        }
        return ts.visitNode(cached, this.boundVisit) as ts.Expression;
      }
    }

    try {
      // Wrap expansion in a hygiene scope so generated names are isolated
      const result = this.ctx.hygiene.withScope(() =>
        macro.expand(this.ctx, node, node.arguments),
      );

      // Store in disk cache
      if (cacheKey) {
        this.cacheExpression(cacheKey, result);
      }

      // Record the expansion for source map / diagnostics
      if (this.expansionTracker) {
        const expandedText = this.printNodeSafe(result);
        this.expansionTracker.recordExpansion(
          macroName,
          node,
          this.ctx.sourceFile,
          expandedText,
        );
      }

      const visited = ts.visitNode(result, this.boundVisit);
      return visited as ts.Expression;
    } catch (error) {
      this.ctx.reportError(node, `Macro expansion failed: ${error}`);
      return this.createMacroErrorExpression(
        `typemacro: expansion of '${macroName}' failed: ${error}`,
      );
    }
  }

  /**
   * Try to transform a call to an @implicits function.
   * If the function has implicit params and not all are provided, fill them in.
   * Uses the current implicit scope for propagation.
   */
  private tryTransformImplicitsCall(
    node: ts.CallExpression,
  ): ts.Expression | undefined {
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
        console.log(
          `[typemacro] Filling implicit parameters for call: ${funcName}()${fromScope}`,
        );
      }
      return ts.visitNode(result, this.boundVisit) as ts.Expression;
    }
    return undefined;
  }

  /**
   * Try to auto-specialize a function call when an argument is a known
   * typeclass instance dictionary.
   *
   * Level 1 auto-specialization: when the transformer sees a function call
   * where an argument is a reference to a registered instance dictionary
   * (e.g., optionMonad, arrayFunctor), it automatically inlines the dictionary
   * methods. No specialize() wrapper needed.
   *
   * Example:
   *   double(optionMonad, myOpt)  // compiler sees optionMonad → inlines F.map
   */
  private tryAutoSpecialize(
    node: ts.CallExpression,
  ): ts.Expression | undefined {
    // Synthetic nodes cannot be checked for source text comments
    if (node.pos === -1 || node.end === -1) return undefined;

    // Check if caller has opted out with // @no-specialize comment
    const sourceText = node.getSourceFile().text;
    const nodeStart = node.getStart();
    const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
    const lineText = sourceText.slice(lineStart, nodeStart);
    if (lineText.includes("@no-specialize")) {
      return undefined;
    }

    // Find which arguments (if any) are registered instance dictionaries
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

    // No registered instances found
    if (instanceArgs.length === 0) {
      return undefined;
    }

    // Try to resolve the called function to its body
    const fnBody = this.resolveAutoSpecFunctionBody(node.expression);
    if (!fnBody) {
      // Can't resolve function body - fall back to partial application
      // Create: (...args) => fn(instanceArg, ...args)
      // This eliminates the dictionary at call sites even when we can't inline
      if (instanceArgs.length === 1 && instanceArgs[0].index === 0) {
        const instanceArg = node.arguments[0];
        const remainingArgs = node.arguments.slice(1);

        // Create visited args (continue transformation on remaining args)
        const visitedArgs = remainingArgs.map(
          (arg) => ts.visitNode(arg, this.boundVisit) as ts.Expression,
        );

        // Rebuild call with remaining args only - partial application at call site
        // This creates: fn(instanceArg, arg1, arg2) -> specialized_fn(arg1, arg2)
        // when we can't resolve the body, but we know the instance
        // For now, just return undefined and let normal transformation proceed
        // A more sophisticated implementation would create a specialized thunk
      }
      return undefined;
    }

    if (this.verbose) {
      const fnName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : "<anonymous>";
      console.log(
        `[typemacro] Auto-specializing call to ${fnName} with instance: ${instanceArgs.map((a) => a.name).join(", ")}`,
      );
    }

    // Specialize the function body by inlining dictionary method calls
    try {
      const specialized = this.inlineAutoSpecialize(
        fnBody,
        instanceArgs,
        Array.from(node.arguments),
      );

      if (specialized) {
        // Visit the result to handle any nested macros/specializations
        return ts.visitNode(specialized, this.boundVisit) as ts.Expression;
      }
    } catch (error) {
      if (this.verbose) {
        console.log(`[typemacro] Auto-specialization failed: ${error}`);
      }
    }

    return undefined;
  }

  /**
   * Get the instance dictionary name from an expression.
   */
  private getInstanceName(expr: ts.Expression): string | undefined {
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }
    if (ts.isPropertyAccessExpression(expr)) {
      // Handle module.instanceName
      return expr.name.text;
    }
    if (ts.isAsExpression(expr)) {
      // Handle instanceArg as any
      return this.getInstanceName(expr.expression);
    }
    return undefined;
  }

  /**
   * Resolve a function expression to its body for auto-specialization.
   */
  private resolveAutoSpecFunctionBody(
    fnExpr: ts.Expression,
  ):
    | ts.ArrowFunction
    | ts.FunctionExpression
    | ts.FunctionDeclaration
    | undefined {
    // Direct arrow/function expression
    if (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)) {
      return fnExpr;
    }

    // Identifier — resolve to declaration
    if (ts.isIdentifier(fnExpr)) {
      const symbol = this.ctx.typeChecker.getSymbolAtLocation(fnExpr);
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const decl of declarations) {
        // const fn = (...) => { ... }
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          if (
            ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer)
          ) {
            return decl.initializer;
          }
        }
        // function fn(...) { ... }
        if (ts.isFunctionDeclaration(decl)) {
          return decl;
        }
      }
    }

    // Property access — try to resolve module.function
    if (ts.isPropertyAccessExpression(fnExpr)) {
      const symbol = this.ctx.typeChecker.getSymbolAtLocation(fnExpr);
      if (!symbol) return undefined;

      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const decl of declarations) {
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          if (
            ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer)
          ) {
            return decl.initializer;
          }
        }
        if (ts.isFunctionDeclaration(decl)) {
          return decl;
        }
      }
    }

    return undefined;
  }

  /**
   * Inline dictionary method calls in a function body for auto-specialization.
   */
  private inlineAutoSpecialize(
    fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
    instanceArgs: { index: number; name: string; methods: DictMethodMap }[],
    callArgs: ts.Expression[],
  ): ts.Expression | undefined {
    const params = Array.from(fn.parameters);
    if (params.length === 0) return undefined;

    // Build a map of dictionary param name -> methods
    const dictParamMap = new Map<string, DictMethodMap>();
    const dictParamIndices = new Set<number>();

    for (const instArg of instanceArgs) {
      if (instArg.index < params.length) {
        const param = params[instArg.index];
        const paramName = ts.isIdentifier(param.name)
          ? param.name.text
          : undefined;
        if (paramName) {
          dictParamMap.set(paramName, instArg.methods);
          dictParamIndices.add(instArg.index);
        }
      }
    }

    if (dictParamMap.size === 0) return undefined;

    // Get the function body
    const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
    if (!body) return undefined;

    // Get remaining parameters (non-dictionary)
    const remainingParams = params.filter((_, i) => !dictParamIndices.has(i));

    // Get remaining arguments (non-dictionary)
    const remainingArgs = callArgs.filter((_, i) => !dictParamIndices.has(i));

    // Rewrite dictionary calls in the body
    const specializedBody = this.rewriteDictCallsForAutoSpec(
      body,
      dictParamMap,
    );

    // If no remaining params, just return the specialized body as a call
    if (remainingParams.length === 0) {
      if (ts.isExpression(specializedBody)) {
        return specializedBody;
      }
      // For block bodies, wrap in IIFE
      if (ts.isBlock(specializedBody)) {
        return this.ctx.factory.createCallExpression(
          this.ctx.factory.createParenthesizedExpression(
            this.ctx.factory.createArrowFunction(
              undefined,
              undefined,
              [],
              undefined,
              this.ctx.factory.createToken(
                ts.SyntaxKind.EqualsGreaterThanToken,
              ),
              specializedBody,
            ),
          ),
          undefined,
          [],
        );
      }
    }

    // Create specialized function and call it with remaining args
    const specializedFn = this.ctx.factory.createArrowFunction(
      undefined,
      undefined,
      remainingParams,
      undefined,
      this.ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      specializedBody as ts.ConciseBody,
    );

    // Call the specialized function with remaining args
    return this.ctx.factory.createCallExpression(
      this.ctx.factory.createParenthesizedExpression(specializedFn),
      undefined,
      remainingArgs,
    );
  }

  /**
   * Rewrite dictionary method calls (D.method(args)) with inlined implementations.
   */
  private rewriteDictCallsForAutoSpec(
    node: ts.Node,
    dictParamMap: Map<string, DictMethodMap>,
  ): ts.Node {
    const self = this;

    function visit(n: ts.Node): ts.Node {
      // Match: dictParam.method(args...)
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
            const inlined = self.inlineMethodForAutoSpec(
              method,
              Array.from(n.arguments),
            );
            if (inlined) {
              return ts.visitEachChild(
                inlined,
                visit,
                self.ctx.transformContext,
              );
            }
          }
        }
      }

      return ts.visitEachChild(n, visit, self.ctx.transformContext);
    }

    return ts.visitNode(node, visit) as ts.Node;
  }

  /**
   * Inline a dictionary method implementation.
   */
  private inlineMethodForAutoSpec(
    method: DictMethod,
    callArgs: ts.Expression[],
  ): ts.Expression | undefined {
    // Prefer AST node if available
    if (method.node) {
      return this.inlineFromNodeForAutoSpec(
        method.node,
        method.params,
        callArgs,
      );
    }

    // Fall back to parsing source string
    if (method.source) {
      try {
        const methodExpr = this.ctx.parseExpression(method.source);
        return this.inlineFromNodeForAutoSpec(
          methodExpr,
          method.params,
          callArgs,
        );
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Inline a method from its AST node.
   */
  private inlineFromNodeForAutoSpec(
    methodNode: ts.Expression | ts.Node,
    paramNames: string[],
    callArgs: ts.Expression[],
  ): ts.Expression | undefined {
    let body: ts.Node | undefined;
    let params: readonly ts.ParameterDeclaration[] | undefined;

    if (ts.isArrowFunction(methodNode)) {
      body = methodNode.body;
      params = methodNode.parameters;
    } else if (ts.isFunctionExpression(methodNode)) {
      body = methodNode.body;
      params = methodNode.parameters;
    } else if (ts.isMethodDeclaration(methodNode)) {
      body = methodNode.body;
      params = methodNode.parameters;
    } else {
      return undefined;
    }

    if (!body) return undefined;

    // Build substitution map
    const substitutions = new Map<string, ts.Expression>();
    for (let i = 0; i < paramNames.length && i < callArgs.length; i++) {
      substitutions.set(paramNames[i], callArgs[i]);
    }

    // Also try from AST params
    if (params) {
      for (let i = 0; i < params.length && i < callArgs.length; i++) {
        const param = params[i];
        if (ts.isIdentifier(param.name)) {
          const paramName = param.name.text;
          if (!substitutions.has(paramName)) {
            substitutions.set(paramName, callArgs[i]);
          }
        }
      }
    }

    // For block bodies, extract the return expression
    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          return this.substituteParamsForAutoSpec(
            stmt.expression,
            substitutions,
          );
        }
      }
      return undefined;
    }

    return this.substituteParamsForAutoSpec(body, substitutions);
  }

  /**
   * Substitute parameter references with argument expressions.
   */
  private substituteParamsForAutoSpec(
    node: ts.Node,
    substitutions: Map<string, ts.Expression>,
  ): ts.Expression {
    const self = this;

    function visit(n: ts.Node): ts.Node {
      if (ts.isIdentifier(n)) {
        const replacement = substitutions.get(n.text);
        if (replacement) {
          return replacement;
        }
      }
      return ts.visitEachChild(n, visit, self.ctx.transformContext);
    }

    return ts.visitNode(node, visit) as ts.Expression;
  }

  /**
   * Try to expand attribute macros on a declaration
   */
  private tryExpandAttributeMacros(
    node: ts.HasDecorators,
  ): ts.Node | ts.Node[] | undefined {
    const decorators = ts.getDecorators(node);
    if (!decorators || decorators.length === 0) return undefined;

    // Sort decorators by dependency order (expandAfter)
    const sortedDecorators = this.sortDecoratorsByDependency(decorators);

    let currentNode: ts.Node = node;
    const extraStatements: ts.Statement[] = [];
    const remainingDecorators: ts.Decorator[] = [];
    let wasTransformed = false;

    for (const decorator of sortedDecorators) {
      const { macroName, args, identNode } = this.parseDecorator(decorator);

      // Check for @derive or @deriving decorator -- both route through the
      // unified derive handler that supports code-gen derives AND typeclass
      // auto-derivation. @deriving is kept as a backward-compatible alias.
      if (macroName === "derive" || macroName === "deriving") {
        const deriveMacroResolved = identNode
          ? this.resolveMacroFromSymbol(identNode, macroName, "attribute")
          : globalRegistry.getAttribute(macroName);
        if (deriveMacroResolved) {
          const derives = this.expandDeriveDecorator(decorator, node, args);
          if (derives) {
            extraStatements.push(...derives);
            wasTransformed = true;
            continue;
          }
        }
      }

      // Check for attribute macro -- resolve through imports
      const macro = (
        identNode
          ? this.resolveMacroFromSymbol(identNode, macroName, "attribute")
          : globalRegistry.getAttribute(macroName)
      ) as AttributeMacro | undefined;
      if (macro) {
        if (this.verbose) {
          console.log(`[typemacro] Expanding attribute macro: ${macroName}`);
        }

        // Check disk cache for cacheable attribute macros
        const attrCacheable = this.isMacroCacheable(macro);
        const attrCacheKey = attrCacheable
          ? this.computeCallSiteCacheKey(macroName, decorator, args)
          : undefined;

        if (attrCacheKey) {
          const cachedStmts = this.getCachedStatements(attrCacheKey);
          if (cachedStmts && cachedStmts.length > 0) {
            if (this.verbose) {
              console.log(
                `[typemacro] Cache hit for attribute macro: ${macroName}`,
              );
            }
            currentNode = cachedStmts[0];
            extraStatements.push(...cachedStmts.slice(1));
            wasTransformed = true;
            continue;
          }
        }

        try {
          const result = this.ctx.hygiene.withScope(() =>
            macro.expand(
              this.ctx,
              decorator,
              currentNode as ts.Declaration,
              args,
            ),
          );

          if (Array.isArray(result)) {
            if (result.length > 0) {
              currentNode = result[0];
              extraStatements.push(...result.slice(1).filter(ts.isStatement));
            }
            if (attrCacheKey) {
              this.cacheStatements(attrCacheKey, result);
            }
          } else {
            currentNode = result;
            if (attrCacheKey) {
              this.cacheStatements(attrCacheKey, [result]);
            }
          }
          wasTransformed = true;
        } catch (error) {
          this.ctx.reportError(
            decorator,
            `Attribute macro expansion failed: ${error}`,
          );
          extraStatements.push(
            this.createMacroErrorStatement(
              `typemacro: attribute macro '${macroName}' failed: ${error}`,
            ),
          );
          remainingDecorators.push(decorator);
          wasTransformed = true;
        }
      } else {
        // Keep decorators that aren't macros
        remainingDecorators.push(decorator);
      }
    }

    if (!wasTransformed) return undefined;

    // Update the node with remaining decorators
    if (remainingDecorators.length !== decorators.length) {
      currentNode = this.updateDecorators(currentNode, remainingDecorators);
    }

    // Visit the transformed node
    const visited = ts.visitNode(currentNode, this.boundVisit);

    if (extraStatements.length > 0) {
      return [visited as ts.Node, ...extraStatements];
    }

    return visited as ts.Node;
  }

  /**
   * Parse a decorator to extract macro name, arguments, and the identifier
   * node for symbol resolution.
   *
   * Handles:
   * - @macroName
   * - @macroName(args...)
   * - @module.macroName
   * - @module.macroName(args...)
   */
  private parseDecorator(decorator: ts.Decorator): {
    macroName: string;
    args: ts.Expression[];
    identNode: ts.Node | undefined;
  } {
    const expr = decorator.expression;

    // @macroName
    if (ts.isIdentifier(expr)) {
      return { macroName: expr.text, args: [], identNode: expr };
    }

    // @macroName(args...) or @module.macroName(args...)
    if (ts.isCallExpression(expr)) {
      if (ts.isIdentifier(expr.expression)) {
        return {
          macroName: expr.expression.text,
          args: Array.from(expr.arguments),
          identNode: expr.expression,
        };
      }
      // @module.macroName(args...)
      if (ts.isPropertyAccessExpression(expr.expression)) {
        return {
          macroName: expr.expression.name.text,
          args: Array.from(expr.arguments),
          identNode: expr.expression,
        };
      }
    }

    // @module.macroName (no call)
    if (ts.isPropertyAccessExpression(expr)) {
      return { macroName: expr.name.text, args: [], identNode: expr };
    }

    // Unrecognized decorator form — not a macro, pass through silently.
    // This is intentional: user decorators (e.g., @Injectable()) should
    // not trigger diagnostics from the macro system.
    return { macroName: "", args: [], identNode: undefined };
  }

  /**
   * Expand @derive decorator — unified handler for both code-gen derives
   * (Eq, Clone, TypeGuard, etc.) and typeclass auto-derivation (Show, Ord, Hash, etc.).
   *
   * Resolution order for each argument:
   *   1. Registered derive macro (code-gen derives like Eq, Clone, TypeGuard, Builder)
   *   2. Built-in typeclass derivation strategy (Show, Eq, Ord, Hash, Semigroup, Monoid, Functor)
   *   3. Registered "{Name}TC" derive macro (typeclass derive macros)
   *   4. Error if none found
   *
   * This unifies the old @derive (code-gen) and @deriving (typeclass) into a single
   * decorator. Users write `@derive(Eq, Show, Clone, TypeGuard)` and the system
   * figures out the right strategy for each argument.
   */
  private expandDeriveDecorator(
    decorator: ts.Decorator,
    node: ts.Node,
    args: ts.Expression[],
  ): ts.Statement[] | undefined {
    if (
      !ts.isInterfaceDeclaration(node) &&
      !ts.isClassDeclaration(node) &&
      !ts.isTypeAliasDeclaration(node)
    ) {
      this.ctx.reportError(
        decorator,
        "@derive can only be applied to interfaces, classes, or type aliases",
      );
      return undefined;
    }

    const statements: ts.Statement[] = [];
    const typeInfo = this.extractTypeInfo(node);
    const typeName = node.name?.text ?? "Anonymous";

    for (const arg of args) {
      if (!ts.isIdentifier(arg)) {
        this.ctx.reportError(arg, "derive arguments must be identifiers");
        continue;
      }

      const deriveName = arg.text;

      // 1. Check for a registered derive macro (code-gen derives)
      const deriveMacro = globalRegistry.getDerive(deriveName);
      if (deriveMacro) {
        if (this.verbose) {
          console.log(`[typemacro] Expanding derive macro: ${deriveName}`);
        }

        // Check disk cache for cacheable derive macros
        const deriveCacheable = this.isMacroCacheable(deriveMacro);
        const deriveCacheKey = deriveCacheable
          ? this.computeCallSiteCacheKey(deriveName, arg, [])
          : undefined;

        if (deriveCacheKey) {
          const cachedStmts = this.getCachedStatements(deriveCacheKey);
          if (cachedStmts) {
            if (this.verbose) {
              console.log(
                `[typemacro] Cache hit for derive macro: ${deriveName}`,
              );
            }
            statements.push(...cachedStmts);
            continue;
          }
        }

        try {
          const result = this.ctx.hygiene.withScope(() =>
            deriveMacro.expand(this.ctx, node, typeInfo),
          );
          statements.push(...result);

          if (deriveCacheKey) {
            this.cacheStatements(deriveCacheKey, result);
          }
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
            `[typemacro] Auto-deriving typeclass instance: ${deriveName} for ${typeName}`,
          );
        }
        try {
          let code: string;

          // Check for sum type (discriminated union)
          if (ts.isTypeAliasDeclaration(node)) {
            const sumInfo = tryExtractSumType(this.ctx, node);
            if (sumInfo) {
              code = typeclassDerivation.deriveSum(
                typeName,
                sumInfo.discriminant,
                sumInfo.variants,
              );
            } else {
              code = typeclassDerivation.deriveProduct(
                typeName,
                typeInfo.fields,
              );
            }
          } else {
            code = typeclassDerivation.deriveProduct(typeName, typeInfo.fields);
          }

          statements.push(...this.ctx.parseStatements(code));

          // Register in compile-time instance registry
          const uncap =
            deriveName.charAt(0).toLowerCase() + deriveName.slice(1);
          instanceRegistry.push({
            typeclassName: deriveName,
            forType: typeName,
            instanceName: instanceVarName(uncap, typeName),
            derived: true,
          });

          // Register extension methods for this type+typeclass
          registerExtensionMethods(typeName, deriveName);
        } catch (error) {
          this.ctx.reportError(
            arg,
            `Typeclass auto-derivation failed for ${deriveName}: ${error}`,
          );
        }
        continue;
      }

      // 3. Check for a "{Name}TC" derive macro (typeclass derive macros)
      const tcDeriveMacro = globalRegistry.getDerive(`${deriveName}TC`);
      if (tcDeriveMacro) {
        if (this.verbose) {
          console.log(
            `[typemacro] Expanding typeclass derive macro: ${deriveName}TC`,
          );
        }
        try {
          const result = this.ctx.hygiene.withScope(() =>
            tcDeriveMacro.expand(this.ctx, node, typeInfo),
          );
          statements.push(...result);
        } catch (error) {
          this.ctx.reportError(
            arg,
            `Typeclass derive macro expansion failed: ${error}`,
          );
        }
        continue;
      }

      // 4. Nothing found
      this.ctx.reportError(
        arg,
        `Unknown derive: '${deriveName}'. ` +
          `Not a registered derive macro, typeclass with auto-derivation, ` +
          `or typeclass derive macro ('${deriveName}TC').`,
      );
    }

    return statements.length > 0 ? statements : undefined;
  }

  /**
   * Extract type information for derive macros.
   *
   * All type checker calls are wrapped in try-catch because they can throw
   * on malformed, recursive, or complex generic types.
   */
  private extractTypeInfo(
    node:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
  ): DeriveTypeInfo {
    const name = node.name?.text ?? "Anonymous";
    const typeParameters = node.typeParameters
      ? Array.from(node.typeParameters)
      : [];

    let type: ts.Type;
    try {
      type = this.ctx.typeChecker.getTypeAtLocation(node);
    } catch {
      // Return minimal info if type resolution fails entirely
      return {
        name,
        fields: [],
        typeParameters,
        type: undefined as unknown as ts.Type,
        kind: "product",
      };
    }

    // Check if this is a sum type (discriminated union)
    if (ts.isTypeAliasDeclaration(node)) {
      const sumInfo = tryExtractSumType(this.ctx, node);
      if (sumInfo) {
        return this.extractSumTypeInfo(
          node,
          name,
          typeParameters,
          type,
          sumInfo,
        );
      }
    }

    // Check if this is a primitive type alias
    if (ts.isTypeAliasDeclaration(node) && this.isPrimitiveType(type)) {
      return {
        name,
        fields: [],
        typeParameters,
        type,
        kind: "primitive",
      };
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
        propType = type; // fallback
        propTypeString = "unknown";
      }

      // Check for recursive reference
      if (propTypeString === name || propTypeString.includes(`${name}<`)) {
        isRecursive = true;
      }

      const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const readonly =
        ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
          ? (decl.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
            ) ?? false)
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

  /**
   * Extract type information for a sum type (discriminated union).
   */
  private extractSumTypeInfo(
    node: ts.TypeAliasDeclaration,
    name: string,
    typeParameters: ts.TypeParameterDeclaration[],
    type: ts.Type,
    sumInfo: {
      discriminant: string;
      variants: Array<{ tag: string; typeName: string }>;
    },
  ): DeriveTypeInfo {
    const variants: DeriveVariantInfo[] = [];
    let isRecursive = false;

    // For each variant, extract its fields (excluding the discriminant)
    if (ts.isUnionTypeNode(node.type)) {
      for (const member of node.type.types) {
        if (!ts.isTypeReferenceNode(member)) continue;

        const typeName = member.typeName.getText();
        const variantInfo = sumInfo.variants.find(
          (v) => v.typeName === typeName,
        );
        if (!variantInfo) continue;

        const memberType = this.ctx.typeChecker.getTypeFromTypeNode(member);
        const fields: DeriveFieldInfo[] = [];

        try {
          const props = this.ctx.typeChecker.getPropertiesOfType(memberType);
          for (const prop of props) {
            // Skip the discriminant field
            if (prop.name === sumInfo.discriminant) continue;

            const declarations = prop.getDeclarations();
            if (!declarations || declarations.length === 0) continue;

            const decl = declarations[0];
            let propType: ts.Type;
            let propTypeString: string;
            try {
              propType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(
                prop,
                decl,
              );
              propTypeString = this.ctx.typeChecker.typeToString(propType);
            } catch {
              propType = memberType;
              propTypeString = "unknown";
            }

            // Check for recursive reference
            if (
              propTypeString === name ||
              propTypeString.includes(`${name}<`)
            ) {
              isRecursive = true;
            }

            const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
            const readonly =
              ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
                ? (decl.modifiers?.some(
                    (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
                  ) ?? false)
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
          // Skip this variant if we can't get its properties
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
      fields: [], // Sum types don't have top-level fields
      typeParameters,
      type,
      kind: "sum",
      variants,
      discriminant: sumInfo.discriminant,
      isRecursive,
    };
  }

  /**
   * Check if a type is a primitive type (number, string, boolean, etc.)
   */
  private isPrimitiveType(type: ts.Type): boolean {
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
   * Try to expand a tagged template expression
   */
  private tryExpandTaggedTemplate(
    node: ts.TaggedTemplateExpression,
  ): ts.Expression | undefined {
    if (!ts.isIdentifier(node.tag)) return undefined;

    const tagName = node.tag.text;

    // First check the dedicated tagged template registry -- resolve through imports
    const taggedMacro = this.resolveMacroFromSymbol(
      node.tag,
      tagName,
      "tagged-template",
    ) as import("../core/types.js").TaggedTemplateMacroDef | undefined;
    if (taggedMacro) {
      if (this.verbose) {
        console.log(`[typemacro] Expanding tagged template macro: ${tagName}`);
      }

      // Check disk cache
      const cacheable = this.isMacroCacheable(taggedMacro);
      const cacheKey = cacheable
        ? this.computeCallSiteCacheKey(tagName, node, [node.template])
        : undefined;

      if (cacheKey) {
        const cached = this.getCachedExpression(cacheKey);
        if (cached) {
          if (this.verbose) {
            console.log(
              `[typemacro] Cache hit for tagged template: ${tagName}`,
            );
          }
          return ts.visitNode(cached, this.boundVisit) as ts.Expression;
        }
      }

      try {
        // Run validation if provided
        if (taggedMacro.validate && !taggedMacro.validate(this.ctx, node)) {
          this.ctx.reportError(
            node,
            `Tagged template validation failed for '${tagName}'`,
          );
          return this.createMacroErrorExpression(
            `typemacro: tagged template '${tagName}' validation failed`,
          );
        }

        const result = this.ctx.hygiene.withScope(() =>
          taggedMacro.expand(this.ctx, node),
        );

        if (cacheKey) {
          this.cacheExpression(cacheKey, result);
        }

        return ts.visitNode(result, this.boundVisit) as ts.Expression;
      } catch (error) {
        this.ctx.reportError(
          node,
          `Tagged template macro expansion failed: ${error}`,
        );
        return this.createMacroErrorExpression(
          `typemacro: tagged template '${tagName}' expansion failed: ${error}`,
        );
      }
    }

    // Fall back to expression macros for backward compatibility
    const exprMacro = this.resolveMacroFromSymbol(
      node.tag,
      tagName,
      "expression",
    ) as ExpressionMacro | undefined;
    if (!exprMacro) return undefined;

    if (this.verbose) {
      console.log(
        `[typemacro] Expanding tagged template via expression macro: ${tagName}`,
      );
    }

    try {
      const result = this.ctx.hygiene.withScope(() =>
        exprMacro.expand(this.ctx, node as unknown as ts.CallExpression, [
          node.template as unknown as ts.Expression,
        ]),
      );
      return ts.visitNode(result, this.boundVisit) as ts.Expression;
    } catch (error) {
      this.ctx.reportError(
        node,
        `Tagged template macro expansion failed: ${error}`,
      );
      return this.createMacroErrorExpression(
        `typemacro: tagged template '${tagName}' expansion failed: ${error}`,
      );
    }
  }

  /**
   * Try to expand a type macro (type-level macros like Add<3, 4>)
   */
  private tryExpandTypeMacro(
    node: ts.TypeReferenceNode,
  ): ts.TypeNode | undefined {
    let macroName: string | undefined;
    let identNode: ts.Node | undefined;

    if (ts.isIdentifier(node.typeName)) {
      macroName = node.typeName.text;
      identNode = node.typeName;
    } else if (ts.isQualifiedName(node.typeName)) {
      // Handle namespaced type macros like typemacro.Add
      if (
        ts.isIdentifier(node.typeName.left) &&
        node.typeName.left.text === "typemacro"
      ) {
        macroName = node.typeName.right.text;
        identNode = node.typeName;
      }
    }

    if (!macroName || !identNode) return undefined;

    const macro = this.resolveMacroFromSymbol(identNode, macroName, "type") as
      | import("../core/types.js").TypeMacro
      | undefined;
    if (!macro) return undefined;

    if (this.verbose) {
      console.log(`[typemacro] Expanding type macro: ${macroName}`);
    }

    const typeArgs = node.typeArguments ? Array.from(node.typeArguments) : [];

    // Check disk cache
    const cacheable = this.isMacroCacheable(macro);
    const cacheKey = cacheable
      ? this.computeCallSiteCacheKey(macroName, node, typeArgs)
      : undefined;

    if (cacheKey) {
      const cached = this.getCachedTypeNode(cacheKey);
      if (cached) {
        if (this.verbose) {
          console.log(`[typemacro] Cache hit for type macro: ${macroName}`);
        }
        return ts.visitNode(cached, this.boundVisit) as ts.TypeNode;
      }
    }

    try {
      const result = this.ctx.hygiene.withScope(() =>
        macro.expand(this.ctx, node, typeArgs),
      );

      if (cacheKey) {
        this.cacheExpression(cacheKey, result);
      }

      return ts.visitNode(result, this.boundVisit) as ts.TypeNode;
    } catch (error) {
      this.ctx.reportError(node, `Type macro expansion failed: ${error}`);
      return node;
    }
  }

  /**
   * Try to transform HKT declarations with F<_> kind syntax.
   *
   * Auto-detects interface/type declarations that use F<_> to denote
   * type constructor parameters, and transforms F<A> usages to $<F, A>.
   */
  private tryTransformHKTDeclaration(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  ): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
    // Check if any type parameter has kind annotation (F<_>)
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
      console.log(`[typemacro] Transforming HKT declaration: ${name}`);
    }

    try {
      const transformed = transformHKTDeclaration(this.ctx, node);
      // Visit the result to handle nested transformations
      return ts.visitEachChild(
        transformed,
        this.boundVisit,
        this.ctx.transformContext,
      ) as ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
    } catch (error) {
      this.ctx.reportError(node, `HKT transformation failed: ${error}`);
      return undefined;
    }
  }

  /**
   * Try to rewrite an implicit extension method call.
   *
   * Detects patterns like `x.show()` where `.show()` doesn't exist on x's
   * type but is provided by a typeclass extension method. Rewrites to:
   *   TC.summon<Type>("Type").method(x, ...args)
   *
   * This gives Scala 3-like implicit extension method syntax without
   * requiring an explicit `extend(x)` wrapper.
   */
  private tryRewriteExtensionMethod(
    node: ts.CallExpression,
  ): ts.Expression | undefined {
    const propAccess = node.expression as ts.PropertyAccessExpression;
    const methodName = propAccess.name.text;
    const receiver = propAccess.expression;

    // Skip if the receiver is itself a macro call (e.g., extend(x).show())
    // to avoid double-rewriting
    if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
      const calleeName = receiver.expression.text;
      const calleeMacro = this.resolveMacroFromSymbol(
        receiver.expression,
        calleeName,
        "expression",
      );
      if (calleeMacro) {
        return undefined;
      }
    }

    // Ask the type checker: does this property actually exist on the receiver?
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
      const potentialExt = this.resolveExtensionFromImports(
        node,
        methodName,
        receiverType,
      );
      if (potentialExt) {
        forceRewrite = true;
      }
    }

    if (existingProp && !forceRewrite) {
      // Property exists natively on the type -- not our business
      return undefined;
    }

    // Property doesn't exist. Resolve the type name and search extensions.
    const typeName = this.ctx.typeChecker.typeToString(receiverType);

    // Try exact type name match first
    let extension = findExtensionMethod(methodName, typeName);

    // Also try without generic parameters (e.g., "Point" from "Point<number>")
    if (!extension) {
      const baseTypeName = typeName.replace(/<.*>$/, "");
      if (baseTypeName !== typeName) {
        extension = findExtensionMethod(methodName, baseTypeName);
      }
    }

    // Try searching all typeclasses for this method name as a fallback
    // (handles cases where the type name in the registry differs slightly)
    if (!extension) {
      for (const [tcName, tcInfo] of typeclassRegistry) {
        const method = tcInfo.methods.find(
          (m) => m.name === methodName && m.isSelfMethod,
        );
        if (method) {
          // Found a typeclass with this method -- use it
          extension = {
            methodName,
            forType: typeName,
            typeclassName: tcName,
            isSelfMethod: true,
            extraParams: method.params.slice(1),
            returnType: method.returnType,
          };
          break;
        }
      }
    }

    if (!extension) {
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
        standaloneExt = this.resolveExtensionFromImports(
          node,
          methodName,
          receiverType,
        );
      }

      if (standaloneExt) {
        if (this.verbose) {
          const qual = standaloneExt.qualifier
            ? `${standaloneExt.qualifier}.${standaloneExt.methodName}`
            : standaloneExt.methodName;
          console.log(
            `[typemacro] Rewriting standalone extension: ${typeName}.${methodName}() → ${qual}(...)`,
          );
        }

        const rewritten = buildStandaloneExtensionCall(
          this.ctx.factory,
          standaloneExt,
          receiver,
          Array.from(node.arguments),
        );

        try {
          return ts.visitNode(rewritten, this.boundVisit) as ts.Expression;
        } catch (error) {
          this.ctx.reportError(
            node,
            `Standalone extension method rewrite failed: ${error}`,
          );
          return undefined;
        }
      }

      return undefined; // Not an extension method -- let TS report the error
    }

    if (this.verbose) {
      console.log(
        `[typemacro] Rewriting implicit extension: ${typeName}.${methodName}() → ${extension.typeclassName}.summon<${typeName}>("${typeName}").${methodName}(...)`,
      );
    }

    // Rewrite: x.method(args...) → TC.summon<Type>("Type").method(x, args...)
    const factory = this.ctx.factory;

    // TC.summon
    const summonAccess = factory.createPropertyAccessExpression(
      factory.createIdentifier(extension.typeclassName),
      "summon",
    );

    // TC.summon<Type>("Type")
    const summonCall = factory.createCallExpression(
      summonAccess,
      [factory.createTypeReferenceNode(typeName)],
      [factory.createStringLiteral(typeName)],
    );

    // TC.summon<Type>("Type").method
    const methodAccess = factory.createPropertyAccessExpression(
      summonCall,
      methodName,
    );

    // TC.summon<Type>("Type").method(receiver, ...args)
    const allArgs: ts.Expression[] = [receiver, ...node.arguments];
    const rewritten = factory.createCallExpression(
      methodAccess,
      undefined,
      allArgs,
    );

    try {
      return ts.visitNode(rewritten, this.boundVisit) as ts.Expression;
    } catch (error) {
      this.ctx.reportError(node, `Extension method rewrite failed: ${error}`);
      return undefined;
    }
  }

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
   * Results are cached per (sourceFile, methodName, typeName) triple.
   */
  private resolveExtensionFromImports(
    node: ts.CallExpression,
    methodName: string,
    receiverType: ts.Type,
  ): StandaloneExtensionInfo | undefined {
    const sourceFile = node.getSourceFile() || this.ctx.sourceFile;
    if (!sourceFile) return undefined;

    // Cache lookup
    let methodCache = this.importExtensionCache.get(receiverType);
    if (!methodCache) {
      methodCache = new Map();
      this.importExtensionCache.set(receiverType, methodCache);
    }

    if (methodCache.has(methodName)) {
      return methodCache.get(methodName);
    }

    const result = this.scanImportsForExtension(
      sourceFile,
      methodName,
      receiverType,
    );
    methodCache.set(methodName, result);
    return result;
  }

  private scanImportsForExtension(
    sourceFile: ts.SourceFile,
    methodName: string,
    receiverType: ts.Type,
  ): StandaloneExtensionInfo | undefined {
    if (!sourceFile || !sourceFile.statements) return undefined;
    for (const stmt of sourceFile.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;

      const clause = stmt.importClause;
      if (!clause) continue;

      // Check named imports: import { NumberExt, clamp } from "..."
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          const result = this.checkImportedSymbolForExtension(
            spec.name,
            methodName,
            receiverType,
          );
          if (result) return result;
        }
      }

      // Check namespace import: import * as std from "..."
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const result = this.checkImportedSymbolForExtension(
          clause.namedBindings.name,
          methodName,
          receiverType,
        );
        if (result) return result;
      }

      // Check default import: import Foo from "..."
      if (clause.name) {
        const result = this.checkImportedSymbolForExtension(
          clause.name,
          methodName,
          receiverType,
        );
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
    receiverType: ts.Type,
  ): StandaloneExtensionInfo | undefined {
    const symbol = this.ctx.typeChecker.getSymbolAtLocation(ident);
    if (!symbol) return undefined;

    const identType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(
      symbol,
      ident,
    );

    // Case 1: bare function import — name matches methodName and first
    // param is assignable from the receiver type
    if (ident.text === methodName) {
      const callSigs = identType.getCallSignatures();
      for (const sig of callSigs) {
        const params = sig.getParameters();
        if (params.length === 0) continue;
        const firstParamType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(
          params[0],
          ident,
        );
        if (this.isTypeCompatible(receiverType, firstParamType)) {
          return { methodName, forType: "", qualifier: undefined };
        }
      }
    }

    // Case 2: namespace object — has a property named methodName that is
    // callable with first param assignable from the receiver type
    const prop = identType.getProperty(methodName);
    if (!prop) return undefined;

    const propType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(
      prop,
      ident,
    );
    const callSigs = propType.getCallSignatures();
    for (const sig of callSigs) {
      const params = sig.getParameters();
      if (params.length === 0) continue;
      const firstParamType = this.ctx.typeChecker.getTypeOfSymbolAtLocation(
        params[0],
        ident,
      );
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
   * Rewrite a binary expression using typeclass operator overloading.
   *
   * When a typeclass method is annotated with `& Op<"+">`, any usage of `+`
   * on types that have an instance of that typeclass gets rewritten to a
   * direct method call (or inlined for zero-cost).
   *
   * Example: `a + b` where `a: Point` and `Semigroup<Point>` exists with
   * `concat(a, b): A & Op<"+">` becomes `semigroupPoint.concat(a, b)`.
   */
  private tryRewriteTypeclassOperator(
    node: ts.BinaryExpression,
  ): ts.Expression | undefined {
    const opString = getOperatorString(node.operatorToken.kind);
    if (!opString) return undefined;

    const entries = getSyntaxForOperator(opString);
    if (!entries || entries.length === 0) return undefined;

    // Determine the type of the left operand
    const leftType = this.ctx.typeChecker.getTypeAtLocation(node.left);
    const typeName = this.ctx.typeChecker.typeToString(leftType);
    const baseTypeName = typeName.replace(/<.*>$/, "");

    // Find a matching typeclass instance among the entries for this operator
    let matchedEntry: { typeclass: string; method: string } | undefined;
    let matchedInstance:
      | { typeclassName: string; forType: string; instanceName: string }
      | undefined;

    for (const entry of entries) {
      const inst =
        findInstance(entry.typeclass, typeName) ??
        findInstance(entry.typeclass, baseTypeName);
      if (inst) {
        if (matchedEntry) {
          // Ambiguity: multiple typeclasses provide this operator for this type
          this.ctx.reportError(
            node,
            `Ambiguous operator '${opString}' for type '${typeName}': ` +
              `both ${matchedEntry.typeclass}.${matchedEntry.method} and ` +
              `${entry.typeclass}.${entry.method} apply. ` +
              `Use explicit method calls to disambiguate.`,
          );
          return undefined;
        }
        matchedEntry = entry;
        matchedInstance = inst;
      }
    }

    if (!matchedEntry || !matchedInstance) return undefined;

    if (this.verbose) {
      console.log(
        `[typemacro] Rewriting operator: ${typeName} ${opString} → ` +
          `${matchedEntry.typeclass}.${matchedEntry.method}()`,
      );
    }

    const factory = this.ctx.factory;
    const left = ts.visitNode(node.left, this.boundVisit) as ts.Expression;
    const right = ts.visitNode(node.right, this.boundVisit) as ts.Expression;

    // Try zero-cost inlining first: if we have the instance method's AST,
    // inline it directly instead of emitting a method call.
    const dictMethodMap = getInstanceMethods(matchedInstance.instanceName);
    if (dictMethodMap) {
      const dictMethod = dictMethodMap.methods.get(matchedEntry.method);
      if (dictMethod) {
        const inlined = this.inlineMethodForAutoSpec(dictMethod, [left, right]);
        if (inlined) {
          if (this.verbose) {
            console.log(
              `[typemacro] Inlined operator ${opString} via ${matchedEntry.typeclass}.${matchedEntry.method}`,
            );
          }
          return inlined;
        }
      }
    }

    // Fallback: emit instanceVar.method(left, right)
    const methodAccess = factory.createPropertyAccessExpression(
      factory.createIdentifier(matchedInstance.instanceName),
      matchedEntry.method,
    );
    const rewritten = factory.createCallExpression(methodAccess, undefined, [
      left,
      right,
    ]);

    try {
      return ts.visitNode(rewritten, this.boundVisit) as ts.Expression;
    } catch (error) {
      this.ctx.reportError(
        node,
        `Operator rewrite failed for '${opString}': ${error}`,
      );
      return undefined;
    }
  }

  /**
   * Create an expression that throws at runtime when a macro expansion fails.
   * This ensures failures are loud rather than silently producing broken output.
   */
  private createMacroErrorExpression(message: string): ts.Expression {
    const factory = this.ctx.factory;
    // Generates: (() => { throw new Error("message"); })()
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
              factory.createNewExpression(
                factory.createIdentifier("Error"),
                undefined,
                [factory.createStringLiteral(message)],
              ),
            ),
          ]),
        ),
      ),
      undefined,
      [],
    );
  }

  /**
   * Create a statement that throws at runtime when a macro expansion fails.
   */
  private createMacroErrorStatement(message: string): ts.Statement {
    const factory = this.ctx.factory;
    return factory.createThrowStatement(
      factory.createNewExpression(
        factory.createIdentifier("Error"),
        undefined,
        [factory.createStringLiteral(message)],
      ),
    );
  }

  /**
   * Update a node with new decorators
   */
  private updateDecorators(node: ts.Node, decorators: ts.Decorator[]): ts.Node {
    const modifiers = decorators.length > 0 ? decorators : undefined;
    const factory = this.ctx.factory;

    if (ts.isClassDeclaration(node)) {
      return factory.updateClassDeclaration(
        node,
        modifiers
          ? [
              ...modifiers,
              ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? []),
            ]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.name,
        node.typeParameters,
        node.heritageClauses,
        node.members,
      );
    }

    if (ts.isFunctionDeclaration(node)) {
      return factory.updateFunctionDeclaration(
        node,
        modifiers
          ? [
              ...modifiers,
              ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? []),
            ]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.asteriskToken,
        node.name,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body,
      );
    }

    if (ts.isMethodDeclaration(node)) {
      return factory.updateMethodDeclaration(
        node,
        modifiers
          ? [
              ...modifiers,
              ...(node.modifiers?.filter((m) => !ts.isDecorator(m)) ?? []),
            ]
          : node.modifiers?.filter((m) => !ts.isDecorator(m)),
        node.asteriskToken,
        node.name,
        node.questionToken,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body,
      );
    }

    // For interfaces, we can't have decorators in the output
    if (ts.isInterfaceDeclaration(node)) {
      return node;
    }

    return node;
  }
}

// Also export for programmatic use
export { MacroTransformer };
