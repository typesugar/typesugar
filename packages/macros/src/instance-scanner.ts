/**
 * Instance Scanner — Scala 3-style typeclass instance discovery.
 *
 * Scans a module's exports for typeclass instances by detecting:
 * 1. `@impl("TC<Type>")` JSDoc tags (primary)
 * 2. Explicit type annotations matching `TC<Type>` (secondary fallback)
 *
 * This enables @derive and summon to resolve instances by searching imports
 * rather than relying on a central registry — any package can provide
 * instances that are discovered automatically if imported.
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { parseTypeInstantiation } from "@typesugar/core";

/**
 * Result of scanning a module export for typeclass instance information.
 */
export interface ScannedInstance {
  /** Typeclass name, e.g. "Ord" */
  typeclassName: string;
  /** The type this instance is for, e.g. "number" — display/diagnostic string */
  forTypeString: string;
  /** The resolved ts.Type for the instance's type parameter, if available */
  forType?: ts.Type;
  /** Export name of the instance variable */
  exportName: string;
  /** Resolved file path of the source module */
  sourceModule: string;
  /** How this instance was detected */
  detectedVia: "impl-tag" | "type-annotation";
}

/**
 * Scans module exports for typeclass instances.
 *
 * Caches results per resolved module path. Call `clearCache()` when the
 * compilation pipeline is invalidated (e.g., watch mode file change).
 */
export class InstanceScanner {
  private cache = new Map<string, ScannedInstance[]>();

  /**
   * Scan a module's exports for typeclass instances.
   *
   * @param typeChecker - The TypeScript type checker
   * @param moduleSymbol - The module's symbol (from typeChecker.getSymbolAtLocation on the module)
   * @param resolvedPath - Resolved file path of the module (used as cache key)
   * @returns Array of discovered instances
   */
  scanModule(
    typeChecker: ts.TypeChecker,
    moduleSymbol: ts.Symbol,
    resolvedPath: string
  ): ScannedInstance[] {
    const cached = this.cache.get(resolvedPath);
    if (cached) return cached;

    const results: ScannedInstance[] = [];

    let exports: ts.Symbol[];
    try {
      exports = typeChecker.getExportsOfModule(moduleSymbol);
    } catch {
      this.cache.set(resolvedPath, []);
      return [];
    }

    for (const sym of exports) {
      const instances = this.scanExport(typeChecker, sym, resolvedPath);
      results.push(...instances);
    }

    this.cache.set(resolvedPath, results);
    return results;
  }

  /**
   * Clear the scan cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Scan a single exported symbol for instance annotations.
   * Follows re-exports to find the original declaration with JSDoc tags.
   */
  private scanExport(
    typeChecker: ts.TypeChecker,
    sym: ts.Symbol,
    resolvedPath: string
  ): ScannedInstance[] {
    const results: ScannedInstance[] = [];
    const exportName = sym.getName();

    // Follow aliased symbols (re-exports) to their original declarations
    let resolvedSym = sym;
    if (resolvedSym.flags & ts.SymbolFlags.Alias) {
      try {
        resolvedSym = typeChecker.getAliasedSymbol(resolvedSym);
      } catch {
        // Can't resolve alias — use original symbol
      }
    }

    const declarations = resolvedSym.getDeclarations();
    if (!declarations || declarations.length === 0) return results;

    for (const decl of declarations) {
      results.push(...this.scanDeclaration(typeChecker, decl, exportName, resolvedPath));
    }

    return results;
  }

  /**
   * Extract instance info from a single declaration node (a variable declaration
   * or statement). Shared by the export-based scan ({@link scanExport}) and the
   * local-file scan ({@link scanLocalFile}), so non-exported instances are found
   * identically to exported ones.
   */
  private scanDeclaration(
    typeChecker: ts.TypeChecker,
    decl: ts.Node,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance[] {
    const results: ScannedInstance[] = [];

    // JSDoc attaches to the VariableStatement, not the VariableDeclaration.
    // Walk up if needed.
    const stmtNode =
      ts.isVariableDeclaration(decl) && decl.parent?.parent ? decl.parent.parent : decl;

    const varDecl = ts.isVariableDeclaration(decl)
      ? decl
      : ts.isVariableStatement(decl)
        ? decl.declarationList.declarations[0]
        : undefined;
    const typeResult = varDecl
      ? this.extractFromTypeAnnotation(typeChecker, varDecl, exportName, resolvedPath)
      : null;

    // Strategy 1: @impl/@instance JSDoc tag (takes precedence for the typeclass
    // name). When the tag's type string is a non-primitive whose forType can't be
    // resolved from the string alone (R2), borrow forType from the value's own
    // type annotation (`: Eq<Point>`), which the checker resolves reliably.
    const implResult = this.extractFromImplTag(typeChecker, stmtNode, exportName, resolvedPath);
    if (implResult) {
      // Only borrow forType from the annotation when it describes the SAME
      // typeclass — otherwise `@impl Foo<X>` on `const v: Bar<Y>` would fabricate
      // a `Foo<Y>` instance that was never declared.
      if (
        !implResult.forType &&
        typeResult?.forType &&
        typeResult.typeclassName === implResult.typeclassName
      ) {
        implResult.forType = typeResult.forType;
        implResult.forTypeString = typeResult.forTypeString;
      }
      results.push(implResult);
      return results; // @impl tag takes precedence
    }

    // Strategy 2: Type annotation on variable declaration
    if (typeResult) {
      results.push(typeResult);
    }

    return results;
  }

  /**
   * Scan a source file's TOP-LEVEL declarations for typeclass instances,
   * including **non-exported** ones. This is the local-scope path (PEP-052): a
   * `@impl`/`@instance` const declared in the using file is in scope for that
   * file whether or not it is exported, and must be discoverable without the
   * global registry. Order-independent (scans the whole file).
   *
   * Cached per resolved path (the same key space as {@link scanModule}, suffixed
   * to avoid collisions with the exports-only scan).
   */
  scanLocalFile(typeChecker: ts.TypeChecker, sourceFile: ts.SourceFile): ScannedInstance[] {
    const cacheKey = sourceFile.fileName + "::local";
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const results: ScannedInstance[] = [];
    for (const stmt of sourceFile.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const declaration of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        results.push(
          ...this.scanDeclaration(
            typeChecker,
            declaration,
            declaration.name.text,
            sourceFile.fileName
          )
        );
      }
    }

    this.cache.set(cacheKey, results);
    return results;
  }

