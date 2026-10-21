/**
 * Macro Hygiene System
 *
 * Provides lexical hygiene for macro-generated identifiers, preventing
 * accidental name capture between macro expansions and user code.
 *
 * Inspired by: Racket's lexical hygiene, Scheme `syntax-rules`, Sweet.js
 *
 * Key concepts:
 * - Each macro expansion gets a unique scope ID
 * - Identifiers created within a scope are automatically mangled
 * - Nested macro expansions get nested scopes
 * - Unhygienic escapes are available for intentional capture
 *
 * @example
 * ```typescript
 * // Inside a macro's expand() function:
 * const hygiene = new HygieneContext();
 *
 * hygiene.withScope(() => {
 *   const temp = hygiene.createIdentifier("temp");
 *   // temp.text === "__typesugar_temp_s0_0__"
 *
 *   const sameTemp = hygiene.createIdentifier("temp");
 *   // sameTemp.text === "__typesugar_temp_s0_0__" (same scope, same name)
 * });
 *
 * // Unhygienic escape:
 * const userVisible = hygiene.createUnhygienicIdentifier("result");
 * // userVisible.text === "result" (exact name, no mangling)
 * ```
 *
 * ## Reference Hygiene (safeRef)
 *
 * Beyond introduced-name hygiene, macros also need "reference hygiene" — ensuring
 * that references to external symbols (like `Eq`, `Show`) resolve correctly even
 * when the user has shadowed those names.
 *
 * `FileBindingCache.safeRef()` provides three-tier resolution:
 * - Tier 0: Known JS globals (Error, Array, JSON, etc.) — always safe, O(1)
 * - Tier 1: File import map — reuse only a plain value import of the same
 *   export from the same module (type-only/default/namespace imports conflict)
 * - Tier 2: Bindings — any declaration, parameter or local ANYWHERE in the file
 *   (not just top level) is a conflict, since the emitted reference may land
 *   inside that scope
 *
 * If a conflict is detected, an aliased import is generated instead.
 *
 * @example
 * ```typescript
 * // User code: const Eq = 42;
 * // Macro needs to reference Eq from @typesugar/std
 *
 * const ref = cache.safeRef("Eq", "@typesugar/std");
 * // ref.text === "__Eq_ts0__" (conflict detected, alias generated)
 * // cache.getPendingImports() will include: import { Eq as __Eq_ts0__ } from "@typesugar/std"
 * ```
 */

import * as ts from "typescript";

// =============================================================================
// Known Globals (Tier 0)
// =============================================================================

/**
 * Known JavaScript/TypeScript global identifiers.
 *
 * `safeRef` returns these bare only when the file does not rebind the name
 * (imports and local bindings CAN shadow them: `import { Map } from
 * "immutable"`, `Request` from undici, a local `File`). `ensureImport` never
 * short-circuits on them, since it is always asked for a module's export.
 */
export const KNOWN_GLOBALS = new Set([
  // Built-in constructors
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "Array",
  "Object",
  "Function",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "Date",
  "RegExp",
  "Promise",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "FinalizationRegistry",
  "Proxy",
  "Reflect",
  // Typed arrays
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  // Global objects
  "JSON",
  "Math",
  "Intl",
  "Atomics",
  "console",
  // Global values
  "undefined",
  "NaN",
  "Infinity",
  "globalThis",
  // Browser globals (may not exist in Node, but can't be import-shadowed)
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "URL",
  "URLSearchParams",
  "FormData",
  "Blob",
  "File",
  "FileReader",
  "AbortController",
  "AbortSignal",
  // Timing
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "queueMicrotask",
  // Other common globals
  "structuredClone",
  "atob",
  "btoa",
  "TextEncoder",
  "TextDecoder",
  "Blob",
  "ImageData",
  "MessageChannel",
  "MessagePort",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  // Iterator/Generator
  "Iterator",
  "Generator",
  "GeneratorFunction",
  "AsyncGenerator",
  "AsyncGeneratorFunction",
  "AsyncFunction",
]);

// =============================================================================
// Pending Alias Entry
// =============================================================================

/**
 * Information about a pending aliased import to inject.
 */
