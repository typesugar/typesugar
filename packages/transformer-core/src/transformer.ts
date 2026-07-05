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
  isSyntheticNode,
  preserveSourceMap,
  ExpansionTracker,
  MacroExpansionCache,
  isRemoveExpression,
  getRemoveComment,
  TS9222,
} from "@typesugar/core";

import { getActivatedLabeledBlock, emitLabelSyntaxNotActivatedHint } from "./label-activation.js";

import {
  createMacroErrorExpression as createMacroErrorExpr,
  createMacroErrorStatement as createMacroErrorStmt,
  updateNodeDecorators,
  tryExtractCompReturnExpr,
  isPreprocessedCompWrapperBlock,
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
  tryInlineDerivedInstanceCall as tryInlineDerivedInstanceCallFn,
  eliminateDeadDerivedInstances as eliminateDeadDerivedInstancesFn,
} from "./specialization.js";

import {
  hasJSDocMacroTags as hasJSDocMacroTagsFn,
  tryExpandJSDocMacros as tryExpandJSDocMacrosFn,
  parseDecorator,
  sortDecoratorsByDependency,
  expandDeriveDecorator,
} from "./macro-helpers.js";

import {
  tryExpandTaggedTemplate as tryExpandTaggedTemplateFn,
  tryExpandTypeMacro as tryExpandTypeMacroFn,
  tryRewriteExtensionMethod as tryRewriteExtensionMethodFn,
  tryTransformHKTDeclaration as tryTransformHKTDeclarationFn,
  tryRewriteTypeclassOperator as tryRewriteTypeclassOperatorFn,
  tryRewriteOpaqueMethodCall as tryRewriteOpaqueMethodCallFn,
  tryEraseOpaqueConstructorCall as tryEraseOpaqueConstructorCallFn,
  tryEraseOpaqueConstantRef as tryEraseOpaqueConstantRefFn,
  tryEraseOpaqueAccessor as tryEraseOpaqueAccessorFn,
  tryStripOpaqueTypeAnnotation as tryStripOpaqueTypeAnnotationFn,
  tryStripOpaqueParamAnnotation as tryStripOpaqueParamAnnotationFn,
  shouldStripOpaqueReturnType as shouldStripOpaqueReturnTypeFn,
} from "./rewriting.js";

import { tryResolveTypeclassMethod as tryResolveTypeclassMethodFn } from "./method-sugar.js";

