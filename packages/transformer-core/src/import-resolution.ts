/**
 * Import tracking, cleanup, and macro resolution from symbols.
 *
 * Functions for recording which imports resolve to macros,
 * cleaning up macro-only imports, resolving module specifiers,
 * and resolving symbols to macro definitions.
 */

import * as ts from "typescript";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  scanImportsForScope,
  globalResolutionScope,
  type StandaloneExtensionInfo,
} from "@typesugar/core";

// ---------------------------------------------------------------------------
// Import tracking
// ---------------------------------------------------------------------------

/**
 * Record that a symbol resolved to a macro, so its import specifier can be
 * removed after the visitor pass.
 */
export function recordMacroImport(
  macroImportSpecifiers: Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >,
  originalSymbol: ts.Symbol
): void {
  const declarations = originalSymbol.getDeclarations();
  if (!declarations) return;

  for (const decl of declarations) {
    if (ts.isImportSpecifier(decl)) {
      const namedBindings = decl.parent;
      const importClause = namedBindings.parent;
      const importDecl = importClause.parent;
      if (ts.isImportDeclaration(importDecl)) {
        let set = macroImportSpecifiers.get(importDecl);
        if (!set) {
          set = new Set();
          macroImportSpecifiers.set(importDecl, set);
        }
        set.add(decl);
      }
      return;
    }

    if (ts.isNamespaceImport(decl)) {
      const importClause = decl.parent;
      const importDecl = importClause.parent;
      if (ts.isImportDeclaration(importDecl)) {
        let set = macroImportSpecifiers.get(importDecl);
        if (!set) {
          set = new Set();
          macroImportSpecifiers.set(importDecl, set);
        }
        set.add("namespace");
      }
      return;
    }

    if (ts.isImportClause(decl) && decl.name) {
      const importDecl = decl.parent;
      if (ts.isImportDeclaration(importDecl)) {
        let set = macroImportSpecifiers.get(importDecl);
        if (!set) {
          set = new Set();
          macroImportSpecifiers.set(importDecl, set);
        }
        set.add("default");
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Import cleanup
// ---------------------------------------------------------------------------

/**
 * Remove or trim import declarations whose specifiers resolved to macros.
 */
export function cleanupMacroImports(
  factory: ts.NodeFactory,
  macroImportSpecifiers: Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >,
  statements: ts.Statement[],
  verbose: boolean
): ts.Statement[] {
  if (macroImportSpecifiers.size === 0) return statements;

  const result: ts.Statement[] = [];

  for (const stmt of statements) {
    if (!ts.isImportDeclaration(stmt)) {
      result.push(stmt);
      continue;
    }

    const tracked = macroImportSpecifiers.get(stmt);
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
      if (verbose) {
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

    if (verbose) {
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
// Module specifier resolution
// ---------------------------------------------------------------------------

/**
 * Map a file path back to a module specifier like "typesugar" or "@typesugar/units".
 */
export function resolveModuleSpecifier(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, "/");

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

  const packagesMatch = normalized.match(/\/packages\/([a-z0-9-]+)\//);
  if (packagesMatch) {
    const pkgName = packagesMatch[1];
    if (pkgName === "typesugar") {
      return "typesugar";
    }
    return `@typesugar/${pkgName}`;
  }

  return undefined;
}

/**
 * Scan the source file's imports to find the module specifier for a name.
 */
export function findImportModuleForName(
  sourceFile: ts.SourceFile,
  name: string
): string | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const moduleSpecifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;

    const moduleName = moduleSpecifier.text;
    const importClause = stmt.importClause;
    if (!importClause) continue;

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        const localName = element.name.text;
        if (localName === name) {
          return moduleName;
        }
      }
    }
  }

  return undefined;
}

/**
 * Check if an imported module matches the macro's required module.
 */
export function moduleMatchesMacro(importedModule: string, macroModule: string): boolean {
  if (importedModule === macroModule) return true;

  const legacyAliases = ["typemacro", "ttfx", "macrots"];

  const aliases: Record<string, string[]> = {
    typesugar: legacyAliases,
    typemacro: ["typesugar", "ttfx", "macrots"],
  };

  const importAliases = aliases[importedModule];
  if (importAliases?.includes(macroModule)) return true;

  if (importedModule === "typesugar" && macroModule.startsWith("@typesugar/")) {
    return true;
  }

  if (macroModule === "typesugar" && importedModule.startsWith("@typesugar/")) {
    return true;
  }

  if (importedModule.startsWith("@typesugar/")) {
    const pkgName = importedModule.slice("@typesugar/".length);
    if (macroModule === pkgName || macroModule === `@typesugar/${pkgName}`) {
      return true;
    }
    if (legacyAliases.includes(macroModule)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Name-based macro lookup
// ---------------------------------------------------------------------------

/**
 * Fall back to name-based lookup for macros without module requirement.
 */
export function fallbackNameLookup(
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
 */
export function fallbackNameLookupWithImports(
  sourceFile: ts.SourceFile,
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

  if (!macro.module) {
    return macro;
  }

  const importedModule = findImportModuleForName(sourceFile, name);
  if (!importedModule) {
    return undefined;
  }

  if (moduleMatchesMacro(importedModule, macro.module)) {
    return macro;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Symbol-to-macro resolution
// ---------------------------------------------------------------------------

/**
 * Core symbol resolution: follow aliases to find the original declaration,
 * then check if it comes from a known macro module.
 */
export function resolveSymbolToMacro(
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbol: ts.Symbol,
  macroName: string,
  kind: MacroDefinition["kind"]
): MacroDefinition | undefined {
  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = typeChecker.getAliasedSymbol(resolved);
    } catch {
      // getAliasedSymbol can throw for unresolvable symbols
    }
  }

  const declarations = resolved.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }

  for (const decl of declarations) {
    const declSourceFile = decl.getSourceFile();
    const fileName = declSourceFile.fileName;

    const moduleSpecifier = resolveModuleSpecifier(fileName);
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

  const byLocalName = fallbackNameLookupWithImports(sourceFile, macroName, kind);
  if (byLocalName) return byLocalName;

  const originalName = resolved.name;
  if (originalName !== macroName) {
    const byOriginalName = fallbackNameLookupWithImports(sourceFile, originalName, kind);
    if (byOriginalName) return byOriginalName;
  }

  return undefined;
}

/**
 * Resolve an identifier to a macro definition via import tracking.
 */
export function resolveMacroFromSymbol(
  typeChecker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbolMacroCache: Map<number, MacroDefinition | null>,
  node: ts.Node,
  macroName: string,
  kind: MacroDefinition["kind"],
  onMacroImport?: (symbol: ts.Symbol) => void
): MacroDefinition | undefined {
  let symbol: ts.Symbol | undefined;
  try {
    symbol = typeChecker.getSymbolAtLocation(node);
  } catch {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }
  if (!symbol) {
    return fallbackNameLookupWithImports(sourceFile, macroName, kind);
  }

  const symbolId = (symbol as unknown as { id?: number }).id;
  if (symbolId !== undefined && symbolMacroCache.has(symbolId)) {
    return symbolMacroCache.get(symbolId) ?? undefined;
  }

  const result = resolveSymbolToMacro(typeChecker, sourceFile, symbol, macroName, kind);

  if (symbolId !== undefined) {
    symbolMacroCache.set(symbolId, result ?? null);
  }

  if (result && onMacroImport) {
    onMacroImport(symbol);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extension-related helpers
// ---------------------------------------------------------------------------

/**
 * Check if a declaration has the @extension decorator.
 */
export function hasExtensionDecorator(node: ts.Node): boolean {
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
 * Check if a symbol is extension-enabled.
 */
export function isExtensionEnabled(ctx: MacroContextImpl, symbol: ts.Symbol): boolean {
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) {
    return false;
  }

  for (const decl of declarations) {
    const sourceFile = decl.getSourceFile();
    const fileName = sourceFile.fileName;

    if (sourceFile.isDeclarationFile) {
      if (hasExtensionDecorator(decl)) {
        return true;
      }
      continue;
    }

    if (fileName !== ctx.sourceFile.fileName) {
      scanImportsForScope(sourceFile, globalResolutionScope);
    }

    if (globalResolutionScope.hasUseExtension(fileName)) {
      return true;
    }

    if (hasExtensionDecorator(decl)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an imported identifier provides an extension method.
 */
export function checkImportedSymbolForExtension(
  typeChecker: ts.TypeChecker,
  ident: ts.Identifier,
  methodName: string,
  receiverType: ts.Type
): StandaloneExtensionInfo | undefined {
  const symbol = typeChecker.getSymbolAtLocation(ident);
  if (!symbol) return undefined;

  const identType = typeChecker.getTypeOfSymbolAtLocation(symbol, ident);

  if (ident.text === methodName) {
    const callSigs = identType.getCallSignatures();
    for (const sig of callSigs) {
      const params = sig.getParameters();
      if (params.length === 0) continue;
      const firstParamType = typeChecker.getTypeOfSymbolAtLocation(params[0], ident);
      if (typeChecker.isTypeAssignableTo(receiverType, firstParamType)) {
        return { methodName, forType: "", qualifier: undefined };
      }
    }
  }

  const prop = identType.getProperty(methodName);
  if (!prop) return undefined;

  const propType = typeChecker.getTypeOfSymbolAtLocation(prop, ident);
  const callSigs = propType.getCallSignatures();
  for (const sig of callSigs) {
    const params = sig.getParameters();
    if (params.length === 0) continue;
    const firstParamType = typeChecker.getTypeOfSymbolAtLocation(params[0], ident);
    if (typeChecker.isTypeAssignableTo(receiverType, firstParamType)) {
      return { methodName, forType: "", qualifier: ident.text };
    }
  }

  return undefined;
}

/**
 * Scan imports for a matching extension method.
 * Collects all matching extensions for ambiguity detection.
 */
export function scanImportsForExtension(
  ctx: MacroContextImpl,
  sourceFile: ts.SourceFile,
  methodName: string,
  receiverType: ts.Type,
  node?: ts.Node
): StandaloneExtensionInfo | undefined {
  if (!sourceFile || !sourceFile.statements) {
    return undefined;
  }

  const matches: Array<{ ext: StandaloneExtensionInfo; importSource: string }> = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    const moduleSpecifier = stmt.moduleSpecifier;
    const importSource = ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : "unknown";

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        const result = checkImportedSymbolForExtension(
          ctx.typeChecker,
          spec.name,
          methodName,
          receiverType
        );
        if (result) {
          matches.push({ ext: result, importSource });
        }
      }
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const result = checkImportedSymbolForExtension(
        ctx.typeChecker,
        clause.namedBindings.name,
        methodName,
        receiverType
      );
      if (result) {
        matches.push({ ext: result, importSource });
      }
    }

    if (clause.name) {
      const result = checkImportedSymbolForExtension(
        ctx.typeChecker,
        clause.name,
        methodName,
        receiverType
      );
      if (result) {
        matches.push({ ext: result, importSource });
      }
    }
  }

  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length === 1) {
    return matches[0].ext;
  }

  const uniqueQualifiers = new Set(matches.map((m) => m.ext.qualifier ?? ""));
  if (uniqueQualifiers.size === 1) {
    return matches[0].ext;
  }

  const typeName = ctx.typeChecker.typeToString(receiverType);
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
    ctx.reportError(node, errorMessage);
  }

  return matches[0].ext;
}
