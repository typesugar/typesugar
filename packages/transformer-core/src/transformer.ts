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
  withStandaloneExtensionFile,
} from "@typesugar/core";

import {
  getActivatedLabeledBlock,
  emitLabelSyntaxNotActivatedHint,
  isLabeledBlockShaped,
} from "./label-activation.js";

import {
  createMacroErrorExpression as createMacroErrorExpr,
  createMacroErrorStatement as createMacroErrorStmt,
  updateNodeDecorators,
  tryExtractCompReturnExpr,
  collapseCompValueSlots,
  isPreprocessedCompWrapperBlock,
} from "./transformer-utils.js";

import {
  recordMacroImport,
  cleanupMacroImports,
  removeErasableSyntaxImports,
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
  type StatementTemps,
} from "./specialization.js";

import {
  hasJSDocMacroTags as hasJSDocMacroTagsFn,
  tryExpandJSDocMacros as tryExpandJSDocMacrosFn,
  isJSDocTagAtLineStart,
  parseDecorator,
  sortDecoratorsByDependency,
  expandDeriveDecorator,
  functionsFirst,
} from "./macro-helpers.js";

import {
  tryExpandTaggedTemplate as tryExpandTaggedTemplateFn,
  tryExpandTypeMacro as tryExpandTypeMacroFn,
  tryRewriteExtensionMethod as tryRewriteExtensionMethodFn,
  tryTransformHKTDeclaration as tryTransformHKTDeclarationFn,
  tryRewriteTypeclassOperator as tryRewriteTypeclassOperatorFn,
  tryRewriteTypeclassUnaryOperator as tryRewriteTypeclassUnaryOperatorFn,
  tryRewriteOpaqueMethodCall as tryRewriteOpaqueMethodCallFn,
  tryEraseOpaqueConstructorCall as tryEraseOpaqueConstructorCallFn,
  tryEraseOpaqueConstantRef as tryEraseOpaqueConstantRefFn,
  tryEraseOpaqueAccessor as tryEraseOpaqueAccessorFn,
} from "./rewriting.js";

import { tryResolveTypeclassMethod as tryResolveTypeclassMethodFn } from "./method-sugar.js";

import { emitExtensionRegistrations as emitExtensionRegistrationsFn } from "./extension-registration.js";

/** A directive-prologue statement (`"use strict";`, `"use client";`). */
function isDirectiveStatement(s: ts.Statement): boolean {
  return ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression);
}

class MacroTransformer {
  private additionalStatements: ts.Statement[] = [];

  private symbolMacroCache = new Map<string, MacroDefinition | null>();

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
  /**
   * The statement of a statement list being visited, and the `const`s an
   * inlined operator chain in it binds before it (tryInlineDerivedInstanceCall).
   */
  private statementTemps: StatementTemps | undefined;

  private inlinedInstanceNames = new Set<string>();

  /**
   * Decorators whose attribute macro already threw. They stay on the node
   * (so the error is visible) but are never re-expanded when the node is
   * re-visited -- otherwise the re-visit throws again, unboundedly
   * (deep-review core #13).
   */
  private failedDecorators = new WeakSet<ts.Decorator>();

  /**
   * Function/method nodes (and their implicit trigger-label results) that
   * the implicit trigger-label macro has already been applied to, so a
   * result that still carries its trigger label is not re-expanded forever.
   */
  private implicitLabelApplied = new WeakSet<ts.Node>();

  /**
   * Arguments visited ahead of derived-instance inlining (see
   * `withPreVisitedArgs`), consumed once by `visit` so the normal descent
   * does not expand them a second time.
   */
  private preVisitedArgs = new Map<ts.Node, ts.Node>();

  constructor(
    private ctx: MacroContextImpl,
    private verbose: boolean,
    private expansionTracker?: ExpansionTracker,
    private expansionCache?: MacroExpansionCache
  ) {}

  // ---------------------------------------------------------------------------
  // Expansion cache helpers
  // ---------------------------------------------------------------------------

  /**
   * Expression-macro caching is OPT-IN: only macros that declare
   * `cacheable: true` (pure functions of their call-site text) are cached.
   * It used to be default-on, which served type-, file- and config-dependent
   * expansions (`fieldNames<User>()`, `includeStr`, `cfg`) across files and
   * across builds.
   */
  private isMacroCacheable(macro: MacroDefinition): boolean {
    return macro.cacheable === true;
  }