import { emitExtensionRegistrations as emitExtensionRegistrationsFn } from "./extension-registration.js";

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

  private inlinedInstanceNames = new Set<string>();

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
      // Use visitEachChild (not visitNode) so the arguments get visited for
      // nested macro expansion, but the call itself is not re-fed through
      // tryTransform — which would trigger auto-specialization and inline the
      // function body instead of preserving the call with the resolved instance.
      const visited = ts.visitEachChild(
        result,
        this.visit.bind(this),
        this.ctx.transformContext
      ) as ts.Expression;
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
    // Skip synthetic subtrees (pos === -1) entirely.  These come from macro
    // expansion output (e.g. assert IIFE, derive companions).  The type checker
    // crashes on their unbound symbols, and they don't contain further macros.
    // Exception: source-file, block, and module-block nodes that may contain a
    // mix of real and synthetic children need to be descended into.
    if (node.pos === -1 && !ts.isSourceFile(node) && !ts.isBlock(node) && !ts.isModuleBlock(node)) {
      return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }

    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
    }

    // Simplify arrow bodies of the shape
    //   (params) => { const __letyield_N = EXPR; return __letyield_N; }
    // to
    //   (params) => EXPR
    // This cleans up the block produced by `arrow-comprehension-preprocess.ts`
    // after the const-x-equals-let merge has expanded the comprehension.
    if (ts.isArrowFunction(node) && ts.isBlock(node.body)) {
      const visited = ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      if (visited && ts.isArrowFunction(visited) && ts.isBlock(visited.body)) {
        const simplified = tryExtractCompReturnExpr(visited.body);
        if (simplified) {
          return this.ctx.factory.updateArrowFunction(
            visited,
            visited.modifiers,
            visited.typeParameters,
            visited.parameters,
            visited.type,
            visited.equalsGreaterThanToken,
            simplified
          );
        }
      }
      return visited;
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

    // Track a pending `const x = let` declaration that should be merged
    // with the following `let: { ... } yield: { ... }` labeled block macro.
    // When TS parses `const x =\nlet: { ... }`, ASI splits it into two statements:
    //   1. `const x = let;`  (variable declaration with `let` identifier as initializer)
    //   2. `let: { ... }`    (labeled statement)
    // We detect this pattern and merge them: `const x = <expanded chain expression>;`
    let pendingVarDecl:
      | { stmt: ts.VariableStatement; name: ts.BindingName; flags: ts.NodeFlags }
      | undefined;

    for (let i = 0; i < statements.length; i++) {
      // ---------------------------------------------------------------
      // Expression-position comprehension wrapper: flatten the Block
      // emitted by `arrow-comprehension-preprocess.ts`.
      //
      // The preprocessor wraps `(x) => let:/yield:` (and the return/await/
      // export-default variants) in a double `{ { ... } }` block so the
      // parser's error-recovery consumes the stray `}` from the user's
      // `let:` block without closing the enclosing function body. Here we
      // splice the inner Block's statements into the outer statement list
      // so the existing `const x = let;` merge (below) sees the broken
      // VariableStatement, its bind siblings, and the trailing
      // `LabeledStatement` continuation all at the same level.
      //
      // We only flatten when the Block's first statement matches the
      // broken pattern *and* names a `__letyield_` synthetic tag, so
      // ordinary user-written blocks are never rewritten.
      // ---------------------------------------------------------------
      {
        const outer = statements[i];
        if (ts.isBlock(outer) && outer.statements.length >= 2 && isPreprocessedCompWrapperBlock(outer)) {
          statements.splice(i, 1, ...outer.statements);
          modified = true;
        }
      }

      const stmt = statements[i];

      // ---------------------------------------------------------------
      // Expression-level do-notation: const x = let: { ... } yield: { ... }
      //
      // When TS parses `const x =\nlet: { a << e1; b << e2; }\nyield: { a + b }`,
      // it produces these fragments (because `let` is consumed as identifier initializer):
      //   [i]   VariableStatement: decls=[x=let, {a}]  (destructuring captures 1st bind name)
      //   [i+1] ExpressionStatement: << e1              (1st bind effect)
      //   [i+2] ExpressionStatement: b << e2            (subsequent binds/maps)
      //   ...
      //   [i+n] LabeledStatement: yield: { a + b }      (continuation)
      //
      // We detect this pattern, reconstruct a synthetic let: block + yield: continuation,
      // pass them to the macro, and wrap the result in `const x = <expr>`.
      // ---------------------------------------------------------------
      if (ts.isVariableStatement(stmt)) {
        const decls = stmt.declarationList.declarations;
        if (decls.length === 2) {
          const firstDecl = decls[0];
          const secondDecl = decls[1];
          if (
            firstDecl.initializer &&
            ts.isIdentifier(firstDecl.initializer) &&
            (firstDecl.initializer.text === "let" || firstDecl.initializer.text === "seq") &&
            ts.isObjectBindingPattern(secondDecl.name) &&
            secondDecl.name.elements.length >= 1
          ) {
            const labelName = firstDecl.initializer.text;
            // PEP-052 gate. The head label was consumed as an identifier here,
            // so there is no LabeledStatement to warn at — anchor the TS9224
            // hint on the variable statement itself.
            const macro = getActivatedLabeledBlock(this.ctx, labelName, stmt);
            if (macro) {
              // Extract first bind name from destructuring pattern { a }
              const firstBindName = secondDecl.name.elements[0].name;
              if (ts.isIdentifier(firstBindName)) {
                // Consume fragment statements: << e1, b << e2, if(...), etc.
                // until we hit a yield:/pure:/return: LabeledStatement or end of block
                const fragmentStmts: ts.Statement[] = [];
                let j = i + 1;

                // First fragment: ExpressionStatement with << e1 (the first bind's effect)
                let firstBindEffect: ts.Expression | undefined;
                if (j < statements.length && ts.isExpressionStatement(statements[j])) {
                  const expr = (statements[j] as ts.ExpressionStatement).expression;
                  if (
                    ts.isBinaryExpression(expr) &&
                    expr.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
                  ) {
                    // The left side is empty/invalid identifier (from the destructuring split)
                    firstBindEffect = expr.right;
                    j++;
                  }
                }

                if (firstBindEffect) {
                  // Collect remaining bind/map/guard statements
                  while (j < statements.length) {
                    const frag = statements[j];
                    // Stop at yield:/pure:/return: continuation
                    if (ts.isLabeledStatement(frag) && macro.continuationLabels?.includes(frag.label.text)) {
                      break;
                    }
                    // Accept ExpressionStatements (binds, maps) and IfStatements (guards)
                    if (ts.isExpressionStatement(frag) || ts.isIfStatement(frag)) {
                      fragmentStmts.push(frag);
                      j++;
                      continue;
                    }
                    break; // Unknown statement type — stop consuming
                  }

                  // Check for yield:/pure:/return: continuation
                  let continuation: ts.LabeledStatement | undefined;
                  if (
                    j < statements.length &&
                    ts.isLabeledStatement(statements[j]) &&
                    macro.continuationLabels?.includes((statements[j] as ts.LabeledStatement).label.text)
                  ) {
                    continuation = statements[j] as ts.LabeledStatement;
                    j++;
                  }

                  // Reconstruct a synthetic `let: { a << e1; b << e2; ... }` labeled statement
                  const factory = this.ctx.factory;

                  // Build the first bind: `a << e1;`
                  const firstBindStmt = factory.createExpressionStatement(
                    factory.createBinaryExpression(
                      factory.createIdentifier(firstBindName.text),
                      factory.createToken(ts.SyntaxKind.LessThanLessThanToken),
                      firstBindEffect
                    )
                  );

                  // Combine: first bind + remaining fragments
                  const blockStatements = [firstBindStmt, ...fragmentStmts];
                  const syntheticBlock = factory.createBlock(blockStatements);
                  const syntheticLabel = factory.createLabeledStatement(
                    factory.createIdentifier(labelName),
                    syntheticBlock
                  );

                  if (this.verbose) {
                    console.log(
                      `[typesugar] Reconstructed expression-level ${labelName}:/yield: for const ${firstDecl.name.getText(this.ctx.sourceFile)}`
                    );
                  }

                  try {
                    const result = this.ctx.hygiene.withScope(() =>
                      macro.expand(this.ctx, syntheticLabel, continuation)
                    );
                    let expanded = Array.isArray(result) ? result : [result];

                    // Wrap in variable declaration: const x = <expanded expr>
                    if (expanded.length === 1 && ts.isExpressionStatement(expanded[0])) {
                      const expr = expanded[0].expression;
                      const newDecl = factory.createVariableDeclaration(
                        firstDecl.name,
                        undefined,
                        undefined,
                        expr
                      );
                      const newDeclList = factory.createVariableDeclarationList(
                        [newDecl],
                        stmt.declarationList.flags
                      );
                      expanded = [factory.createVariableStatement(stmt.modifiers, newDeclList)];
                    }

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

                    // Advance past all consumed statements
                    i = j - 1;
                    modified = true;
                    continue;
                  } catch (error) {
                    this.ctx.reportError(
                      stmt,
                      `Expression-level ${labelName}:/yield: expansion failed: ${error}`
                    );
                  }
                }
              }
            }
          }
        }
      }

      // Check for `const x = let;` pattern: a variable declaration whose
      // initializer is the identifier `let` or `seq` (the labeled block labels).
      // If found, hold it and check if the next statement is a labeled block macro.
      if (ts.isVariableStatement(stmt) && !pendingVarDecl) {
        const decls = stmt.declarationList.declarations;
        if (decls.length === 1) {
          const decl = decls[0];
          if (
            decl.initializer &&
            ts.isIdentifier(decl.initializer) &&
            (decl.initializer.text === "let" || decl.initializer.text === "seq")
          ) {
            // Peek ahead: is the next statement a labeled block macro with matching label?
            const nextStmt = i + 1 < statements.length ? statements[i + 1] : undefined;
            if (
              nextStmt &&
              ts.isLabeledStatement(nextStmt) &&
              nextStmt.label.text === decl.initializer.text &&
              ts.isBlock(nextStmt.statement) &&
              // PEP-052 gate: an unactivated label must not trigger the merge,
              // or the `const x = let;` statement would be silently dropped
              // while the labeled block is left unexpanded.
              getActivatedLabeledBlock(this.ctx, nextStmt.label.text, undefined)
            ) {
              // Hold this declaration — will be merged with the macro expansion
              pendingVarDecl = {
                stmt,
                name: decl.name,
                flags: stmt.declarationList.flags,
              };
              modified = true;
              continue; // skip adding to newStatements
            }
          }
        }
      }

      if (ts.isLabeledStatement(stmt)) {
        const labelName = stmt.label.text;
        // Only block-shaped labels are dispatch candidates — an ordinary loop
        // label that collides with a macro label (`all: for (…)`) must never
        // be hijacked, activated or not.
        const macro = ts.isBlock(stmt.statement)
          ? getActivatedLabeledBlock(this.ctx, labelName, stmt)
          : undefined;

        if (macro) {
          if (isInOptedOutScope(this.ctx.sourceFile, stmt, globalResolutionScope, "macros")) {
            const visited = ts.visitNode(stmt, this.visit.bind(this));
            if (visited && ts.isStatement(visited)) {
              newStatements.push(visited);
            }
            pendingVarDecl = undefined;
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
            let expanded = Array.isArray(result) ? result : [result];

            // If there's a pending `const x = let`, merge the expanded expression
            // into a variable declaration: `const x = <expanded expression>;`
            if (pendingVarDecl && expanded.length === 1 && ts.isExpressionStatement(expanded[0])) {
              const expr = expanded[0].expression;
              const newDecl = this.ctx.factory.createVariableDeclaration(
                pendingVarDecl.name,
                undefined,
                undefined,
                expr
              );
              const newDeclList = this.ctx.factory.createVariableDeclarationList(
                [newDecl],
                pendingVarDecl.flags
              );
              const newVarStmt = this.ctx.factory.createVariableStatement(
                pendingVarDecl.stmt.modifiers,
                newDeclList
              );
              expanded = [newVarStmt];
              pendingVarDecl = undefined;
            } else if (
              // Value-producing comprehension at statement position — the result
              // is discarded. Warn (TS9222). For lazy types (Effect, Iterable)
              // this means side effects never run. See LabeledBlockMacro.valueProducing.
              macro.valueProducing === true &&
              expanded.length === 1 &&
              ts.isExpressionStatement(expanded[0])
            ) {
              this.ctx
                .diagnostic(TS9222)
                .at(stmt)
                .withArgs({ label: labelName })
                .help(
                  `Assign to a variable (const result = ${labelName}: { ... } yield: { ... }) ` +
                    `or prefix with \`void\` to silence.`
                )
                .emit();
            }

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

            if (this.expansionTracker) {
              this.expansionTracker.recordExpansion(
                `${labelName}:`,
                stmt,
                this.ctx.sourceFile,
                "(labeled block)"
              );
            }
          } catch (error) {
            this.ctx.reportError(stmt, `Labeled block macro expansion failed: ${error}`);
            newStatements.push(
              createMacroErrorStmt(
                this.ctx.factory,
                `typesugar: labeled block '${labelName}:' expansion failed: ${error}`
              )
            );
            pendingVarDecl = undefined;
          }

          modified = true;
          continue;
        }
      }

      // If we had a pending var decl but the next statement wasn't a macro,
      // flush it as-is (it was just a regular `const x = let` — unusual but valid)
      if (pendingVarDecl) {
        const visited = ts.visitNode(pendingVarDecl.stmt, this.visit.bind(this));
        if (visited && ts.isStatement(visited)) {
          newStatements.push(visited);
        }
        pendingVarDecl = undefined;
      }

      const visited = this.visit(stmt);
      if (visited) {
        if (Array.isArray(visited)) {
          for (const n of visited as ts.Node[]) {
            if (!ts.isStatement(n)) continue;
            if (ts.isExpressionStatement(n) && isRemoveExpression(n.expression)) {
              const comment = getRemoveComment(n.expression);
              if (comment) {
                const empty = this.ctx.factory.createEmptyStatement();
                ts.addSyntheticLeadingComment(
                  empty,
                  ts.SyntaxKind.SingleLineCommentTrivia,
                  comment
                );
                newStatements.push(empty);
              }
              modified = true;
            } else {
              newStatements.push(n);
            }
          }
          modified = true;
        } else if (ts.isStatement(visited)) {
          if (ts.isExpressionStatement(visited) && isRemoveExpression(visited.expression)) {
            const comment = getRemoveComment(visited.expression);
            if (comment) {
              const empty = this.ctx.factory.createEmptyStatement();
              ts.addSyntheticLeadingComment(empty, ts.SyntaxKind.SingleLineCommentTrivia, comment);
              newStatements.push(empty);
            }
            modified = true;
          } else {
            // Collapse synthesized `{ const __letyield_N = EXPR; return __letyield_N; }`
            // Block statements (from `arrow-comprehension-preprocess.ts`'s
            // `return`-pattern rewrite) back into a single `return EXPR;`.
            let out: ts.Statement = visited;
            if (ts.isBlock(out)) {
              const ret = tryExtractCompReturnExpr(out);
              if (ret) {
                out = this.ctx.factory.createReturnStatement(ret);
                modified = true;
              }
            }
            newStatements.push(out);
          }
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

    if (ts.isSourceFile(node)) {
      cleanedStatements = eliminateDeadDerivedInstancesFn(
        cleanedStatements,
        this.inlinedInstanceNames,
        this.verbose
      );
    }

    // PEP-027: for a "use extension" source file, append registration calls
    // for each exported function so the compiled dist self-registers its
    // extensions at module load time.
    if (ts.isSourceFile(node) && globalResolutionScope.hasUseExtension(node.fileName)) {
      const regCalls = emitExtensionRegistrationsFn(this.ctx.factory, cleanedStatements);
      if (regCalls.length > 0) {
        cleanedStatements = [...cleanedStatements, ...regCalls];
        if (this.verbose) {
          console.log(
            `[typesugar] Emitted ${regCalls.length} extension registration call(s) for ${node.fileName}`
          );
        }
      }
    }

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
    // PEP-019: Strip opaque type annotations before visiting children,
    // so `const x: Option<T> = Some(v)` becomes `const x = v`.
    if (ts.isVariableDeclaration(node)) {
      const stripped = tryStripOpaqueTypeAnnotationFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
      if (stripped !== undefined) {
        return stripped;
      }
    }

    if (ts.isParameter(node)) {
      const stripped = tryStripOpaqueParamAnnotationFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
      if (stripped !== undefined) {
        return stripped;
      }
    }

    // PEP-019 Wave 5: Strip opaque return type annotations from functions
    if (ts.isFunctionDeclaration(node) && node.type) {
      if (shouldStripOpaqueReturnTypeFn(this.ctx, node.type, undefined)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.FunctionDeclaration;
        return this.ctx.factory.updateFunctionDeclaration(
          visited,
          visited.modifiers,
          visited.asteriskToken,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.body
        );
      }
    }
    if (ts.isFunctionExpression(node) && node.type) {
      if (shouldStripOpaqueReturnTypeFn(this.ctx, node.type, undefined)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.FunctionExpression;
        return this.ctx.factory.updateFunctionExpression(
          visited,
          visited.modifiers,
          visited.asteriskToken,
          visited.name,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.body
        );
      }
    }
    if (ts.isArrowFunction(node) && node.type) {
      if (shouldStripOpaqueReturnTypeFn(this.ctx, node.type, undefined)) {
        const visited = ts.visitEachChild(
          node,
          this.visit.bind(this),
          this.ctx.transformContext
        ) as ts.ArrowFunction;
        return this.ctx.factory.updateArrowFunction(
          visited,
          visited.modifiers,
          visited.typeParameters,
          visited.parameters,
          undefined,
          visited.equalsGreaterThanToken,
          visited.body
        );
      }
    }

    // Chain macro detection: fluent APIs like match(x).case(42).then("yes")
    // Must run before expression macros to intercept the outermost chain call
    // before visitEachChild would expand the root call in isolation.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chainResult = this.tryExpandChainMacro(node);
      if (chainResult !== undefined) {
        return chainResult;
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

      const derivedInlineResult = tryInlineDerivedInstanceCallFn(this.ctx, node);
      if (derivedInlineResult !== undefined) {
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression)
        ) {
          this.inlinedInstanceNames.add(node.expression.expression.text);
        }
        return derivedInlineResult;
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

    // Implicitly apply trigger-label attribute macros (e.g. @contract) to
    // functions/methods that contain matching labeled blocks (requires:/ensures:)
    // without an explicit decorator. Must run before descending into the body
    // so the macro can hoist/reposition (e.g. old() snapshots) the labeled blocks.
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      const result = this.tryExpandImplicitLabelMacro(node);
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
        if (this.expansionTracker && result !== (node as unknown as ts.Expression)) {
          const tagName = ts.isIdentifier(node.tag) ? node.tag.text : "tagged-template";
          this.expansionTracker.recordExpansion(
            tagName,
            node,
            this.ctx.sourceFile,
            "(tagged template)"
          );
        }
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
      // @opaque type-rewrite registry is checked FIRST, before native/extension
      // methods -- mirrors legacy's tryRewriteExtensionMethod, which checks
      // its type-rewrite registry before falling back to standalone extensions.
      const opaqueResult = tryRewriteOpaqueMethodCallFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        node
      );
      if (opaqueResult !== undefined) {
        if (this.expansionTracker) {
          this.expansionTracker.recordExpansion(
            "opaque-method",
            node,
            this.ctx.sourceFile,
            "(type rewrite)"
          );
        }
        return opaqueResult;
      }

      const result = tryRewriteExtensionMethodFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        this.resolveExtensionFromImports.bind(this),
        node
      );
      if (result !== undefined) {
        if (this.expansionTracker) {
          const methodName = node.expression.name.text;
          this.expansionTracker.recordExpansion(
            methodName,
            node,
            this.ctx.sourceFile,
            "(extension method)"
          );
        }
        return result;
      }

      // Typeclass instance-method sugar runs LAST, after extension methods and
      // @opaque type-rewrite erasure -- mirrors the legacy pipeline's
      // precedence (type-rewrite registry, then native/extension methods, then
      // method sugar as the final fallback).
      const methodSugarResult = tryResolveTypeclassMethodFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        this.resolveMacroFromSymbol.bind(this),
        this.resolveExtensionFromImports.bind(this),
        node
      );
      if (methodSugarResult !== undefined) {
        if (this.expansionTracker) {
          const methodName = node.expression.name.text;
          this.expansionTracker.recordExpansion(
            methodName,
            node,
            this.ctx.sourceFile,
            "(typeclass method)"
          );
        }
        return methodSugarResult;
      }
    }

    // @opaque constructor call erasure -- `Some(x)` -> `x`, `None()` -> `null`.
    // Dispatched here (after decorators/labels/JSDoc/tagged-templates/type-refs/
    // extension-method rewriting), matching legacy's position -- NOT earlier,
    // alongside auto-specialize/derived-inline/return-type-specialize, so that
    // those checks get first crack at an identifier-callee call expression.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const ctorResult = tryEraseOpaqueConstructorCallFn(
        this.ctx,
        this.verbose,
        this.visit.bind(this),
        node
      );
      if (ctorResult !== undefined) {
        if (this.expansionTracker) {
          this.expansionTracker.recordExpansion(
            "opaque-ctor",
            node,
            this.ctx.sourceFile,
            "(constructor erasure)"
          );
        }
        return ctorResult;
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
        if (ts.isCallExpression(result)) {
          const inlined = tryInlineDerivedInstanceCallFn(this.ctx, result);
          if (inlined !== undefined) {
            if (
              ts.isPropertyAccessExpression(result.expression) &&
              ts.isIdentifier(result.expression.expression)
            ) {
              this.inlinedInstanceNames.add(result.expression.expression.text);
            }
            return inlined;
          }
        }
        return result;
      }
    }

    if (ts.isIdentifier(node)) {
      const opaqueRef = tryEraseOpaqueConstantRefFn(this.ctx, this.verbose, node);
      if (opaqueRef !== undefined) {
        if (this.expansionTracker) {
          this.expansionTracker.recordExpansion(
            "opaque-const",
            node,
            this.ctx.sourceFile,
            "(constant erasure)"
          );
        }
        return opaqueRef;
      }
    }

    // Accessor erasure -- `x.value` -> `x` (non-call property access). Skip when
    // the property access is the callee of a call expression (that's a method
    // call, handled by tryRewriteExtensionMethodFn/tryRewriteOpaqueMethodCallFn
    // above). node.parent may be undefined on synthetic nodes.
    if (ts.isPropertyAccessExpression(node)) {
      const isCallCallee =
        node.parent != null && ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!isCallCallee) {
        const accessorResult = tryEraseOpaqueAccessorFn(
          this.ctx,
          this.verbose,
          this.visit.bind(this),
          node
        );
        if (accessorResult !== undefined) {
          if (this.expansionTracker) {
            this.expansionTracker.recordExpansion(
              node.name.text,
              node,
              this.ctx.sourceFile,
              "(accessor erasure)"
            );
          }
          return accessorResult;
        }
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
    // Skip synthetic nodes (created by macro expansion) to avoid re-expansion loops.
    if (isSyntheticNode(node)) {
      return undefined;
    }

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
        // Cached results are already fully expanded (visited), so no need to
        // re-visit. Re-visiting would fail because parseExpression strips
        // positions, making all nodes synthetic — the visitor skips macro
        // expansion on synthetic nodes.
        return preserveSourceMap(cached, node);
      }
    }

    try {
      const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, node.arguments));

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

      // Store in the expansion cache AFTER visiting, so nested macros are
      // fully expanded. On a cache hit, the stored (printed) text is re-parsed
      // with synthetic positions, and synthetic nodes skip macro expansion in
      // the visitor -- so a cache hit must not need re-visiting either.
      if (cacheKey) {
        this.cacheExpression(cacheKey, visited);
      }

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
  // Chain macro expansion (fluent API support, e.g. match(x).case().then().else())
  // ---------------------------------------------------------------------------

  private findChainRoot(node: ts.CallExpression): ts.CallExpression | undefined {
    let current: ts.Expression = node;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      current = current.expression.expression;
    }
    return ts.isCallExpression(current) ? current : undefined;
  }

  private isOutermostChainCall(node: ts.CallExpression): boolean {
    const parent = node.parent;
    if (!parent) return true;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.parent &&
      ts.isCallExpression(parent.parent)
    ) {
      return false;
    }
    return true;
  }

  private tryExpandChainMacro(node: ts.CallExpression): ts.Expression | undefined {
    const rootCall = this.findChainRoot(node);
    if (!rootCall) return undefined;

    if (!ts.isIdentifier(rootCall.expression)) return undefined;
    const macroName = rootCall.expression.text;

    const macro = this.resolveMacroFromSymbol(rootCall.expression, macroName, "expression") as
      | ExpressionMacro
      | undefined;
    if (!macro?.chainable) return undefined;

    if (!this.isOutermostChainCall(node)) return undefined;

    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    if (this.verbose) {
      console.log(`[typesugar] Expanding chain macro: ${macroName}`);
    }

    try {
      const result = this.ctx.hygiene.withScope(() =>
        macro.expand(this.ctx, node, Array.from(rootCall.arguments))
      );

      if (this.expansionTracker) {
        const expandedText = this.printNodeSafe(result);
        if (expandedText) {
          this.expansionTracker.recordExpansion(macroName, node, this.ctx.sourceFile, expandedText);
        }
      }

      if (result === (node as ts.Expression)) {
        return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
      }
      const visited = ts.visitNode(result, this.visit.bind(this)) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      this.ctx.reportError(node, `Chain macro expansion failed: ${error}`);
      return createMacroErrorExpr(
        this.ctx.factory,
        `typesugar: chain expansion of '${macroName}' failed: ${error}`
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

      // @derive(Eq, Clone, ...) is always handled specially — no attribute
      // macro named "derive" exists to look up (PEP-032 deleted it);
      // individual derives are registered under globalRegistry.getDerive.
      // Uses the pristine `node`, not `currentNode` — an earlier decorator
      // in this same loop may have already replaced `currentNode` with a
      // transformed node whose shape extractTypeInfo's checker-backed
      // lookups (getTypeAtLocation, getPropertiesOfType) don't expect.
      if (macroName === "derive") {
        const derives = expandDeriveDecorator(this.ctx, this.verbose, decorator, node, args);
        if (derives) {
          extraStatements.push(...derives);
          wasTransformed = true;
          continue;
        }
      }

      const macro = (
        identNode
          ? (this.resolveMacroFromSymbol(identNode, macroName, "attribute") ??
            globalRegistry.getAttribute(macroName))
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

          if (this.expansionTracker) {
            const expandedText = this.printNodeSafe(currentNode);
            if (expandedText) {
              this.expansionTracker.recordExpansion(
                macroName,
                node,
                this.ctx.sourceFile,
                expandedText
              );
            }
          }
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

  // ---------------------------------------------------------------------------
  // Implicit trigger-label attribute macros (e.g. @contract's requires:/ensures:)
  // (kept here due to decorator synthesis + visit interaction, same as above)
  // ---------------------------------------------------------------------------

  /**
   * Implicitly apply a trigger-label attribute macro (e.g. @contract) to a
   * function/method whose body contains a matching top-level labeled block
   * (e.g. `requires:` / `ensures:`), as if it were explicitly decorated.
   *
   * This makes the documented contract-block form work without an explicit
   * `@contract` decorator. It only fires when a package registering a macro
   * with matching `triggerLabels` is loaded (e.g. @typesugar/contracts), so
   * ordinary labeled statements are unaffected unless that package is imported.
   */
  private tryExpandImplicitLabelMacro(
    node: ts.FunctionDeclaration | ts.MethodDeclaration
  ): ts.Node | ts.Node[] | undefined {
    const body = node.body;
    if (!body) return undefined;

    // Find the first top-level labeled statement whose label is a trigger
    // label of a registered attribute macro. Only contract-block-shaped bodies
    // qualify (`label: { ... }` or `label: (result) => { ... }`), so ordinary
    // loop/break labels like `requires: for (...)` are never hijacked.
    let macro: AttributeMacro | undefined;
    const hintedUnactivated = new Set<string>();
    for (const stmt of body.statements) {
      if (!ts.isLabeledStatement(stmt)) continue;
      const isBlockShaped =
        ts.isBlock(stmt.statement) ||
        (ts.isExpressionStatement(stmt.statement) && ts.isArrowFunction(stmt.statement.expression));
      if (!isBlockShaped) continue;
      const candidate = globalRegistry.getAttributeByTriggerLabel(stmt.label.text);
      if (candidate) {
        // PEP-052 gate: trigger labels only fire when the file imports a
        // module carrying a `@syntax-labels <macro.name>` marker. Keep
        // scanning after an unactivated match — a later label may belong to
        // a different, activated trigger-label macro — but hint at most once
        // per macro (a `requires:`/`ensures:` pair is one missing import).
        if (
          !globalResolutionScope.isLabelSyntaxActivated(
            this.ctx.sourceFile.fileName,
            candidate.name
          )
        ) {
          if (!hintedUnactivated.has(candidate.name)) {
            hintedUnactivated.add(candidate.name);
            emitLabelSyntaxNotActivatedHint(this.ctx, stmt, stmt.label.text, candidate);
          }
          continue;
        }
        macro = candidate;
        break;
      }
    }
    if (!macro) return undefined;

    if (isInOptedOutScope(this.ctx.sourceFile, node, globalResolutionScope, "macros")) {
      return undefined;
    }

    if (this.verbose) {
      console.log(`[typesugar] Implicitly applying @${macro.name} via trigger label`);
    }

    const factory = this.ctx.factory;
    const decorator = factory.createDecorator(factory.createIdentifier(macro.name));

    let currentNode: ts.Node;
    try {
      currentNode = this.ctx.hygiene.withScope(() =>
        macro.expand(this.ctx, decorator, node as ts.Declaration, [])
      ) as ts.Node;
      if (Array.isArray(currentNode)) {
        currentNode = currentNode[0];
      }
    } catch (error) {
      this.ctx.reportError(node, `Implicit @${macro.name} expansion failed: ${error}`);
      return undefined;
    }

    let visited: ts.Node;
    try {
      visited = ts.visitNode(currentNode, this.visit.bind(this)) as ts.Node;
    } catch (error) {
      this.ctx.reportError(node, `Visiting implicit @${macro.name} result failed: ${error}`);
      visited = ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }
    const mapped = preserveSourceMap(visited, node);

    if (this.expansionTracker) {
      const expandedText = this.printNodeSafe(mapped);
      if (expandedText) {
        this.expansionTracker.recordExpansion(macro.name, node, this.ctx.sourceFile, expandedText);
      }
    }

    return mapped;
  }
}

// Export the MacroTransformer class
export { MacroTransformer };
