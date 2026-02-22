/**
 * Resolution Scope Tracking
 *
 * Tracks which typeclasses and extensions are "in scope" for a given file,
 * based on imports and the configured resolution mode.
 *
 * In "import-scoped" mode, only imported typeclasses are resolved.
 * In "automatic" mode, all registered typeclasses plus prelude are available.
 * In "explicit" mode, no implicit resolution happens.
 */

import * as ts from "typescript";
import { config, ResolutionMode } from "./config.js";

/**
 * Information about an imported typeclass or extension.
 */
export interface ScopedTypeclass {
  /** The typeclass name (e.g., "Eq", "Ord") */
  name: string;
  /** The module it was imported from */
  module: string;
  /** Whether this is a re-export (indirect import) */
  isReexport?: boolean;
}

/**
 * Resolution scope for a single file.
 */
export interface FileResolutionScope {
  /** The file path */
  fileName: string;
  /** The resolution mode for this file */
  mode: ResolutionMode;
  /** Typeclasses explicitly imported in this file */
  importedTypeclasses: Map<string, ScopedTypeclass>;
  /** Extension methods explicitly imported in this file */
  importedExtensions: Map<string, ScopedTypeclass>;
  /** Whether this file has a "use no typesugar" directive */
  optedOut: boolean;
  /** Specific features opted out of */
  optedOutFeatures: Set<string>;
}

/**
 * Global scope tracker for all files being processed.
 */
export class ResolutionScopeTracker {
  private fileScopes = new Map<string, FileResolutionScope>();

  /**
   * Get or create a resolution scope for a file.
   */
  getScope(fileName: string): FileResolutionScope {
    if (!this.fileScopes.has(fileName)) {
      this.fileScopes.set(fileName, {
        fileName,
        mode: config.getResolutionModeForFile(fileName),
        importedTypeclasses: new Map(),
        importedExtensions: new Map(),
        optedOut: false,
        optedOutFeatures: new Set(),
      });
    }
    return this.fileScopes.get(fileName)!;
  }

  /**
   * Register an imported typeclass for a file.
   */
  registerImportedTypeclass(
    fileName: string,
    typeclassName: string,
    module: string,
    isReexport = false
  ): void {
    const scope = this.getScope(fileName);
    scope.importedTypeclasses.set(typeclassName, {
      name: typeclassName,
      module,
      isReexport,
    });
  }

  /**
   * Check if a typeclass is in scope for a file.
   */
  isTypeclassInScope(fileName: string, typeclassName: string): boolean {
    const scope = this.getScope(fileName);

    // Check for opt-out
    if (scope.optedOut) {
      return false;
    }

    // Mode-specific resolution
    switch (scope.mode) {
      case "automatic":
        // Everything is in scope in automatic mode
        return true;

      case "import-scoped":
        // Must be imported or in prelude
        return scope.importedTypeclasses.has(typeclassName) || config.isInPrelude(typeclassName);

      case "explicit":
        // Nothing is implicitly in scope
        return false;

      default:
        return true;
    }
  }

  /**
   * Set the opt-out status for a file.
   */
  setOptedOut(fileName: string, optedOut: boolean): void {
    const scope = this.getScope(fileName);
    scope.optedOut = optedOut;
  }

  /**
   * Add a specific feature to the opt-out list.
   */
  addOptedOutFeature(fileName: string, feature: string): void {
    const scope = this.getScope(fileName);
    scope.optedOutFeatures.add(feature);
  }

  /**
   * Check if a specific feature is opted out for a file.
   */
  isFeatureOptedOut(fileName: string, feature: string): boolean {
    const scope = this.getScope(fileName);
    return scope.optedOut || scope.optedOutFeatures.has(feature);
  }

  /**
   * Clear the scope for a file (e.g., when re-processing).
   */
  clearScope(fileName: string): void {
    this.fileScopes.delete(fileName);
  }

  /**
   * Clear all scopes.
   */
  reset(): void {
    this.fileScopes.clear();
  }

  /**
   * Get all in-scope typeclasses for a file.
   */
  getInScopeTypeclasses(fileName: string): string[] {
    const scope = this.getScope(fileName);

    if (scope.optedOut) {
      return [];
    }

    switch (scope.mode) {
      case "automatic":
        // Return prelude typeclasses
        return config.get<string[]>("resolution.prelude") ?? [];

      case "import-scoped":
        // Return imported + prelude
        const imported = Array.from(scope.importedTypeclasses.keys());
        const prelude = config.get<string[]>("resolution.prelude") ?? [];
        return [...new Set([...imported, ...prelude])];

      case "explicit":
        return [];

      default:
        return [];
    }
  }
}

/**
 * Global resolution scope tracker instance.
 */
export const globalResolutionScope = new ResolutionScopeTracker();