  /** Snapshot of same-pass side-effect counters, taken before an expansion. */
  private sideEffectSnapshot(): { diagnostics: number; pendingImports: number } {
    return {
      diagnostics: this.ctx.getDiagnostics().length,
      pendingImports: this.ctx.fileBindingCache.getPendingImports().length,
    };
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
      return this.expansionCache.computeKey(
        macroName,
        sourceText,
        argTexts,
        this.ctx.sourceFile.fileName
      );
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
      // The completed call is auto-specialized exactly as the explicit call
      // `f(x, inst)` would be (same tryAutoSpecializeFn path, same fallbacks).
      // This deliberately supersedes the PEP-056 parity choice in commit
      // 7210ac66, which kept implicit calls as plain dictionary passing
      // (Dean's decision 2026-10-19).
      const autoSpecResult = ts.isCallExpression(result)
        ? tryAutoSpecializeFn(this.ctx, this.verbose, this.specCache, result)
        : undefined;
      if (autoSpecResult !== undefined) {
        return preserveSourceMap(this.visitRewrittenCall(autoSpecResult, result), node);
      }
      // Not specializable: use visitEachChild (not visitNode) so the
      // arguments get visited for nested macro expansion, but the call
      // itself is not re-fed through tryTransform (which would fill it in
      // and attempt specialization a second time).
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
    // The file being transformed, not `node.getSourceFile()`: a call that a
    // macro rebuilt with `factory.update*` (extend()'s fallback, a re-visited
    // macro result) keeps its source range but has no parent chain, so
    // getSourceFile() returned undefined and import-scoped extensions were
    // never found for it.
    const sourceFile = this.ctx.sourceFile;

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
      (symbol) => this.recordMacroImport(symbol),
      this.ctx.program
    );
  }

  // ---------------------------------------------------------------------------
  // Main visitor
  // ---------------------------------------------------------------------------

  visit(node: ts.Node): ts.Node | ts.Node[] {
    const preVisited = this.preVisitedArgs.get(node);
    if (preVisited !== undefined) {
      this.preVisitedArgs.delete(node);
      return preVisited;
    }

    // Skip synthetic subtrees (pos === -1) entirely.  These come from macro
    // expansion output (e.g. assert IIFE, derive companions).  The type checker
    // crashes on their unbound symbols, and they don't contain further macros.
    // Exception: source-file, block, and module-block nodes that may contain a
    // mix of real and synthetic children need to be descended into.
    if (node.pos === -1 && !ts.isSourceFile(node) && !ts.isBlock(node) && !ts.isModuleBlock(node)) {
      return ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    }

    if (ts.isSourceFile(node)) {
      // Extensions registered during this pass are keyed to this file, and the
      // file's entries from an earlier pass (watch/LSP re-transform) are dropped.
      return withStandaloneExtensionFile(node.fileName, () => this.visitStatementContainer(node));
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node)) {
      return this.visitStatementContainer(node);
    }

    // Block-bodied arrows go through the same implicit-scope / tryTransform
    // dispatch as every other function-like node (they used to return early
    // here, skipping both); the comprehension-body simplification below is
    // applied to the RESULT of that normal visit.
    if (ts.isArrowFunction(node) && ts.isBlock(node.body)) {
      return this.simplifyComprehensionArrow(this.visitDispatch(node));
    }

    if (ts.isBinaryExpression(node) && ts.isBinaryExpression(node.left)) {
      return this.visitLeftNestedBinary(node);
    }

    return this.visitDispatch(node);
  }

  /**
   * A left-nested binary chain (`"a" + "b" + ... + "z"`, `1 + 1 + ... + 1`:
   * each level's LEFT operand is the next binary expression), visited with a
   * loop instead of one recursion per level. Recursing through `visit` →
   * `visitDispatch` → `ts.visitEachChild` → `visitNode` for each level
   * overflowed the stack at a depth of about 2,000 (generated code — long
   * string concatenations, big literal tables — goes deeper, and tsc's own
   * checker and printer handle such chains iteratively).
   *
   * Same steps, in the same order, as the recursive visit: top-down, each
   * level gets `visitDispatch`'s per-node step (`tryTransform`; a binary
   * expression has no implicit parameters or trigger labels) before any of
   * its children are visited, and the first level something transforms (or
   * one `visit` treats specially: pre-visited, synthetic, or not a binary
   * expression) ends the descent and is visited as usual. Then bottom-up,
   * each level's right operand is visited after its whole left subtree, as
   * `visitEachChild` does, and the level is rebuilt with
   * `updateBinaryExpression` (which returns the original node when nothing
   * changed).
   */
  private visitLeftNestedBinary(root: ts.BinaryExpression): ts.Node | ts.Node[] {
    const visitor = this.visit.bind(this);
    const spine: ts.BinaryExpression[] = [];
    let n: ts.Expression = root;
    let bottom: ts.Expression;
    for (;;) {
      if (
        !ts.isBinaryExpression(n) ||
        n.pos === -1 ||
        (spine.length > 0 && this.preVisitedArgs.has(n))
      ) {
        bottom = ts.visitNode(n, visitor, ts.isExpression)!;
        break;
      }
      const transformed = this.tryTransform(n);
      if (transformed !== undefined) {
        bottom = ts.visitNode(n, () => transformed, ts.isExpression)!;
        break;
      }
      spine.push(n);
      n = n.left;
    }
    let result = bottom;
    for (let i = spine.length - 1; i >= 0; i--) {
      const level = spine[i];
      const right = ts.visitNode(level.right, visitor, ts.isExpression)!;
      result = this.ctx.factory.updateBinaryExpression(level, result, level.operatorToken, right);
    }
    return result;
  }

  private visitDispatch(node: ts.Node): ts.Node | ts.Node[] {
    // contracts #6: requires:/ensures: trigger labels are only applied to
    // function and method declarations. Elsewhere they would silently run as
    // a plain labeled block, so say so.
    this.reportUnsupportedTriggerLabels(node);

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

  /**
   * Simplify arrow bodies of the shape
   *   (params) => { const __letyield_N = EXPR; return __letyield_N; }
   * to
   *   (params) => EXPR
   * This cleans up the block produced by `arrow-comprehension-preprocess.ts`
   * after the const-x-equals-let merge has expanded the comprehension.
   */
  private simplifyComprehensionArrow(visited: ts.Node | ts.Node[]): ts.Node | ts.Node[] {
    if (!Array.isArray(visited) && ts.isArrowFunction(visited) && ts.isBlock(visited.body)) {
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

  /**
   * Report an error for a top-level, block-shaped trigger label (e.g. a
   * contract's `requires:` / `ensures:`) in a function-like node that the
   * implicit trigger-label dispatch does not support (arrow functions,
   * function expressions, constructors, accessors). Only fires when the
   * label's macro is activated for this file, so ordinary labels in files
   * that never imported the macro package stay untouched.
   */
  private reportUnsupportedTriggerLabels(node: ts.Node): void {
    let what: string | undefined;
    if (ts.isArrowFunction(node)) what = "arrow function";
    else if (ts.isFunctionExpression(node)) what = "function expression";
    else if (ts.isConstructorDeclaration(node)) what = "constructor";
    else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
      what = "accessor";
    if (!what) return;
    const body = (node as ts.FunctionLikeDeclaration).body;
    if (!body || !ts.isBlock(body) || isSyntheticNode(node)) return;

    for (const stmt of body.statements) {
      if (!ts.isLabeledStatement(stmt)) continue;
      const isBlockShaped =
        ts.isBlock(stmt.statement) ||
        (ts.isExpressionStatement(stmt.statement) && ts.isArrowFunction(stmt.statement.expression));
      if (!isBlockShaped) continue;
      const macro = globalRegistry.getAttributeByTriggerLabel(stmt.label.text);
      if (!macro) continue;
      if (!globalResolutionScope.isLabelSyntaxActivated(this.ctx.sourceFile.fileName, macro.name)) {
        continue;
      }
      this.ctx.reportError(
        stmt,
        `\`${stmt.label.text}:\` (@${macro.name}) is only supported directly inside a function ` +
          `declaration or method; in this ${what} it is NOT applied and its conditions are not ` +
          `checked. Move the logic into a function declaration or method.`
      );
    }
  }

  /**
   * The temporaries hoisted before `stmt` go after its leading comments, not
   * between them and the statement (review 7): the comments move onto the
   * first temporary -- except a JSDoc comment right before the statement,
   * which documents the statement and stays on it (`out`, what `stmt` became).
   * Skipped for the first statement of a file (its header comments are
   * emitted with the file, before any temporary, and copying them would
   * print them twice) and for an `out` with no source position (its source
   * comments are not printed from the source range anyway).
   */
  private moveLeadingCommentsAbove(
    stmt: ts.Statement,
    out: ts.Node,
    first: ts.Statement,
    container: ts.SourceFile | ts.Block | ts.ModuleBlock
  ): void {
    if (isSyntheticNode(stmt) || isSyntheticNode(out)) return;
    if (ts.isSourceFile(container) && container.statements[0] === stmt) return;
    const text = this.ctx.sourceFile.text;
    const ranges = ts.getLeadingCommentRanges(text, stmt.pos);
    if (!ranges || ranges.length === 0) return;
    const last = ranges[ranges.length - 1];
    const keepDoc =
      last.kind === ts.SyntaxKind.MultiLineCommentTrivia && text.startsWith("/**", last.pos);
    const moved = keepDoc ? ranges.slice(0, -1) : ranges;
    if (moved.length === 0) return;
    for (const r of moved) {
      const raw = text.slice(r.pos, r.end);
      const body =
        r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? raw.slice(2) : raw.slice(2, -2);
      ts.addSyntheticLeadingComment(first, r.kind, body, r.hasTrailingNewLine);
    }
    // Leading comments are printed from the comment range's start: from the
    // JSDoc, or from the statement's first token (none).
    const from = keepDoc ? last.pos : stmt.getStart(this.ctx.sourceFile);
    ts.setCommentRange(out, { pos: from, end: out.end });
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
        if (
          ts.isBlock(outer) &&
          outer.statements.length >= 2 &&
          isPreprocessedCompWrapperBlock(outer)
        ) {
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
                    if (
                      ts.isLabeledStatement(frag) &&
                      macro.continuationLabels?.includes(frag.label.text)
                    ) {
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
                    macro.continuationLabels?.includes(
                      (statements[j] as ts.LabeledStatement).label.text
                    )
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
        // Only labels on the statement their macro expects (a block, or a
        // switch for `match:`) are dispatch candidates — an ordinary loop
        // label that collides with a macro label (`all: for (…)`) must never
        // be hijacked, activated or not.
        const macro = isLabeledBlockShaped(stmt)
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
                  `Assign it (const result = ${labelName}: { ... } yield: { ... }), ` +
                    `or return it from an arrow function (\`=>\` then ${labelName}: on the next line).`
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

      const prevTemps = this.statementTemps;
      const temps: StatementTemps = { anchor: stmt, declarations: [] };
      this.statementTemps = temps;
      let visited: ts.Node | ts.Node[];
      try {
        visited = this.visit(stmt);
      } finally {
        this.statementTemps = prevTemps;
      }
      if (temps.declarations.length > 0) {
        newStatements.push(...temps.declarations);
        const out = Array.isArray(visited) ? visited.find((n) => ts.isStatement(n)) : visited;
        if (out) this.moveLeadingCommentsAbove(stmt, out, temps.declarations[0], node);
        modified = true;
      }
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

    const collapsed = collapseCompValueSlots(this.ctx.factory, newStatements);
    if (collapsed !== newStatements) modified = true;

    let cleanedStatements = ts.isSourceFile(node)
      ? cleanupMacroImports(this.ctx.factory, this.macroImportSpecifiers, collapsed, this.verbose)
      : collapsed;
    // Only in a file that changed anyway (a nested expansion counts): an
    // unchanged file must stay byte-identical, never reprinted.
    if (
      ts.isSourceFile(node) &&
      (cleanedStatements.length !== node.statements.length ||
        cleanedStatements.some((s, i) => s !== node.statements[i]))
    ) {
      cleanedStatements = removeErasableSyntaxImports(this.ctx.factory, cleanedStatements);
    }

    if (ts.isSourceFile(node)) {
      const pendingImports = this.ctx.fileBindingCache.getPendingImports();
      const hoistedDecls = this.specCache.getHoistedDeclarations();

      if (pendingImports.length > 0 || hoistedDecls.length > 0) {
        // Insert after the leading directive prologue ("use client", "use strict":
        // a directive that is no longer first is ignored) and the leading imports.
        let insertIndex = 0;
        while (
          insertIndex < cleanedStatements.length &&
          isDirectiveStatement(cleanedStatements[insertIndex])
        ) {
          insertIndex++;
        }
        for (let i = insertIndex; i < cleanedStatements.length; i++) {
          if (
            ts.isImportDeclaration(cleanedStatements[i]) ||
            // placeholder carrying a removed macro import's comments
            cleanedStatements[i].kind === ts.SyntaxKind.NotEmittedStatement
          ) {
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
        // Keep a function body's own "use strict" prologue first.
        let prologueEnd = 0;
        while (
          prologueEnd < cleanedStatements.length &&
          isDirectiveStatement(cleanedStatements[prologueEnd])
        ) {
          prologueEnd++;
        }
        cleanedStatements = [
          ...cleanedStatements.slice(0, prologueEnd),
          ...hoistedDecls,
          ...cleanedStatements.slice(prologueEnd),
        ];

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

    // Nothing in this container changed: return the node itself. The
    // factory's update* functions compare the NodeArray by reference, so a
    // fresh array of the same statements would make a new node, and a new
    // SourceFile makes the pipeline reprint a file that has no macros (losing
    // its formatting and making every editor position go through a source map
    // instead of identity).
    if (
      cleanedStatements.length === node.statements.length &&
      cleanedStatements.every((s, i) => s === node.statements[i])
    ) {
      return node;
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
    // `@opaque` annotations are kept as written in every position (PEP-019's
    // stripping is gone): expanded code is checked against the runtime view
    // of opaque types (opaqueTypesAsUnderlying), and declarations emitted
    // from the expanded program keep the types the author wrote.

    // `export const cloneFeature = derived<Clone<Feature>>();` expands to the
    // derived object; the declaration keeps the instance type as its
    // annotation, so the expanded program (and a `.d.ts` emitted from it)
    // types the const `Clone<Feature>`, not the object literal's shape.
    if (ts.isVariableDeclaration(node) && !node.type && node.initializer) {
      const annotated = this.tryAnnotateDerivedInstance(node);
      if (annotated !== undefined) return annotated;
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

      // These three rewrites build a new call from the ORIGINAL argument
      // nodes and are not otherwise re-visited, so macros inside those
      // arguments must be expanded here (deep-review core #7).
      const autoSpecResult = tryAutoSpecializeFn(this.ctx, this.verbose, this.specCache, node);
      if (autoSpecResult !== undefined) {
        return this.visitRewrittenCall(autoSpecResult, node);
      }

      // Derived-instance inlining substitutes synthetic (position-free) copies
      // of the argument nodes (cloneWithoutComments), and the visitor skips
      // macro expansion on synthetic nodes, so macros inside the arguments
      // would never expand in the inlined result. Visit the arguments FIRST and inline
      // from a call carrying the visited arguments (deep-review core #7).
      // The visited arguments are memoised so that, if inlining does not
      // fire, the later normal descent reuses them instead of expanding the
      // same macros twice.
      const inlineInput = this.withPreVisitedArgs(node);
      const derivedInlineResult = tryInlineDerivedInstanceCallFn(this.ctx, inlineInput);
      if (derivedInlineResult !== undefined) {
        this.forgetPreVisitedArgs(node);
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression)
        ) {
          this.inlinedInstanceNames.add(node.expression.expression.text);
        }
        return inlineInput === node
          ? derivedInlineResult
          : preserveSourceMap(derivedInlineResult, node);
      }

      const returnTypeResult = tryReturnTypeDrivenSpecializeFn(
        this.ctx,
        this.verbose,
        this.specCache,
        node
      );
      if (returnTypeResult !== undefined) {
        return this.visitRewrittenCall(returnTypeResult, node);
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

    if (hasJSDocMacroTagsFn(node) && !this.isJSDocExpanded(node)) {
      const result = tryExpandJSDocMacrosFn(this.ctx, this.verbose, node);
      // Mark even when nothing changed: a VariableDeclaration inherits its
      // statement's JSDoc tags, so a failed `/** @impl */ const x = ...`
      // would otherwise be dispatched again on the descent and report every
      // diagnostic twice (docs review S#29, C#27).
      this.markJSDocExpanded(node);
      if (result !== undefined) {
        // Descend into the (possibly rewritten) target so macros inside a
        // `/** @derive */` class body or `/** @impl */` initializer expand,
        // as the decorator path does (deep-review core #12). visitEachChild,
        // not visit: the target still carries its JSDoc tags, so a full
        // visit would re-enter this branch.
        const [head, ...rest] = Array.isArray(result) ? result : [result];
        // A declaration inside an expanded `/** @impl */ const x = ...`
        // statement inherits the statement's JSDoc tags; mark everything
        // this expansion covered so the descent does not expand it again.
        this.markJSDocExpanded(node);
        this.markJSDocExpanded(head);
        const visitedHead = ts.visitEachChild(
          head,
          this.visit.bind(this),
          this.ctx.transformContext
        );
        return rest.length > 0 ? [visitedHead, ...rest] : visitedHead;
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

    if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      const result = ts.isBinaryExpression(node)
        ? tryRewriteTypeclassOperatorFn(this.ctx, this.verbose, this.visit.bind(this), node)
        : tryRewriteTypeclassUnaryOperatorFn(this.ctx, this.verbose, this.visit.bind(this), node);
      if (result !== undefined) {
        if (ts.isCallExpression(result)) {
          const inlined = tryInlineDerivedInstanceCallFn(
            this.ctx,
            result,
            node,
            this.statementTemps
          );
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

  private jsdocExpanded = new WeakSet<ts.Node>();

  private markJSDocExpanded(node: ts.Node): void {
    this.jsdocExpanded.add(node);
    this.jsdocExpanded.add(ts.getOriginalNode(node));
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        this.jsdocExpanded.add(d);
        this.jsdocExpanded.add(ts.getOriginalNode(d));
      }
    }
  }

  private isJSDocExpanded(node: ts.Node): boolean {
    return this.jsdocExpanded.has(node) || this.jsdocExpanded.has(ts.getOriginalNode(node));
  }

  /**
   * For an `ident.method(args)` call (the only shape derived-instance
   * inlining handles), visit the arguments now and return a call carrying
   * them; the original call when nothing changed. Every visited argument
   * (changed or not) is memoised in `preVisitedArgs` for the normal descent.
   */
  private withPreVisitedArgs(node: ts.CallExpression): ts.CallExpression {
    if (
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      node.arguments.length === 0
    ) {
      return node;
    }
    let changed = false;
    const visitedArgs = node.arguments.map((a) => {
      const v = ts.visitNode(a, this.visit.bind(this)) as ts.Expression;
      // Memoise UNCHANGED arguments too: visiting one already ran its
      // rewrites (and reported their diagnostics), so the normal descent must
      // reuse the result rather than visit it again — `log(f(xs, ordX))`
      // reported f's TS9602 skip warning twice (docs review C#27).
      this.preVisitedArgs.set(a, v);
      if (v !== a) changed = true;
      return v;
    });
    if (!changed) return node;
    return this.ctx.factory.updateCallExpression(
      node,
      node.expression,
      node.typeArguments,
      visitedArgs
    );
  }

  private forgetPreVisitedArgs(node: ts.CallExpression): void {
    for (const a of node.arguments) this.preVisitedArgs.delete(a);
  }

  /**
   * Visit the result of a call rewrite (inlining / specialisation) so that
   * macros in the reused argument nodes are expanded. Synthetic wrapper
   * nodes are descended into by `visit` without re-running `tryTransform`
   * on them, so this cannot re-trigger the rewrite itself.
   */
  private visitRewrittenCall<T extends ts.Node>(result: T, original: ts.Node): T {
    if ((result as ts.Node) === original) {
      return ts.visitEachChild(result, this.visit.bind(this), this.ctx.transformContext);
    }
    const visited = ts.visitNode(result, this.visit.bind(this));
    return (visited ?? result) as T;
  }

  private hasDecorators(node: ts.Node): node is ts.HasDecorators {
    if (ts.canHaveDecorators(node) && ts.getDecorators(node) !== undefined) {
      return true;
    }
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      // `@layer(Svc) const x = ...`: TS parses the decorator into the
      // VariableStatement's modifiers (with a grammar error typesugar owns).
      ts.isVariableStatement(node)
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

  /**
   * `const x = derived<TC<T>>()` (no annotation): visit the declaration, and
   * when the call was expanded, annotate it with the call's type argument
   * `TC<T>` (the original node; it is in this file). Undefined when the
   * initializer is not a `derived` call, so the caller visits as usual.
   */
  private tryAnnotateDerivedInstance(
    node: ts.VariableDeclaration
  ): ts.VariableDeclaration | undefined {
    let init = node.initializer!;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    if (
      !ts.isCallExpression(init) ||
      !ts.isIdentifier(init.expression) ||
      init.typeArguments?.length !== 1 ||
      isSyntheticNode(init)
    ) {
      return undefined;
    }
    const macro = this.resolveMacroFromSymbol(init.expression, init.expression.text, "expression");
    if (macro?.name !== "derived" || macro.module !== "@typesugar/typeclass") return undefined;
    const visited = ts.visitEachChild(node, this.visit.bind(this), this.ctx.transformContext);
    let out = visited.initializer;
    while (out && ts.isParenthesizedExpression(out)) out = out.expression;
    // Not expanded (an error was reported): leave the declaration as written.
    if (!out || out === init || (ts.isCallExpression(out) && out.expression === init.expression)) {
      return visited;
    }
    return this.ctx.factory.updateVariableDeclaration(
      visited,
      visited.name,
      visited.exclamationToken,
      init.typeArguments[0],
      visited.initializer
    );
  }

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
      const before = cacheKey ? this.sideEffectSnapshot() : undefined;

      // `expandArgumentsFirst` macros (assert()) get their arguments already
      // expanded, and their result is NOT visited again: the arguments in it
      // are done, and a second visit could re-run a rewrite that kept its
      // node's source position (an implicits fill, an updated call).
      if (macro.expandArgumentsFirst) {
        const expandedArgs = node.arguments.map(
          (a) => ts.visitNode(a, this.visit.bind(this)) as ts.Expression
        );
        const argsChanged = expandedArgs.some((a, i) => a !== node.arguments[i]);
        const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, expandedArgs));
        if (result === node) {
          return argsChanged
            ? this.ctx.factory.updateCallExpression(
                node,
                node.expression,
                node.typeArguments,
                expandedArgs
              )
            : node;
        }
        if (this.expansionTracker) {
          const expandedText = this.printNodeSafe(result);
          if (expandedText) {
            this.expansionTracker.recordExpansion(
              macroName,
              node,
              this.ctx.sourceFile,
              expandedText
            );
          }
        }
        if (cacheKey && before && !argsChanged) {
          const after = this.sideEffectSnapshot();
          if (
            after.diagnostics === before.diagnostics &&
            after.pendingImports === before.pendingImports
          ) {
            this.cacheExpression(cacheKey, result);
          }
        }
        return preserveSourceMap(result, node);
      }

      const result = this.ctx.hygiene.withScope(() => macro.expand(this.ctx, node, node.arguments));

      // A macro that hands back the call itself (comptime with evaluation
      // switched off in the editor, a macro that reported an error) expanded
      // nothing: recording the call as its own "expansion" made the editor
      // show `= comptime(...)` as if it were a value (PEP-060 item 5).
      if (this.expansionTracker && result !== node) {
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
      //
      // A cache hit replays only the printed text, never side effects, so do
      // not store an expansion that (a) reported a diagnostic, (b) queued an
      // import, or (c) had its subtree rewritten while visiting -- a nested
      // macro / extension / implicit rewrite in the arguments may depend on
      // types or state that the call-site text does not capture.
      if (cacheKey && before) {
        const after = this.sideEffectSnapshot();
        const pure =
          visited === result &&
          after.diagnostics === before.diagnostics &&
          after.pendingImports === before.pendingImports;
        if (pure) {
          this.cacheExpression(cacheKey, visited);
        }
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
        ts.isTypeAliasDeclaration(node) ||
        ts.isVariableStatement(node)
      ) {
        const nodeWithModifiers = node as
          | ts.FunctionDeclaration
          | ts.InterfaceDeclaration
          | ts.TypeAliasDeclaration
          | ts.VariableStatement;
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

    // A decorated `const`: the macro's target is its (single) declaration, as
    // for the JSDoc form (tryExpandJSDocMacros); the statement is rebuilt below.
    const asNode = node as ts.Node;
    const varStmt = ts.isVariableStatement(asNode) ? asNode : undefined;
    if (varStmt && varStmt.declarationList.declarations.length !== 1) {
      this.ctx.reportError(
        decorators[0],
        "typesugar: a decorator on a variable statement needs exactly one declaration " +
          "(write `@macro const x = ...;`, one per statement)"
      );
      return undefined;
    }

    let currentNode: ts.Node = varStmt ? varStmt.declarationList.declarations[0] : node;
    const extraStatements: ts.Statement[] = [];
    const attributeExtras = new Set<ts.Statement>();
    const remainingDecorators: ts.Decorator[] = [];
    let wasTransformed = false;

    for (const decorator of sortedDecorators) {
      if (this.failedDecorators.has(decorator)) {
        remainingDecorators.push(decorator);
        continue;
      }
      const { macroName, args, identNode } = parseDecorator(decorator);

      const isDerive = macroName === "derive" || macroName === "deriving";
      if (
        isDerive &&
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
      // `@deriving(...)` is the deprecated alias (expandDeriveDecorator warns).
      if (isDerive) {
        const derives = expandDeriveDecorator(this.ctx, this.verbose, decorator, node, args);
        if (derives) {
          extraStatements.push(...derives);
          // Several @derive decorators: functions before namespaces (TS2434).
          extraStatements.splice(0, extraStatements.length, ...functionsFirst(extraStatements));
        }
        // Handled even when it generated nothing (each failure is reported):
        // drop the decorator, which is not valid TypeScript on an interface
        // or type alias and would be an undefined decorator on a class. The
        // reprint of every file used to drop it by accident; a file nothing
        // changed is no longer reprinted.
        if (
          derives ||
          ts.isInterfaceDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)
        ) {
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
              // Visited below like result[0], so macros inside them expand.
              for (const extra of result.slice(1).filter(ts.isStatement)) {
                extraStatements.push(extra);
                attributeExtras.add(extra);
              }
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
          this.failedDecorators.add(decorator);
          remainingDecorators.push(decorator);
          wasTransformed = true;
        }
      } else {
        remainingDecorators.push(decorator);
      }
    }

    if (!wasTransformed) return undefined;

    if (varStmt) {
      const f = this.ctx.factory;
      const otherModifiers = (varStmt.modifiers ?? []).filter((m) => !ts.isDecorator(m));
      if (ts.isVariableDeclaration(currentNode)) {
        currentNode = f.updateVariableStatement(
          varStmt,
          [...remainingDecorators, ...otherModifiers],
          f.updateVariableDeclarationList(varStmt.declarationList, [currentNode])
        );
      } else if (!ts.isStatement(currentNode)) {
        this.ctx.reportError(
          decorators[0],
          `typesugar: attribute macro on a const returned a ${ts.SyntaxKind[currentNode.kind]}, ` +
            "expected a VariableDeclaration or a statement"
        );
        return undefined;
      }
    } else if (remainingDecorators.length !== decorators.length) {
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
      const visitedExtras: ts.Statement[] = [];
      for (const stmt of extraStatements) {
        if (!attributeExtras.has(stmt)) {
          visitedExtras.push(stmt);
          continue;
        }
        try {
          const v = this.visit(stmt);
          for (const n of Array.isArray(v) ? v : [v]) {
            if (ts.isStatement(n)) visitedExtras.push(n);
          }
        } catch (error) {
          this.ctx.reportError(node, `Visiting attribute macro result failed: ${error}`);
          visitedExtras.push(stmt);
        }
      }
      return [mappedNode, ...visitedExtras];
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
    if (
      this.implicitLabelApplied.has(node) ||
      this.implicitLabelApplied.has(ts.getOriginalNode(node))
    ) {
      return undefined;
    }

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
          // An explicit `/** @contract */` tag is its own opt-in (the JSDoc
          // dispatch below applies the macro), so no "not activated" hint.
          const explicitTag = ts
            .getJSDocTags(node)
            .some((t) => t.tagName.text === candidate.name && isJSDocTagAtLineStart(t));
          if (!explicitTag && !hintedUnactivated.has(candidate.name)) {
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

    this.implicitLabelApplied.add(node);
    this.implicitLabelApplied.add(currentNode);

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