export interface PendingAliasEntry {
  /** The original symbol name being imported */
  symbol: string;
  /** The module to import from */
  from: string;
  /** The generated alias name */
  alias: string;
}

// =============================================================================
// FileBindingCache
// =============================================================================

/**
 * How a local name is bound by an import in the file.
 *
 * Only a non-type `named` import whose imported name equals the local name
 * (`import { Eq } from "m"`) is a usable VALUE binding of the export `Eq`
 * from `m`. A type-only import is erased by every emitter, a default import
 * is a different export, and `import { X as Eq }` binds a different export —
 * reusing any of them bare would leave a dangling or wrong reference (deep
 * review core #15).
 */
export type ImportBindingKind = "named" | "type" | "default" | "namespace" | "import-equals";

/** One import-bound local name. */
export interface ImportBinding {
  /** Module specifier (empty for `import X = A.B` namespace aliases). */
  module: string;
  kind: ImportBindingKind;
  /** The export's name, for `named`/`type` imports (`Foo` in `{ Foo as Bar }`). */
  importedName?: string;
}

/**
 * Per-file cache of bindings for reference hygiene.
 *
 * Built lazily from source file imports and declarations, then shared across
 * all macro expansions in that file. Enables O(1) conflict detection without
 * TypeChecker involvement.
 *
 * Resolution shape (CLAUDE.md "Resolving things a macro just generated"):
 * the import/declaration tables are a scan of the pre-transform source,
 * which is correct here because they describe the USER's bindings; names this
 * pass itself binds (pending plain imports) are tracked in the live
 * `claimedNames` side-table, consulted by every later `ensureImport`/`safeRef`
 * in the same pass.
 *
 * `localDecls` deliberately holds every binding ANYWHERE in the file
 * (parameters, block locals, catch/loop variables, nested functions and
 * classes), not just top-level ones: an emitted bare reference can land in any
 * nested scope, and a same-named binding there would capture it (deep review
 * core #14). Over-aliasing is harmless; under-aliasing is a runtime bug.
 *
 * @example
 * ```typescript
 * const cache = new FileBindingCache(sourceFile);
 *
 * // Fast path: global or same-module import
 * cache.safeRef("Error", "@typesugar/std"); // returns bare "Error"
 * cache.safeRef("Eq", "@typesugar/std");    // returns bare "Eq" if imported from same module
 *
 * // Conflict path: user shadowed the name
 * // Given: const Eq = 42; in the file
 * cache.safeRef("Eq", "@typesugar/std");    // returns "__Eq_ts0__" and records pending import
 * ```
 */
export class FileBindingCache {
  /** localName -> moduleSpecifier for every import-bound name in the file (any kind) */
  readonly importMap: Map<string, string>;

  /** localName -> how it is imported (see {@link ImportBindingKind}) */
  readonly importBindings: Map<string, ImportBinding>;

  /**
   * Every non-import binding name anywhere in the file: declarations at any
   * depth, parameters, binding-pattern elements, catch clauses, nested
   * function/class names, namespaces, interfaces and type aliases.
   */
  readonly localDecls: Set<string>;

  /** Pending aliased imports to inject (deduped by symbol+module) */
  private pendingAliases = new Map<string, PendingAliasEntry>();

  /**
   * Names bound by pending PLAIN (non-aliased) imports this pass registered:
   * name -> `${symbol}\0${from}` key. Live same-pass state, so a second module
   * wanting the same bare name is aliased instead of binding it twice
   * (deep review core #26).
   */
  private claimedNames = new Map<string, string>();

  /** Counter for generating unique alias names */
  private aliasCounter = 0;

  /** Optional verbose logging */
  private verbose: boolean;

  /** Stats for instrumentation */
  private stats = { tier0: 0, tier1: 0, tier2: 0, conflicts: 0 };

  /**
   * Identifier cache to avoid repeated ts.factory.createIdentifier() allocations.
   * Key: `${symbol}\0${from}` for module-scoped refs, `${symbol}` for globals.
   * This is a performance optimization — createIdentifier() allocates a full AST node.
   */
  private identifierCache = new Map<string, ts.Identifier>();

