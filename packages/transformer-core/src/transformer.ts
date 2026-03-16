/**
 * @typesugar/transformer-core - MacroTransformer class
 *
 * This is the core macro expansion class extracted from @typesugar/transformer
 * for browser compatibility. It has ZERO Node.js dependencies.
 *
 * Implementation is split across focused modules:
 *   - transformer-utils.ts: pure utility functions
 *   - import-resolution.ts: import tracking, cleanup, and macro resolution
 *   - specialization.ts: auto-specialization and return-type specialization
 *   - macro-helpers.ts: JSDoc macros, decorator parsing/sorting, derives
 *   - rewriting.ts: extension methods, operators, HKT, tagged templates
 */

import * as ts from "typescript";

import {
  hasImplicitParams,
  transformImplicitsCall,
  buildImplicitScopeFromDecl,
  SpecializationCache,
  type ImplicitScope,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  type StandaloneExtensionInfo,
  ExpressionMacro,
  AttributeMacro,
  globalResolutionScope,
  isInOptedOutScope,
  preserveSourceMap,
  ExpansionTracker,
  MacroExpansionCache,
} from "@typesugar/core";

import {
  createMacroErrorExpression as createMacroErrorExpr,
  createMacroErrorStatement as createMacroErrorStmt,
  updateNodeDecorators,
} from "./transformer-utils.js";

import {
  recordMacroImport,
  cleanupMacroImports,
  resolveModuleSpecifier,
  findImportModuleForName,
  moduleMatchesMacro,
  fallbackNameLookup,
  fallbackNameLookupWithImports,
  resolveSymbolToMacro,
  resolveMacroFromSymbol as resolveMacroFromSymbolFn,
  scanImportsForExtension,
} from "./import-resolution.js";

import {
  tryAutoSpecialize as tryAutoSpecializeFn,
  tryReturnTypeDrivenSpecialize as tryReturnTypeDrivenSpecializeFn,
} from "./specialization.js";

import {
  hasJSDocMacroTags as hasJSDocMacroTagsFn,
  tryExpandJSDocMacros as tryExpandJSDocMacrosFn,
  parseDecorator,
  sortDecoratorsByDependency,
  expandDeriveDecorator as expandDeriveDecoratorFn,
  extractTypeInfo,
} from "./macro-helpers.js";

import {
  tryExpandTaggedTemplate as tryExpandTaggedTemplateFn,
  tryExpandTypeMacro as tryExpandTypeMacroFn,
  tryRewriteSpecializeExtension as tryRewriteSpecializeExtensionFn,
  tryRewriteExtensionMethod as tryRewriteExtensionMethodFn,
  tryTransformHKTDeclaration as tryTransformHKTDeclarationFn,
  tryRewriteTypeclassOperator as tryRewriteTypeclassOperatorFn,
} from "./rewriting.js";

class MacroTransformer {
  private additionalStatements: ts.Statement[] = [];

  private symbolMacroCache = new Map<number, MacroDefinition | null>();

  private macroImportSpecifiers = new Map<
    ts.ImportDeclaration,
    Set<ts.ImportSpecifier | "namespace" | "default">
  >();

  private importExtensionCache = new Map<
    ts.Type,
    Map<string, StandaloneExtensionInfo | undefined>
  >();

  private implicitScopeStack: ImplicitScope[] = [];

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

  private isMacroCacheable(macro: MacroDefinition): boolean {
    return macro.cacheable !== false;
  }

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

  private cacheExpression(cacheKey: string, result: ts.Node): void {
    if (!this.expansionCache) return;
    const printed = this.printNodeSafe(result);
    if (printed) {
      this.expansionCache.set(cacheKey, printed);
    }
  }

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

  private getCurrentImplicitScope(): ImplicitScope | undefined {
    if (this.implicitScopeStack.length === 0) return undefined;

    const combined = new Map<string, string>();
    for (const scope of this.implicitScopeStack) {
      for (const [key, value] of scope.available) {
        combined.set(key, value);
      }
    }

    return { available: combined };
  }

