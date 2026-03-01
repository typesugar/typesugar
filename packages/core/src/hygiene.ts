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
 * - Tier 1: File import map — check if name is imported from the same module
 * - Tier 2: Local declarations — check if name is declared at file level
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
 * Known JavaScript/TypeScript global identifiers that cannot be shadowed by imports.
 * These are always safe to reference without aliasing.
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
 * Per-file cache of bindings for reference hygiene.
 *
 * Built lazily from source file imports and declarations, then shared across
 * all macro expansions in that file. Enables O(1) conflict detection without
 * TypeChecker involvement.
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
  /** localName -> moduleSpecifier for all named imports in the file */
  readonly importMap: Map<string, string>;

  /** Names declared at file top level (const, let, var, function, class, interface, type) */
  readonly localDecls: Set<string>;

  /** Pending aliased imports to inject (deduped by symbol+module) */
  private pendingAliases = new Map<string, PendingAliasEntry>();

  /** Counter for generating unique alias names */
  private aliasCounter = 0;

  /** Optional verbose logging */
  private verbose: boolean;

  /** Stats for instrumentation */
  private stats = { tier0: 0, tier1: 0, tier2: 0, conflicts: 0 };

  /**
   * Create a FileBindingCache by scanning a source file.
   *
   * @param sourceFile - The TypeScript source file to scan
   * @param verbose - Whether to log instrumentation info
   */
  constructor(sourceFile: ts.SourceFile, verbose = false) {
    this.verbose = verbose;
    this.importMap = new Map();
    this.localDecls = new Set();

    const start = verbose ? performance.now() : 0;

    // Single pass over statements to collect imports and declarations
    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt)) {
        this.collectImportBindings(stmt);
      } else {
        this.collectDeclarationBindings(stmt);
      }
    }

    if (verbose) {
      const elapsed = (performance.now() - start).toFixed(2);
      console.log(
        `[typesugar:hygiene] ${sourceFile.fileName}: cache built (${this.importMap.size} imports, ${this.localDecls.size} local decls, ${elapsed}ms)`
      );
    }
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

    // Default import: import Foo from "module"
    if (importClause.name) {
      this.importMap.set(importClause.name.text, moduleName);
    }

    // Named imports: import { Foo, Bar as Baz } from "module"
    if (importClause.namedBindings) {
      if (ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const localName = element.name.text;
          this.importMap.set(localName, moduleName);
        }
      }
      // Namespace import: import * as ns from "module"
      // We don't add individual names — the user accesses via ns.Foo
      // This means ns.Foo won't conflict with a local `Foo`
    }
  }

  /**
   * Collect declaration bindings from a top-level statement.
   */
  private collectDeclarationBindings(stmt: ts.Statement): void {
    // Variable declarations: const x = ..., let y = ..., var z = ...
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        this.collectBindingName(decl.name);
      }
      return;
    }

    // Function declarations: function foo() {}
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      this.localDecls.add(stmt.name.text);
      return;
    }

    // Class declarations: class Foo {}
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      this.localDecls.add(stmt.name.text);
      return;
    }

    // Interface declarations: interface Foo {}
    if (ts.isInterfaceDeclaration(stmt)) {
      this.localDecls.add(stmt.name.text);
      return;
    }

    // Type alias declarations: type Foo = ...
    if (ts.isTypeAliasDeclaration(stmt)) {
      this.localDecls.add(stmt.name.text);
      return;
    }

    // Enum declarations: enum Foo {}
    if (ts.isEnumDeclaration(stmt)) {
      this.localDecls.add(stmt.name.text);
      return;
    }

    // Module declarations: namespace Foo {}
    if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
      this.localDecls.add(stmt.name.text);
      return;
    }
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
    // Tier 0: Known globals cannot be shadowed by imports
    if (KNOWN_GLOBALS.has(symbol)) {
      this.stats.tier0++;
      return ts.factory.createIdentifier(symbol);
    }

    // Tier 1: Check if the name is imported
    const importedFrom = this.importMap.get(symbol);
    if (importedFrom !== undefined) {
      this.stats.tier1++;
      if (importedFrom === from) {
        // Same module — no conflict
        return ts.factory.createIdentifier(symbol);
      }
      // Different module — conflict!
      this.stats.conflicts++;
      return this.getOrCreateAlias(symbol, from);
    }

    // Tier 2: Check if the name is declared locally
    if (this.localDecls.has(symbol)) {
      this.stats.tier2++;
      this.stats.conflicts++;
      return this.getOrCreateAlias(symbol, from);
    }

    // Not in scope at all — bare identifier is safe
    // (Note: the caller may need to also ensure the import exists)
    this.stats.tier2++;
    return ts.factory.createIdentifier(symbol);
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
          ts.factory.createIdentifier(e.symbol),
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