  /**
   * Create a FileBindingCache by scanning a source file.
   *
   * @param sourceFile - The TypeScript source file to scan
   * @param verbose - Whether to log instrumentation info
   */
  constructor(sourceFile: ts.SourceFile, verbose = false) {
    this.verbose = verbose;
    this.importMap = new Map();
    this.importBindings = new Map();
    this.localDecls = new Set();

    const start = verbose ? performance.now() : 0;

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt)) {
        this.collectImportBindings(stmt);
      } else if (ts.isImportEqualsDeclaration(stmt)) {
        const ref = stmt.moduleReference;
        const module =
          ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)
            ? ref.expression.text
            : "";
        this.recordImport(stmt.name.text, { module, kind: "import-equals" });
      } else {
        this.collectAllBindings(stmt);
      }
    }

    if (verbose) {
      const elapsed = (performance.now() - start).toFixed(2);
      console.log(
        `[typesugar:hygiene] ${sourceFile.fileName}: cache built (${this.importMap.size} imports, ${this.localDecls.size} local decls, ${elapsed}ms)`
      );
    }
  }

  private recordImport(localName: string, binding: ImportBinding): void {
    this.importMap.set(localName, binding.module);
    this.importBindings.set(localName, binding);
  }

  /**
   * Collect import bindings from an import declaration.
   */
  private collectImportBindings(node: ts.ImportDeclaration): void {
    const moduleSpecifier = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) return;

    const moduleName = moduleSpecifier.text;
    const importClause = node.importClause;
    if (!importClause) return;
    const clauseTypeOnly = importClause.isTypeOnly;

    // Default import: import Foo from "module"
    if (importClause.name) {
      this.recordImport(importClause.name.text, {
        module: moduleName,
        kind: clauseTypeOnly ? "type" : "default",
        importedName: "default",
      });
    }

    if (importClause.namedBindings) {
      if (ts.isNamedImports(importClause.namedBindings)) {
        // Named imports: import { Foo, Bar as Baz, type Qux } from "module"
        for (const element of importClause.namedBindings.elements) {
          this.recordImport(element.name.text, {
            module: moduleName,
            kind: clauseTypeOnly || element.isTypeOnly ? "type" : "named",
            importedName: (element.propertyName ?? element.name).text,
          });
        }
      } else {
        // Namespace import: import * as ns from "module" — binds `ns`.
        this.recordImport(importClause.namedBindings.name.text, {
          module: moduleName,
          kind: clauseTypeOnly ? "type" : "namespace",
        });
      }
    }
  }

  /**
   * Collect every binding name in a (non-import) statement, at any depth.
   */
  private collectAllBindings(root: ts.Node): void {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
        // BindingElement names are collected by collectBindingName via their
        // parent pattern; also adding them here is harmless (Set).
        this.collectBindingName(node.name);
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node) ||
          ts.isClassExpression(node)) &&
        node.name
      ) {
        this.localDecls.add(node.name.text);
      } else if (
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isImportEqualsDeclaration(node)
      ) {
        this.localDecls.add(node.name.text);
      } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
        this.localDecls.add(node.name.text);
      } else if (ts.isImportClause(node) && node.name) {
        // Imports nested inside `declare module "x" { ... }` blocks.
        this.localDecls.add(node.name.text);
      } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
        this.localDecls.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  }

  /**
   * Collect names from a binding pattern (handles destructuring).
   */
  private collectBindingName(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      this.localDecls.add(name.text);
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        this.collectBindingName(element.name);
      }
    } else if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) {
          this.collectBindingName(element.name);
        }
      }
    }
  }

  /**
   * Whether `symbol` is already imported as a plain VALUE named import of the
   * export `symbol` from `from` (the only form a bare reference may reuse).
   */
  private isReusableImport(symbol: string, from: string): boolean {
    const b = this.importBindings.get(symbol);
    return b !== undefined && b.kind === "named" && b.module === from && b.importedName === symbol;
  }

  /**
   * Whether `name` is bound anywhere in the file — by an import of any form, a
   * declaration/parameter at any depth, or a plain import this pass already
   * registered. Used by `MacroContext.tryShortName` (deep review core #44).
   */
  isNameBound(name: string): boolean {
    return this.importMap.has(name) || this.localDecls.has(name) || this.claimedNames.has(name);
  }

  /**
   * Get a safe reference to an external symbol.
   *
   * Uses three-tier resolution:
   * - Tier 0: Known JS globals — always safe
   * - Tier 1: Check file import map — safe if from same module
   * - Tier 2: Check local declarations — conflict if declared
   *
   * @param symbol - The symbol name to reference (e.g., "Eq")
   * @param from - The module the symbol should come from (e.g., "@typesugar/std")
   * @returns An identifier — either bare (fast path) or aliased (conflict path)
   */
  safeRef(symbol: string, from: string): ts.Identifier {
    // Tier 0: a known global name the file does not rebind anywhere. Global
    // names ARE routinely shadowed (`import { Map } from "immutable"`, a local
    // `Request`), and then the bare name is not the global (deep review core #27).
    if (KNOWN_GLOBALS.has(symbol) && !this.isNameBound(symbol)) {
      this.stats.tier0++;
      // Cache globals by symbol only (module doesn't matter)
      let cached = this.identifierCache.get(symbol);
      if (!cached) {
        cached = ts.factory.createIdentifier(symbol);
        this.identifierCache.set(symbol, cached);
      }
      return cached;
    }

    // Cache key for non-globals includes the module
    const cacheKey = `${symbol}\0${from}`;

    // Tier 1: Check if the name is imported
    if (this.importMap.has(symbol)) {
      this.stats.tier1++;
      if (this.isReusableImport(symbol, from)) {
        // Same module — no conflict, use cache
        let cached = this.identifierCache.get(cacheKey);
        if (!cached) {
          cached = ts.factory.createIdentifier(symbol);
          this.identifierCache.set(cacheKey, cached);
        }
        return cached;
      }
      // Different module — conflict!
      this.stats.conflicts++;
      return this.getOrCreateAlias(symbol, from);
    }

    // Tier 2: Check if the name is bound anywhere in the file, or claimed by
    // a pending plain import of a DIFFERENT (symbol, from) this pass.
    const claimedBy = this.claimedNames.get(symbol);
    if (this.localDecls.has(symbol) || (claimedBy !== undefined && claimedBy !== cacheKey)) {
      this.stats.tier2++;
      this.stats.conflicts++;
      return this.getOrCreateAlias(symbol, from);
    }

    // Not in scope at all — bare identifier is safe, use cache
    // (Note: the caller may need to also ensure the import exists)
    this.stats.tier2++;
    let cached = this.identifierCache.get(cacheKey);
    if (!cached) {
      cached = ts.factory.createIdentifier(symbol);
      this.identifierCache.set(cacheKey, cached);
    }
    return cached;
  }

  /**
   * Like {@link safeRef}, but additionally GUARANTEES the symbol is imported
   * from `from`. Use this from expression macros that emit a reference to a
   * runtime symbol the source file may not already import (e.g. `MatchError`).
   *
   * `safeRef` only avoids name conflicts — in the common "not in scope" case it
   * returns a bare identifier and leaves importing to the caller. Expression
   * macros (which return an expression, not statements) have no way to inject an
   * import statement, so they need this to register a pending import.
   *
   * - Known global names get no special treatment: the caller wants the
   *   MODULE's export (e.g. a companion named `File`), so it is imported.
   * - Already imported as a plain value named import of `symbol` from the same
   *   module → bare identifier (reuse).
   * - Name already bound (an import of another module or kind — `import type`,
   *   default, namespace, `import =` — a declaration or parameter anywhere in
   *   the file, or a plain import of another module registered earlier this
   *   pass) → aliased import.
   * - Otherwise → registers a plain pending import (`import { symbol } from "from"`).
   */
  ensureImport(symbol: string, from: string): ts.Identifier {
    // No KNOWN_GLOBALS fast path: `ensureImport` is always asked for a MODULE's
    // export. A user companion named `File`/`Request`/`Worker` must be imported,
    // not silently resolved to the runtime global (deep review core #27).

    if (this.isReusableImport(symbol, from)) {
      // Already imported as a value, by name, from the same module — reuse it bare.
      return this.safeRef(symbol, from);
    }
    const key = `${symbol}\0${from}`;
    const claimedBy = this.claimedNames.get(symbol);
    if (
      this.importMap.has(symbol) ||
      this.localDecls.has(symbol) ||
      (claimedBy !== undefined && claimedBy !== key)
    ) {
      // Conflict: the name is already bound — by an import of another
      // module/kind/export, a declaration or parameter anywhere in the file,
      // or a plain import of a different module this pass registered. Alias it
      // (getOrCreateAlias also records the pending import).
      this.stats.conflicts++;
      return this.getOrCreateAlias(symbol, from);
    }

    // Not bound anywhere — register a plain (non-aliased) pending import.
    if (!this.pendingAliases.has(key)) {
      this.pendingAliases.set(key, { symbol, from, alias: symbol });
      this.claimedNames.set(symbol, key);
    }
    let cached = this.identifierCache.get(key);
    if (!cached) {
      cached = ts.factory.createIdentifier(symbol);
      this.identifierCache.set(key, cached);
    }
    return cached;
  }

  /**
   * The import registered this pass (by {@link ensureImport}) that binds
   * `localName`, if any: what a generated reference to `localName` will
   * refer to once the import is injected.
   */
  getPendingImport(localName: string): { symbol: string; from: string } | undefined {
    for (const entry of this.pendingAliases.values()) {
      if (entry.alias === localName) return { symbol: entry.symbol, from: entry.from };
    }
    return undefined;
  }

  /**
   * Get or create an aliased import for a conflicting symbol.
   * Deduped: same (symbol, from) pair reuses existing alias.
   */
  private getOrCreateAlias(symbol: string, from: string): ts.Identifier {
    const key = `${symbol}\0${from}`;
    let entry = this.pendingAliases.get(key);
    if (!entry) {
      entry = {
        symbol,
        from,
        alias: `__${symbol}_ts${this.aliasCounter++}__`,
      };
      this.pendingAliases.set(key, entry);
    }
    return ts.factory.createIdentifier(entry.alias);
  }

  /**
   * Get all pending aliased imports to inject into the file.
   * Groups by module for cleaner output.
   */
  getPendingImports(): ts.ImportDeclaration[] {
    if (this.pendingAliases.size === 0) return [];

    // Group by module
    const byModule = new Map<string, PendingAliasEntry[]>();
    for (const entry of this.pendingAliases.values()) {
      const list = byModule.get(entry.from) ?? [];
      list.push(entry);
      byModule.set(entry.from, list);
    }

    // Create import declarations
    const imports: ts.ImportDeclaration[] = [];
    for (const [moduleName, entries] of byModule) {
      const specifiers = entries.map((e) =>
        ts.factory.createImportSpecifier(
          false,
          // alias === symbol → plain `import { symbol }` (no `as`)
          e.alias === e.symbol ? undefined : ts.factory.createIdentifier(e.symbol),
          ts.factory.createIdentifier(e.alias)
        )
      );

      imports.push(
        ts.factory.createImportDeclaration(
          undefined,
          ts.factory.createImportClause(
            false,
            undefined,
            ts.factory.createNamedImports(specifiers)
          ),
          ts.factory.createStringLiteral(moduleName)
        )
      );
    }

    return imports;
  }

  /**
   * Check if there are any pending aliased imports.
   */
  hasPendingImports(): boolean {
    return this.pendingAliases.size > 0;
  }

  /**
   * Get stats for instrumentation.
   */
  getStats(): { tier0: number; tier1: number; tier2: number; conflicts: number } {
    return { ...this.stats };
  }

  /**
   * Log stats if verbose mode is enabled.
   */
  logStats(fileName: string): void {
    if (!this.verbose) return;
    const s = this.stats;
    const total = s.tier0 + s.tier1 + s.tier2;
    console.log(
      `[typesugar:hygiene] ${fileName}: ${total} safeRef calls ` +
        `(${s.tier0} tier0, ${s.tier1} tier1, ${s.tier2} tier2, ` +
        `${s.conflicts} conflicts, ${this.pendingAliases.size} aliases)`
    );
  }
}

