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
import { globalRegistry } from "./registry.js";

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
  /** Extension methods explicitly imported in this file */
  importedExtensions: Map<string, ScopedTypeclass>;
  /** Typeclasses defined in this file (via @typeclass) — always in scope */
  definedTypeclasses: Set<string>;
  /** Whether this file has a "use no typesugar" directive */
  optedOut: boolean;
  /** Specific features opted out of */
  optedOutFeatures: Set<string>;
  /** Whether this file has a "use extension" directive */
  hasUseExtension: boolean;
  /**
   * Typeclasses whose OPERATOR syntax (tier 3) is activated in this file, via a
   * side-effect import of a module carrying a `@syntax-operators <TC>` marker
   * (PEP-052). `a === b` only rewrites when its typeclass is in this set.
   * Operators imply methods, so an entry here is also added to
   * {@link activatedMethodSyntax}.
   */
  activatedOperatorSyntax: Set<string>;
  /**
   * Typeclasses whose METHOD syntax (tier 2) is activated in this file, via a
   * side-effect import of a module carrying a `@syntax-methods <TC>` (or the
   * louder `@syntax-operators <TC>`) marker (PEP-052). `a.eq(b)` only resolves
   * when its typeclass is in this set.
   */
  activatedMethodSyntax: Set<string>;
  /**
   * Labeled-block / trigger-label macros whose LABEL syntax is activated in
   * this file, via a side-effect import of a module carrying a
   * `@syntax-labels <macroName>` marker (PEP-052 Part 2). Keyed by MACRO name
   * (e.g. "letYield", "contract"), not label text, so one marker activates all
   * of a macro's label aliases (`let:`/`seq:`). A `let: { ... }` block only
   * expands when its macro is in this set.
   */
  activatedLabelSyntax: Set<string>;
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
        importedExtensions: new Map(),
        definedTypeclasses: new Set(),
        optedOut: false,
        optedOutFeatures: new Set(),
        hasUseExtension: false,
        activatedOperatorSyntax: new Set(),
        activatedMethodSyntax: new Set(),
        activatedLabelSyntax: new Set(),
      });
    }
    return this.fileScopes.get(fileName)!;
  }

  /**
   * Register a typeclass as defined in the current file.
   *
   * Typeclasses defined in a file are always in scope for that file,
   * regardless of resolution mode. You don't need to import what you define.
   */
  registerDefinedTypeclass(fileName: string, typeclassName: string): void {
    const scope = this.getScope(fileName);
    scope.definedTypeclasses.add(typeclassName);
  }

  /**
   * Activate operator syntax (tier 3) for a typeclass in a file (PEP-052).
   * Operators imply methods, so this also activates method syntax.
   */
  activateOperatorSyntax(fileName: string, typeclassName: string): void {
    const scope = this.getScope(fileName);
    scope.activatedOperatorSyntax.add(typeclassName);
    scope.activatedMethodSyntax.add(typeclassName);
  }

  /**
   * Activate method syntax (tier 2) for a typeclass in a file (PEP-052).
   */
  activateMethodSyntax(fileName: string, typeclassName: string): void {
    const scope = this.getScope(fileName);
    scope.activatedMethodSyntax.add(typeclassName);
  }

  /**
   * Activate label syntax for a labeled-block / trigger-label macro in a file
   * (PEP-052 Part 2). Keyed by macro name.
   */
  activateLabelSyntax(fileName: string, macroName: string): void {
    const scope = this.getScope(fileName);
    scope.activatedLabelSyntax.add(macroName);
  }

  /**
   * Whether a typeclass's operator syntax is activated in a file.
   * Respects file-level opt-out.
   */
  isOperatorSyntaxActivated(fileName: string, typeclassName: string): boolean {
    const scope = this.getScope(fileName);
    if (scope.optedOut) return false;
    return scope.activatedOperatorSyntax.has(typeclassName);
  }

  /**
   * Whether a typeclass's method syntax is activated in a file.
   * Respects file-level opt-out.
   */
  isMethodSyntaxActivated(fileName: string, typeclassName: string): boolean {
    const scope = this.getScope(fileName);
    if (scope.optedOut) return false;
    return scope.activatedMethodSyntax.has(typeclassName);
  }

  /**
   * Whether a labeled-block / trigger-label macro's label syntax is activated
   * in a file. Respects file-level opt-out.
   */
  isLabelSyntaxActivated(fileName: string, macroName: string): boolean {
    const scope = this.getScope(fileName);
    if (scope.optedOut) return false;
    return scope.activatedLabelSyntax.has(macroName);
  }

  /** Typeclasses defined in a file (via `@typeclass`) — always activated locally. */
  getDefinedTypeclasses(fileName: string): Set<string> {
    return this.getScope(fileName).definedTypeclasses;
  }

  /** All typeclasses with operator syntax activated in a file. */
  getActivatedOperatorSyntax(fileName: string): Set<string> {
    return this.getScope(fileName).activatedOperatorSyntax;
  }

  /** All typeclasses with method syntax activated in a file. */
  getActivatedMethodSyntax(fileName: string): Set<string> {
    return this.getScope(fileName).activatedMethodSyntax;
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
   * Set whether a file has "use extension" directive.
   * When set, all exports from this file are treated as extension methods.
   */
  setHasUseExtension(fileName: string, hasUseExtension: boolean): void {
    const scope = this.getScope(fileName);
    scope.hasUseExtension = hasUseExtension;
  }

  /**
   * Check if a file has "use extension" directive.
   */
  hasUseExtension(fileName: string): boolean {
    const scope = this.getScope(fileName);
    return scope.hasUseExtension;
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
}

/**
 * Global resolution scope tracker instance.
 */
export const globalResolutionScope = new ResolutionScopeTracker();

/**
 * Read PEP-052 syntax-activation markers from a module imported by a side-effect
 * (or any) import. A marker module is a tiny file whose first statement carries a
 * module-level JSDoc tag naming the typeclass it activates, e.g.:
 *
 * ```ts
 * // @typesugar/std/syntax/eq/ops
 * /** @syntax-operators Eq *\/
 * export {};
 * ```
 *
 * Returns the typeclass names activated for operator and method syntax, plus the
 * macro names activated for label syntax (`@syntax-labels <macroName>`). Requires
 * a `program` to resolve the module specifier to its source file; without one,
 * no markers are discovered (callers in registry-only paths pass none).
 */
interface SyntaxMarkers {
  operatorTCs: string[];
  methodTCs: string[];
  /** Macro names from `@syntax-labels <macroName>` tags (PEP-052 Part 2). */
  labelMacros: string[];
}

// Memoize marker results per resolved module SourceFile. Marker modules are
// program-stable, and importing a large barrel/.d.ts otherwise re-scans all its
// statements per importing file. Keyed by SourceFile (a WeakMap) so it invalidates
// automatically across watch/LSP program rebuilds.
const markerCache = new WeakMap<ts.SourceFile, SyntaxMarkers>();

function readSyntaxActivationMarkers(
  checker: ts.TypeChecker,
  moduleSpecifier: ts.Expression
): SyntaxMarkers {
  const empty: SyntaxMarkers = { operatorTCs: [], methodTCs: [], labelMacros: [] };

  // Resolve the imported module via the checker (respects the program's module
  // resolution — works for on-disk and virtual/in-memory hosts alike).
  const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
  const moduleFile = moduleSymbol?.declarations?.find((d): d is ts.SourceFile =>
    ts.isSourceFile(d)
  );
  if (!moduleFile) return empty;

  const cached = markerCache.get(moduleFile);
  if (cached) return cached;

  // The marker JSDoc is attached to an exported declaration in the module (a real
  // declaration rather than a bare `export {}`, so it survives `.d.ts` bundling).
  // Scan every top-level statement so we don't depend on declaration ordering in
  // the generated declaration file.
  const operatorTCs: string[] = [];
  const methodTCs: string[] = [];
  const labelMacros: string[] = [];
  for (const stmt of moduleFile.statements) {
    for (const tag of ts.getJSDocTags(stmt)) {
      const tagName = tag.tagName.text;
      if (
        tagName !== "syntax-operators" &&
        tagName !== "syntax-methods" &&
        tagName !== "syntax-labels"
      ) {
        continue;
      }
      const name =
        typeof tag.comment === "string"
          ? tag.comment.trim()
          : ts.getTextOfJSDocComment(tag.comment)?.trim();
      if (!name) continue;
      if (tagName === "syntax-operators") operatorTCs.push(name);
      else if (tagName === "syntax-methods") methodTCs.push(name);
      else labelMacros.push(name);
    }
  }
  const result: SyntaxMarkers = { operatorTCs, methodTCs, labelMacros };
  markerCache.set(moduleFile, result);
  return result;
}

/**
 * Parse imports from a source file and register them in the scope.
 *
 * When `program` is supplied, PEP-052 syntax-activation markers on imported
 * modules are discovered and recorded (operator/method syntax activation).
 */
export function scanImportsForScope(
  sourceFile: ts.SourceFile,
  tracker: ResolutionScopeTracker = globalResolutionScope,
  program?: ts.Program
): void {
  const fileName = sourceFile.fileName;

  // Clear existing scope for this file
  tracker.clearScope(fileName);

  // Imports are scanned from the program's copy of the file when available:
  // `sourceFile` may be a re-parsed copy that is not part of `program` (the
  // expression-comprehension preprocessor rewrites the text and the pipeline
  // re-parses it), and checker-based module resolution only works on nodes
  // that belong to the program. Preprocessing never touches imports, so the
  // program copy's import list is authoritative either way. When the file is
  // not in the program at all, checker resolution is guaranteed to fail —
  // skip it entirely (the syntaxModule text fallback below still applies).
  const programFile = program?.getSourceFile(fileName);
  const importScanFile = programFile ?? sourceFile;
  const checker = programFile ? program!.getTypeChecker() : undefined;

  // Resolution-free activation fallback: a registered macro's `syntaxModule`
  // names the module whose import activates its label syntax, so an import
  // specifier that exactly matches it states the user's intent without any
  // module resolution. This is what keeps label activation working in hosts
  // that cannot resolve modules (the playground's in-memory host, virtual
  // file names outside any node_modules tree). Checker-resolved markers
  // remain the general mechanism (they also cover re-exports and third-party
  // wrappers); this fallback only adds activations, never removes them.
  const syntaxModuleIndex = new Map<string, string[]>();
  for (const macro of globalRegistry.getAll()) {
    const syntaxModule = (macro as { syntaxModule?: string }).syntaxModule;
    if (!syntaxModule) continue;
    const names = syntaxModuleIndex.get(syntaxModule) ?? [];
    names.push(macro.name);
    syntaxModuleIndex.set(syntaxModule, names);
  }

  // Scan imports
  ts.forEachChild(importScanFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpecifier)) return;

      const moduleName = moduleSpecifier.text;

      // PEP-052: discover syntax-activation markers on the imported module.
      // This runs for every import — including side-effect imports
      // (`import "@typesugar/std/syntax/eq/ops"`), which have no import clause.
      if (checker) {
        const { operatorTCs, methodTCs, labelMacros } = readSyntaxActivationMarkers(
          checker,
          moduleSpecifier
        );
        for (const tc of operatorTCs) tracker.activateOperatorSyntax(fileName, tc);
        for (const tc of methodTCs) tracker.activateMethodSyntax(fileName, tc);
        for (const m of labelMacros) tracker.activateLabelSyntax(fileName, m);
      }
      const bySyntaxModule = syntaxModuleIndex.get(moduleName);
      if (bySyntaxModule) {
        for (const m of bySyntaxModule) tracker.activateLabelSyntax(fileName, m);
      }
    }
  });

  // PEP-052: pre-register typeclasses DEFINED in this file (interfaces carrying a
  // `@typeclass` JSDoc tag). A defined typeclass activates its own operator/method
  // syntax locally ("you don't import what you define"). Doing this in the pre-scan
  // (rather than waiting for the `@typeclass` macro to expand during the top-down
  // visit) makes activation independent of declaration order — an operator used
  // above its typeclass's declaration in the same file still activates.
  for (const stmt of sourceFile.statements) {
    // (a) `/** @typeclass */ interface Foo<A> { ... }`
    if (
      ts.isInterfaceDeclaration(stmt) &&
      ts.getJSDocTags(stmt).some((tag) => tag.tagName.text === "typeclass")
    ) {
      tracker.registerDefinedTypeclass(fileName, stmt.name.text);
      continue;
    }
    // (b) the call form `typeclass("Foo");` (used when the interface carries no
    // JSDoc tag) — register it here too so same-file activation doesn't depend on
    // the macro running during the top-down visit.
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      const call = stmt.expression;
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === "typeclass" &&
        call.arguments.length >= 1 &&
        ts.isStringLiteralLike(call.arguments[0])
      ) {
        tracker.registerDefinedTypeclass(fileName, call.arguments[0].text);
      }
    }
  }

  // Scan for directives at file level (top-level statements only)
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

        // "use extension" directive - marks all exports as extension methods
        if (text === "use extension") {
          tracker.setHasUseExtension(fileName, true);
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