  /**
   * Extract instance info from an @impl or @instance JSDoc tag.
   */
  private extractFromImplTag(
    typeChecker: ts.TypeChecker,
    node: ts.Node,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance | null {
    const tags = ts.getJSDocTags(node);
    for (const tag of tags) {
      const tagName = tag.tagName.text;
      if (tagName !== "impl" && tagName !== "instance") continue;

      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      if (!comment) continue;

      // Strip surrounding quotes: @impl("Ord<number>") → Ord<number>
      const text = comment.replace(/^["'()\s]+|["'()\s]+$/g, "").trim();
      const parsed = parseTypeInstantiation(text);
      if (!parsed) continue;

      return {
        typeclassName: parsed.base,
        forTypeString: parsed.args,
        forType: resolveTypeString(typeChecker, parsed.args),
        exportName,
        sourceModule: resolvedPath,
        detectedVia: "impl-tag",
      };
    }
    return null;
  }

  /**
   * Extract instance info from an explicit type annotation like `: Ord<number>`.
   */
  private extractFromTypeAnnotation(
    typeChecker: ts.TypeChecker,
    decl: ts.VariableDeclaration,
    exportName: string,
    resolvedPath: string
  ): ScannedInstance | null {
    if (!decl.type) return null;

    const typeNode = decl.type;
    if (!ts.isTypeReferenceNode(typeNode)) return null;

    const typeName = typeNode.typeName;
    if (!ts.isIdentifier(typeName)) return null;

    const typeArgs = typeNode.typeArguments;
    if (!typeArgs || typeArgs.length !== 1) return null;

    const tcName = typeName.text;
    // Must look like a typeclass name (PascalCase)
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(tcName)) return null;

    let resolvedType: ts.Type | undefined;
    let forTypeStr: string;
    try {
      resolvedType = typeChecker.getTypeFromTypeNode(typeArgs[0]);
      forTypeStr = typeChecker.typeToString(resolvedType);
    } catch {
      forTypeStr = typeArgs[0].getText();
    }

    return {
      typeclassName: tcName,
      forTypeString: forTypeStr,
      forType: resolvedType,
      exportName,
      sourceModule: resolvedPath,
      detectedVia: "type-annotation",
    };
  }
}

// ============================================================================
// Type Resolution Helper
// ============================================================================

const KEYWORD_MAP: Record<string, ts.SyntaxKind> = {
  number: ts.SyntaxKind.NumberKeyword,
  string: ts.SyntaxKind.StringKeyword,
  boolean: ts.SyntaxKind.BooleanKeyword,
  bigint: ts.SyntaxKind.BigIntKeyword,
  symbol: ts.SyntaxKind.SymbolKeyword,
  undefined: ts.SyntaxKind.UndefinedKeyword,
  null: ts.SyntaxKind.NullKeyword,
  void: ts.SyntaxKind.VoidKeyword,
  never: ts.SyntaxKind.NeverKeyword,
  any: ts.SyntaxKind.AnyKeyword,
  unknown: ts.SyntaxKind.UnknownKeyword,
  object: ts.SyntaxKind.ObjectKeyword,
};

/**
 * Resolve a type name string (e.g., "number") into a ts.Type.
 * Returns undefined for complex types that can't be resolved without context.
 */
function resolveTypeString(typeChecker: ts.TypeChecker, typeString: string): ts.Type | undefined {
  const trimmed = typeString.trim();
  const keyword = KEYWORD_MAP[trimmed];
  if (keyword !== undefined) {
    // Use TypeChecker's internal intrinsic type getters when available.
    // Synthetic keyword nodes created via ts.factory aren't bound to a
    // source file and may resolve to `any` with some TypeChecker instances.
    const tc = typeChecker as any;
    const intrinsicGetters: Record<number, string> = {
      [ts.SyntaxKind.NumberKeyword]: "getNumberType",
      [ts.SyntaxKind.StringKeyword]: "getStringType",
      [ts.SyntaxKind.BooleanKeyword]: "getBooleanType",
      [ts.SyntaxKind.BigIntKeyword]: "getBigIntType",
      [ts.SyntaxKind.UndefinedKeyword]: "getUndefinedType",
      [ts.SyntaxKind.NullKeyword]: "getNullType",
      [ts.SyntaxKind.VoidKeyword]: "getVoidType",
      [ts.SyntaxKind.NeverKeyword]: "getNeverType",
      [ts.SyntaxKind.AnyKeyword]: "getAnyType",
    };
    const getter = intrinsicGetters[keyword];
    if (getter && typeof tc[getter] === "function") {
      try {
        return tc[getter]();
      } catch {
        /* fall through */
      }
    }
    // Fallback: try synthetic node (works in some TS host configurations)
    try {
      const node = ts.factory.createKeywordTypeNode(keyword as ts.KeywordTypeSyntaxKind);
      return typeChecker.getTypeFromTypeNode(node);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Default scanner instance for use across the pipeline. */
export const instanceScanner = new InstanceScanner();