// =============================================================================
// Hygiene Scope
// =============================================================================

/** A hygiene scope tracks identifiers created during a single macro expansion */
interface HygieneScope {
  /** Unique scope identifier */
  id: number;

  /** Parent scope (for nested macro expansions) */
  parent: HygieneScope | null;

  /**
   * Map from user-requested name to the mangled name.
   * Ensures the same logical name within a scope always gets the same mangled name.
   */
  nameMap: Map<string, string>;

  /** Counter for generating unique suffixes within this scope */
  counter: number;
}

// =============================================================================
// HygieneContext
// =============================================================================

/**
 * Manages macro hygiene across macro expansions.
 *
 * Create one per compilation (or per source file) and pass it to macro
 * expand functions via the MacroContext.
 */
export class HygieneContext {
  /** Global scope counter — increments for each new scope */
  private scopeCounter = 0;

  /** The currently active scope (null = top level, no hygiene) */
  private currentScope: HygieneScope | null = null;

  /** Global counter for unique names outside of scopes */
  private globalCounter = 0;

  /**
   * Create a new hygiene scope and execute the callback within it.
   * All identifiers created inside the callback are scoped together.
   *
   * @returns The return value of the callback
   */
  withScope<T>(fn: () => T): T {
    const scope: HygieneScope = {
      id: this.scopeCounter++,
      parent: this.currentScope,
      nameMap: new Map(),
      counter: 0,
    };

    const previousScope = this.currentScope;
    this.currentScope = scope;

    try {
      return fn();
    } finally {
      this.currentScope = previousScope;
    }
  }