  private visitImplicitParamsFunction(node: ts.FunctionLikeDeclaration): ts.Node | ts.Node[] {
    if (this.verbose) {
      const name =
        ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
          ? (node.name as ts.Identifier | undefined)?.text
          : undefined;
      console.log(`[typesugar] Entering function with implicit params: ${name ?? "(anonymous)"}`);
    }

    const scope = buildImplicitScopeFromDecl(node);
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

  private tryTransformImplicitsCall(node: ts.CallExpression): ts.Expression | undefined {
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
  // Import tracking — delegates to import-resolution.ts
  // ---------------------------------------------------------------------------

  private recordMacroImport(originalSymbol: ts.Symbol): void {
    recordMacroImport(this.macroImportSpecifiers, originalSymbol);
  }

  // ---------------------------------------------------------------------------
  // Import-scoped macro resolution — delegates to import-resolution.ts
  // ---------------------------------------------------------------------------

  private resolveExtensionFromImports(
    node: ts.CallExpression,
    methodName: string,
    receiverType: ts.Type
  ): StandaloneExtensionInfo | undefined {
    const sourceFile = node.getSourceFile();

    let methodCache = this.importExtensionCache.get(receiverType);
    if (!methodCache) {
      methodCache = new Map();
      this.importExtensionCache.set(receiverType, methodCache);
    }

    if (methodCache.has(methodName)) {
      return methodCache.get(methodName);
    }

    const result = scanImportsForExtension(this.ctx, sourceFile, methodName, receiverType, node);
    methodCache.set(methodName, result);
    return result;
  }

  private resolveMacroFromSymbol(
    node: ts.Node,
    macroName: string,
    kind: MacroDefinition["kind"]
  ): MacroDefinition | undefined {
    return resolveMacroFromSymbolFn(
      this.ctx.typeChecker,
      this.ctx.sourceFile,
      this.symbolMacroCache,
      node,
      macroName,
      kind,
      (symbol) => this.recordMacroImport(symbol)
    );
  }

  // ---------------------------------------------------------------------------
  // Main visitor
  // ---------------------------------------------------------------------------

  visit(node: ts.Node): ts.Node | ts.Node[] {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
    }

    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)) &&
      hasImplicitParams(node)
    ) {
      return this.visitImplicitParamsFunction(node);
    }

    const transformed = this.tryTransform(node);
    if (transformed !== undefined) {
      return transformed;
    }

    return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
  }

  private visitStatementContainer(
    node: ts.SourceFile | ts.Block | ts.ModuleBlock
  ): ts.SourceFile | ts.Block | ts.ModuleBlock {
    const statements = Array.from(node.statements);
    const newStatements: ts.Statement[] = [];
    let modified = false;

    const prevSpecCache = this.specCache;
    this.specCache = new SpecializationCache();

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      if (ts.isLabeledStatement(stmt)) {
        const labelName = stmt.label.text;
        const macro = globalRegistry.getLabeledBlock(labelName);

        if (macro) {
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
              createMacroErrorStmt(
                this.ctx.factory,
                `typesugar: labeled block '${labelName}:' expansion failed: ${error}`
              )
            );
          }

          modified = true;
          continue;
        }
      }

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

    let cleanedStatements = ts.isSourceFile(node)
      ? cleanupMacroImports(
          this.ctx.factory,
          this.macroImportSpecifiers,
          newStatements,
          this.verbose
        )
      : newStatements;

    if (ts.isSourceFile(node)) {
      const pendingImports = this.ctx.fileBindingCache.getPendingImports();
      const hoistedDecls = this.specCache.getHoistedDeclarations();

      if (pendingImports.length > 0 || hoistedDecls.length > 0) {
        let insertIndex = 0;
        for (let i = 0; i < cleanedStatements.length; i++) {
          if (ts.isImportDeclaration(cleanedStatements[i])) {
            insertIndex = i + 1;
          } else {
            break;
          }
        }

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

        this.ctx.fileBindingCache.logStats(this.ctx.sourceFile.fileName);
      }
    } else {
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
  // Macro expansion dispatch
  // ---------------------------------------------------------------------------

  private tryTransform(node: ts.Node): ts.Node | ts.Node[] | undefined {
    // fn.specialize(dict) must be checked before expression macros
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "specialize"
    ) {
      const result = tryRewriteSpecializeExtensionFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
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

      const autoSpecResult = tryAutoSpecializeFn(this.ctx, this.verbose, this.specCache, node);
      if (autoSpecResult !== undefined) {
        return autoSpecResult;
      }

      const returnTypeResult = tryReturnTypeDrivenSpecializeFn(
        this.ctx,
        this.verbose,
        this.specCache,
        node
      );
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

    if (hasJSDocMacroTagsFn(node)) {
      const result = tryExpandJSDocMacrosFn(this.ctx, this.verbose, node);
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const result = tryExpandTaggedTemplateFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        node
      );
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isTypeReferenceNode(node)) {
      const result = tryExpandTypeMacroFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        node
      );
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const result = tryRewriteExtensionMethodFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        this.resolveExtensionFromImports.bind(this),
        node
      );
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isBinaryExpression(node)) {
      const result = tryRewriteTypeclassOperatorFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
      if (result !== undefined) {
        return result;
      }
    }

    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const result = tryTransformHKTDeclarationFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
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

  // ---------------------------------------------------------------------------
  // Expression macro expansion (kept here due to cache interaction)
  // ---------------------------------------------------------------------------

  private tryExpandExpressionMacro(node: ts.CallExpression): ts.Expression | undefined {
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

    const cacheKey = this.isMacroCacheable(macro)
      ? this.computeCallSiteCacheKey(macroName, node, Array.from(node.arguments))
      : undefined;

    if (cacheKey) {
      const cached = this.getCachedExpression(cacheKey);
      if (cached) {
        if (this.verbose) {
          console.log(`[typesugar] Cache hit for macro: ${macroName}`);
        }
        if (this.expansionTracker) {
          const expandedText = this.printNodeSafe(cached);
          if (expandedText) {
            this.expansionTracker.recordExpansion(
              macroName,
              node,
              this.ctx.sourceFile,
              expandedText,
              true
            );
          }
        }
        const visited = ts.visitNode(cached, this.visit.bind(this)) as ts.Expression;
        return preserveSourceMap(visited, node);
      }
    }

    try {
      const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, node.arguments));

      if (cacheKey) {
        this.cacheExpression(cacheKey, result);
      }

      if (this.expansionTracker) {
        const expandedText = this.printNodeSafe(result);
        if (expandedText) {
          this.expansionTracker.recordExpansion(macroName, node, this.ctx.sourceFile, expandedText);
        }
      }

      if (result === node) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Macro expansion failed: ${error}`);
      return createMacroErrorExpr(
        this.ctx.factory,
        `typesugar: expansion of '${macroName}' failed: ${error}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Attribute macro expansion (kept here due to decorator update + visit interaction)
  // ---------------------------------------------------------------------------

  private tryExpandAttributeMacros(node: ts.HasDecorators): ts.Node | ts.Node[] | undefined {
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

    if (isInOptedOutScope(this.ctx.sourceFile, decorators[0], globalResolutionScope, "macros")) {
      return undefined;
    }

    const sortedDecorators = sortDecoratorsByDependency(decorators);

    let currentNode: ts.Node = node;
    const extraStatements: ts.Statement[] = [];
    const remainingDecorators: ts.Decorator[] = [];
    let wasTransformed = false;

    for (const decorator of sortedDecorators) {
      const { macroName, args, identNode } = parseDecorator(decorator);

      if (
        macroName === "derive" &&
        isInOptedOutScope(this.ctx.sourceFile, decorator, globalResolutionScope, "derive")
      ) {
        remainingDecorators.push(decorator);
        continue;
      }

      if (macroName === "derive") {
        const derives = expandDeriveDecoratorFn(this.ctx, this.verbose, decorator, node, args);
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
            createMacroErrorStmt(
              this.ctx.factory,
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
      currentNode = updateNodeDecorators(this.ctx.factory, currentNode, remainingDecorators);
    }

    let visited: ts.Node;
    try {
      visited = ts.visitNode(currentNode, this.visit.bind(this)) as ts.Node;
    } catch (error) {
      this.ctx.reportError(node, `Visiting attribute macro result failed: ${error}`);
      visited = ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }
    const mappedNode = preserveSourceMap(visited, node);

    if (extraStatements.length > 0) {
      return [mappedNode, ...extraStatements];
    }

    return mappedNode;
  }
}

// Export the MacroTransformer class
export { MacroTransformer };
