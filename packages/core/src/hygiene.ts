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
 */

import * as ts from "typescript";

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