  /**
   * Create a hygienic identifier. If called within a scope, the name is
   * mangled to prevent capture. The same name within the same scope always
   * returns the same mangled name.
   *
   * Outside a scope, behaves like generateUniqueName.
   */
  createIdentifier(name: string): ts.Identifier {
    const mangledName = this.mangleName(name);
    return ts.factory.createIdentifier(mangledName);
  }

  /**
   * Get the mangled name for a given name in the current scope.
   * Useful when you need the string but not the AST node.
   */
  mangleName(name: string): string {
    if (this.currentScope) {
      const existing = this.currentScope.nameMap.get(name);
      if (existing) return existing;

      const mangled = `__typesugar_${name}_s${this.currentScope.id}_${this.currentScope.counter++}__`;
      this.currentScope.nameMap.set(name, mangled);
      return mangled;
    }

    // No scope — generate a globally unique name
    return `__typesugar_${name}_${this.globalCounter++}__`;
  }

  /**
   * Mint a name that is fresh on EVERY call (never memoised), unlike
   * {@link mangleName}. Inside a scope it shares the scope's counter, outside
   * one the global counter, so it never collides with a mangled name either.
   * This is what `MacroContext.generateUniqueName` uses (deep review core #28).
   */
  freshName(prefix: string): string {
    if (this.currentScope) {
      return `__typesugar_${prefix}_s${this.currentScope.id}_${this.currentScope.counter++}__`;
    }
    return `__typesugar_${prefix}_${this.globalCounter++}__`;
  }