/**
 * Parse imports from a source file and register them in the scope.
 */
export function scanImportsForScope(
  sourceFile: ts.SourceFile,
  tracker: ResolutionScopeTracker = globalResolutionScope
): void {
  const fileName = sourceFile.fileName;

  // Clear existing scope for this file
  tracker.clearScope(fileName);

  // Known typeclass names (from @typesugar/std and common typeclasses)
  const knownTypeclasses = new Set([
    // Core typeclasses
    "Eq",
    "Ord",
    "Show",
    "Clone",
    "Debug",
    "Hash",
    "Default",
    "Semigroup",
    "Monoid",
    // FP typeclasses
    "Functor",
    "Applicative",
    "Monad",
    "FlatMap",
    "Foldable",
    "Traversable",
    // Collection typeclasses
    "IterableOnce",
    "Iterable",
    "Seq",
    "SetLike",
    "MapLike",
  ]);

  // Scan imports
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const moduleName = moduleSpecifier.text;
      const importClause = node.importClause;

      if (!importClause) return;

      // Named imports: import { Eq, Ord } from "@typesugar/std"
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        for (const element of importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          const localName = element.name.text;

          // Check if this is a known typeclass
          if (knownTypeclasses.has(importedName)) {
            tracker.registerImportedTypeclass(fileName, localName, moduleName);
          }
        }
      }

      // Namespace import: import * as std from "@typesugar/std"
      // In this case, all typeclasses from that module are potentially in scope
      if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
        // For namespace imports from typesugar packages, register all known typeclasses
        if (moduleName.startsWith("@typesugar/") || moduleName.startsWith("typesugar")) {
          for (const tc of knownTypeclasses) {
            tracker.registerImportedTypeclass(fileName, tc, moduleName, true);
          }
        }
      }
    }
  });

  // Scan for "use no typesugar" directive at file level (top-level statements only)
  for (const stmt of sourceFile.statements) {
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (ts.isStringLiteral(expr)) {
        const text = expr.text;

        // Full opt-out
        if (text === "use no typesugar") {
          tracker.setOptedOut(fileName, true);
          continue;
        }

        // Feature-specific opt-outs
        const featureMatch = text.match(/^use no typesugar (\w+)$/);
        if (featureMatch) {
          const feature = featureMatch[1];
          if (["operators", "derive", "extensions", "typeclasses", "macros"].includes(feature)) {
            tracker.addOptedOutFeature(fileName, feature);
          }
        }
      }
    }
  }
}

/**
 * Parse a single line for inline opt-out comments.
 * Supports: // @ts-no-typesugar, // @ts-no-typesugar operators, etc.
 */
export function hasInlineOptOut(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  feature?: string
): boolean {
  // Synthetic nodes (pos === -1) have no source position — no comment to check
  if (node.pos === -1) return false;

  const nodeStart = node.getStart(sourceFile);
  const lineStarts = sourceFile.getLineStarts();

  // Find the line this node is on
  let lineIndex = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i] <= nodeStart) {
      lineIndex = i;
    } else {
      break;
    }
  }

  const lineStart = lineStarts[lineIndex];
  const lineEnd =
    lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1] : sourceFile.getEnd();

  const lineText = sourceFile.text.slice(lineStart, lineEnd);

  // Check for inline opt-out comment
  if (feature) {
    return (
      lineText.includes(`@ts-no-typesugar ${feature}`) || lineText.includes("@ts-no-typesugar-all")
    );
  }

  return lineText.includes("@ts-no-typesugar");
}

/**
 * Check if a node is inside a function with "use no typesugar" directive.
 */
export function isInOptedOutScope(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  tracker: ResolutionScopeTracker = globalResolutionScope,
  feature?: string
): boolean {
  const fileName = sourceFile.fileName;
  const scope = tracker.getScope(fileName);

  // Check file-level opt-out
  if (scope.optedOut) {
    return true;
  }

  // Check feature-specific opt-out
  if (feature && scope.optedOutFeatures.has(feature)) {
    return true;
  }

  // Check inline opt-out comment on this line
  if (hasInlineOptOut(sourceFile, node, feature)) {
    return true;
  }

  // Check for function-scoped opt-out
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      // Check if the function body starts with "use no typesugar"
      const body = (current as { body?: ts.Node }).body;
      if (body && ts.isBlock(body)) {
        const firstStatement = body.statements[0];
        if (firstStatement && ts.isExpressionStatement(firstStatement)) {
          const expr = firstStatement.expression;
          if (ts.isStringLiteral(expr)) {
            const text = expr.text;
            if (text === "use no typesugar") {
              return true;
            }
            if (feature && text === `use no typesugar ${feature}`) {
              return true;
            }
          }
        }
      }
    }
    current = current.parent;
  }

  return false;
}