  /**
   * Create an unhygienic identifier — uses the exact name without mangling.
   * Use this when you intentionally want to introduce a name visible to user code.
   */
  createUnhygienicIdentifier(name: string): ts.Identifier {
    return ts.factory.createIdentifier(name);
  }

  /**
   * Check if we're currently inside a hygiene scope.
   */
  isInScope(): boolean {
    return this.currentScope !== null;
  }

  /**
   * Get the current scope depth (0 = top level).
   */
  getScopeDepth(): number {
    let depth = 0;
    let scope = this.currentScope;
    while (scope) {
      depth++;
      scope = scope.parent;
    }
    return depth;
  }

  /**
   * Check if a name has been introduced in the current scope.
   */
  isIntroducedInCurrentScope(name: string): boolean {
    if (!this.currentScope) return false;
    return this.currentScope.nameMap.has(name);
  }

  /**
   * Get all names introduced in the current scope.
   */
  getCurrentScopeNames(): ReadonlyMap<string, string> {
    if (!this.currentScope) return new Map();
    return this.currentScope.nameMap;
  }

  /**
   * Reset the hygiene context (for testing).
   */
  reset(): void {
    this.scopeCounter = 0;
    this.currentScope = null;
    this.globalCounter = 0;
  }
}

/**
 * Global hygiene context singleton.
 * Shared across all macro expansions within a compilation.
 */
export const globalHygiene = new HygieneContext();
