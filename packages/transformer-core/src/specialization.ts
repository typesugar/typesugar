/**
 * Auto-specialization and return-type-driven specialization.
 *
 * Extracts instance dictionaries from @impl-annotated declarations,
 * inlines method bodies for zero-cost typeclass dispatch, and
 * rewrites function calls based on contextual return types.
 */

import * as ts from "typescript";

import {
  isRegisteredInstance,
  getInstanceMethods,
  getInstanceOrIntrinsicMethods,
  SpecializationCache,
  createHoistedSpecialization,
  classifyInlineFailureDetailed,
  getInlineFailureHelp,
  inlineMethod,
  getResultAlgebra,
  analyzeForFlattening,
  flattenReturnsToExpression,
  extractMethodsFromObjectLiteral,
  registerInstanceMethodsFromAST,
  type DictMethodMap,
  type ResultAlgebra,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalResolutionScope,
  isInOptedOutScope,
  preserveSourceMap,
} from "@typesugar/core";

import { safeGetNodeText, type VisitFn } from "./transformer-utils.js";

// ---------------------------------------------------------------------------
// Void return type detection
// ---------------------------------------------------------------------------

/**
 * Check if a function has a void return type.
 * Used to suppress "no return statement" warnings for void functions,
 * since that's expected behavior.
 */
function isVoidReturnType(
  typeChecker: ts.TypeChecker,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
): boolean {
  // Check explicit return type annotation
  if (fn.type) {
    if (fn.type.kind === ts.SyntaxKind.VoidKeyword) {
      return true;
    }
  }

  // Infer from type checker
  try {
    const signature = typeChecker.getSignatureFromDeclaration(fn);
    if (signature) {
      const returnType = typeChecker.getReturnTypeOfSignature(signature);
      const typeStr = typeChecker.typeToString(returnType);
      return typeStr === "void";
    }
  } catch {
    // Fall through
  }

  return false;
}

// ---------------------------------------------------------------------------
// Instance name extraction
// ---------------------------------------------------------------------------

export function getInstanceName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  if (ts.isAsExpression(expr)) {
    return getInstanceName(expr.expression);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// @impl annotation detection
// ---------------------------------------------------------------------------

export function hasImplAnnotation(decl: ts.Declaration): boolean {
  const jsDocs = ts.getJSDocTags(decl);
  for (const tag of jsDocs) {
    if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
      return true;
    }
  }

  if (ts.isVariableDeclaration(decl)) {
    const parent = decl.parent?.parent;
    if (parent && ts.isVariableStatement(parent)) {
      const parentTags = ts.getJSDocTags(parent);
      for (const tag of parentTags) {
        if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
          return true;
        }
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Brand extraction from @impl
// ---------------------------------------------------------------------------

export function extractBrandFromImpl(decl: ts.Declaration): string | undefined {
  const extractFromTags = (tags: readonly ts.JSDocTag[]): string | undefined => {
    for (const tag of tags) {
      if (tag.tagName.text === "impl" || tag.tagName.text === "instance") {
        const comment =
          typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
        if (comment) {
          const text = comment.trim();
          const openBracket = text.indexOf("<");
          if (openBracket === -1) continue;

          let depth = 0;
          let closeBracket = -1;
          for (let i = openBracket; i < text.length; i++) {
            if (text[i] === "<") depth++;
            else if (text[i] === ">") {
              depth--;
              if (depth === 0) {
                closeBracket = i;
                break;
              }
            }
          }

          if (closeBracket !== -1) {
            return text.slice(openBracket + 1, closeBracket).trim();
          }
        }
      }
    }
    return undefined;
  };

  const result = extractFromTags(ts.getJSDocTags(decl));
  if (result) return result;

  if (ts.isVariableDeclaration(decl)) {
    const parent = decl.parent?.parent;
    if (parent && ts.isVariableStatement(parent)) {
      return extractFromTags(ts.getJSDocTags(parent));
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Source-based instance extraction
// ---------------------------------------------------------------------------

export function tryExtractInstanceFromSource(
  ctx: MacroContextImpl,
  argExpr: ts.Expression
): DictMethodMap | undefined {
  const argName = getInstanceName(argExpr);
  if (!argName) return undefined;

  try {
    const symbol = ctx.typeChecker.getSymbolAtLocation(argExpr);
    if (!symbol) return undefined;

    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) return undefined;

    for (const decl of declarations) {
      if (!hasImplAnnotation(decl)) continue;

      let objLiteral: ts.ObjectLiteralExpression | undefined;
      let varDecl: ts.VariableDeclaration | undefined;

      if (ts.isVariableDeclaration(decl)) {
        varDecl = decl;
        if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
          objLiteral = decl.initializer;
        }
      }

      if (!objLiteral) continue;

      let brand = extractBrandFromImpl(decl);

      if (!brand && varDecl?.type) {
        try {
          if (ts.isTypeReferenceNode(varDecl.type) && varDecl.type.typeArguments) {
            const firstTypeArg = varDecl.type.typeArguments[0];
            if (firstTypeArg) {
              brand = safeGetNodeText(firstTypeArg, ctx.sourceFile);
            }
          }

          if (!brand) {
            const typeStr = varDecl.type.getText(ctx.sourceFile);
            const match = typeStr.match(/<([^>]+)>/);
            if (match) {
              brand = match[1].split(",")[0].trim();
            }
          }
        } catch {
          // Brand extraction from type annotation failed
        }
      }

      if (!brand) {
        brand = argName;
      }

      const methods = extractMethodsFromObjectLiteral(objLiteral, ctx.hygiene);
      if (methods.size > 0) {
        registerInstanceMethodsFromAST(argName, brand, methods);
        return { brand, methods };
      }
    }
  } catch {
    // Fallback to registry-based lookup on error
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Function body resolution
// ---------------------------------------------------------------------------

export function resolveAutoSpecFunctionBody(
  typeChecker: ts.TypeChecker,
  fnExpr: ts.Expression
): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined {
  if (ts.isArrowFunction(fnExpr) || ts.isFunctionExpression(fnExpr)) {
    return fnExpr;
  }

  if (ts.isIdentifier(fnExpr)) {
    try {
      const symbol = typeChecker.getSymbolAtLocation(fnExpr);
      if (!symbol) return undefined;
      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const decl of declarations) {
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            return decl.initializer;
          }
        }
        if (ts.isFunctionDeclaration(decl) && decl.body) {
          return decl;
        }
      }
    } catch {
      return undefined;
    }
  }

  if (ts.isPropertyAccessExpression(fnExpr)) {
    try {
      const symbol = typeChecker.getSymbolAtLocation(fnExpr);
      if (!symbol) return undefined;
      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0) return undefined;

      for (const decl of declarations) {
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            return decl.initializer;
          }
        }
        if (ts.isFunctionDeclaration(decl) && decl.body) {
          return decl;
        }
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Dictionary call rewriting
// ---------------------------------------------------------------------------

export function rewriteDictCallsForAutoSpec(
  ctx: MacroContextImpl,
  node: ts.Node,
  dictParamMap: Map<string, DictMethodMap>
): ts.Node {
  function visit(n: ts.Node): ts.Node {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression)
    ) {
      const dictParamName = n.expression.expression.text;
      const dictMethods = dictParamMap.get(dictParamName);

      if (dictMethods) {
        const methodName = n.expression.name.text;
        const method = dictMethods.methods.get(methodName);

        if (method) {
          const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
          if (inlined) {
            const mapped = preserveSourceMap(inlined, n);
            return ts.visitEachChild(mapped, visit, ctx.transformContext);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Node;
}

// ---------------------------------------------------------------------------
// Hoisting for auto-specialization
// ---------------------------------------------------------------------------

export function inlineAutoSpecializeForHoisting(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  instanceArgs: { index: number; name: string; methods: DictMethodMap }[],
  _fnName: string
): ts.Expression | undefined {
  const params = Array.from(fn.parameters);
  if (params.length === 0) return undefined;

  const dictParamMap = new Map<string, DictMethodMap>();
  const dictParamIndices = new Set<number>();

  for (const instArg of instanceArgs) {
    if (instArg.index < params.length) {
      const param = params[instArg.index];
      const paramName = ts.isIdentifier(param.name) ? param.name.text : undefined;
      if (paramName) {
        dictParamMap.set(paramName, instArg.methods);
        dictParamIndices.add(instArg.index);
      }
    }
  }

  if (dictParamMap.size === 0) return undefined;

  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) return undefined;

  const specializedBody = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap);

  // Collect type parameter names that become unresolvable once stripped
  const fnTypeParamNames = new Set<string>();
  const typeParams =
    ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)
      ? fn.typeParameters
      : undefined;
  if (typeParams) {
    for (const tp of typeParams) fnTypeParamNames.add(tp.name.text);
  }

  // Strip type annotations that reference unresolvable type parameters
  const remainingParams = params
    .filter((_, i) => !dictParamIndices.has(i))
    .map((p) => {
      if (p.type && fnTypeParamNames.size > 0 && typeNodeRefsAny(p.type, fnTypeParamNames)) {
        return ctx.factory.createParameterDeclaration(
          undefined,
          p.dotDotDotToken,
          p.name,
          p.questionToken,
          undefined,
          p.initializer
        );
      }
      return p;
    });

  if (remainingParams.length === 0) {
    if (ts.isExpression(specializedBody)) {
      return ctx.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        specializedBody
      );
    }
    if (ts.isBlock(specializedBody)) {
      return ctx.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        specializedBody
      );
    }
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    remainingParams,
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    specializedBody as ts.ConciseBody
  );
}

function typeNodeRefsAny(typeNode: ts.TypeNode, names: Set<string>): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      names.has(node.typeName.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(typeNode);
  return found;
}

// ---------------------------------------------------------------------------
// Auto-specialization entry point
// ---------------------------------------------------------------------------

export function tryAutoSpecialize(
  ctx: MacroContextImpl,
  verbose: boolean,
  specCache: SpecializationCache,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  const isSyntheticNode = node.pos === -1 || node.end === -1;
  let suppressWarnings = isSyntheticNode;

  if (!isSyntheticNode) {
    try {
      const sourceText = node.getSourceFile().text;
      const nodeStart = node.getStart();
      const lineStart = sourceText.lastIndexOf("\n", nodeStart) + 1;
      const lineText = sourceText.slice(lineStart, nodeStart);

      if (lineText.includes("@no-specialize")) {
        return undefined;
      }
      suppressWarnings = lineText.includes("@no-specialize-warn");
    } catch {
      // Proceed with auto-specialization
    }
  }

  const instanceArgs: {
    index: number;
    name: string;
    methods: DictMethodMap;
  }[] = [];

  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i];
    const argName = getInstanceName(arg);
    if (!argName) continue;

    let methods = tryExtractInstanceFromSource(ctx, arg);

    if (!methods && isRegisteredInstance(argName)) {
      methods = getInstanceMethods(argName);
    }

    if (methods) {
      instanceArgs.push({ index: i, name: argName, methods });
    }
  }

  if (instanceArgs.length === 0) {
    return undefined;
  }

  const fnName = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : "<anonymous>";

  const fnBody = resolveAutoSpecFunctionBody(ctx.typeChecker, node.expression);
  if (!fnBody) {
    if (!suppressWarnings) {
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fnName} skipped — ` +
          `function body not resolvable. ` +
          `Use explicit specialize() if you need guaranteed inlining.`
      );
    }
    return undefined;
  }

  const body = ts.isFunctionDeclaration(fnBody) ? fnBody.body : fnBody.body;
  if (body && ts.isBlock(body)) {
    const classification = classifyInlineFailureDetailed(body);
    if (classification.reason && !classification.canFlatten) {
      // Don't warn for void functions - "no return statement" is expected for them
      const isVoidFunction = isVoidReturnType(ctx.typeChecker, fnBody);
      if (
        !suppressWarnings &&
        !(classification.reason === "no return statement" && isVoidFunction)
      ) {
        const help = getInlineFailureHelp(classification.reason);
        ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `${classification.reason}. ${help}`
        );
      }
      return undefined;
    }
  }

  if (verbose) {
    console.log(
      `[typesugar] Auto-specializing call to ${fnName} with instance: ${instanceArgs.map((a) => a.name).join(", ")}`
    );
  }

  let fnSymbolId = fnName;
  try {
    const fnSymbol = ctx.typeChecker.getSymbolAtLocation(node.expression);
    if (fnSymbol) {
      fnSymbolId = (fnSymbol as unknown as { id?: number }).id?.toString() ?? fnName;
    }
  } catch {
    // Use fnName as fallback
  }
  const dictBrands = instanceArgs.map((a) => a.methods.brand);
  const cacheKey = SpecializationCache.computeKey(fnSymbolId, dictBrands);

  const cachedEntry = specCache.get(cacheKey);
  if (cachedEntry) {
    if (verbose) {
      console.log(`[typesugar] Reusing cached specialization: ${cachedEntry.ident.text}`);
    }
    const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
    const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
    return ctx.factory.createCallExpression(cachedEntry.ident, node.typeArguments, remainingArgs);
  }

  try {
    const specialized = inlineAutoSpecializeForHoisting(ctx, fnBody, instanceArgs, fnName);

    if (specialized) {
      const hoistedIdent = SpecializationCache.generateHoistedName(fnName, dictBrands, ctx.hygiene);
      const hoistedDecl = createHoistedSpecialization(ctx.factory, hoistedIdent, specialized);

      specCache.set(cacheKey, hoistedIdent, hoistedDecl);

      if (verbose) {
        console.log(`[typesugar] Created hoisted specialization: ${hoistedIdent.text}`);
      }

      const dictParamIndices = new Set(instanceArgs.map((a) => a.index));
      const remainingArgs = Array.from(node.arguments).filter((_, i) => !dictParamIndices.has(i));
      return ctx.factory.createCallExpression(hoistedIdent, node.typeArguments, remainingArgs);
    } else {
      if (!suppressWarnings) {
        ctx.reportWarning(
          node,
          `[TS9602] Auto-specialization of ${fnName} skipped — ` +
            `inlining returned no result. ` +
            `Use explicit specialize() if you need guaranteed inlining.`
        );
      }
    }
  } catch (error) {
    if (!suppressWarnings) {
      ctx.reportWarning(
        node,
        `[TS9602] Auto-specialization of ${fnName} skipped — ` +
          `${error}. Use explicit specialize() if you need guaranteed inlining.`
      );
    }
    if (verbose) {
      console.log(`[typesugar] Auto-specialization failed: ${error}`);
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Return-type-driven specialization helpers
// ---------------------------------------------------------------------------

export function getTypeName(typeChecker: ts.TypeChecker, type: ts.Type): string | undefined {
  if (type.isUnion()) {
    for (const t of type.types) {
      if (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue;
      const name = getTypeName(typeChecker, t);
      if (name) return name;
    }
  }
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol) {
    return symbol.getName();
  }
  const typeStr = typeChecker.typeToString(type);
  const match = typeStr.match(/^(\w+)(?:<|$)/);
  return match ? match[1] : undefined;
}

export function getContextualTypeForCall(
  typeChecker: ts.TypeChecker,
  node: ts.CallExpression
): ts.Type | undefined {
  try {
    const contextual = typeChecker.getContextualType(node);
    if (contextual) return contextual;
  } catch {
    // Fall through to parent-based detection
  }

  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.type) {
    try {
      return typeChecker.getTypeFromTypeNode(parent.type);
    } catch {
      return undefined;
    }
  }

  if (ts.isReturnStatement(parent)) {
    let current: ts.Node | undefined = parent.parent;
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isArrowFunction(current) ||
          ts.isFunctionExpression(current) ||
          ts.isMethodDeclaration(current)) &&
        current.type
      ) {
        try {
          return typeChecker.getTypeFromTypeNode(current.type);
        } catch {
          return undefined;
        }
      }
      current = current.parent;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Result algebra specialization
// ---------------------------------------------------------------------------

export function specializeForResultAlgebra(
  ctx: MacroContextImpl,
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  algebra: ResultAlgebra
): ts.Expression | undefined {
  const params = Array.from(fn.parameters);
  const body = ts.isFunctionDeclaration(fn) ? fn.body : fn.body;
  if (!body) return undefined;

  const rewrittenBody = rewriteResultCalls(ctx, body, algebra);

  let finalBody: ts.ConciseBody = rewrittenBody as ts.ConciseBody;

  if (ts.isBlock(rewrittenBody)) {
    const analysis = analyzeForFlattening(rewrittenBody);
    if (analysis.canFlatten) {
      const flattened = flattenReturnsToExpression(ctx, rewrittenBody);
      if (flattened) {
        finalBody = flattened;
      }
    }
  }

  return ctx.factory.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    finalBody
  );
}

export function rewriteResultCalls(
  ctx: MacroContextImpl,
  node: ts.Node,
  algebra: ResultAlgebra
): ts.Node {
  function visit(n: ts.Node): ts.Node {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === "ok") {
        if (n.arguments.length >= 1) {
          const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
          return algebra.rewriteOk(ctx, visitedValue);
        }
        return algebra.rewriteOk(ctx, ctx.factory.createIdentifier("undefined"));
      }

      if (ts.isIdentifier(n.expression) && n.expression.text === "err") {
        if (n.arguments.length >= 1) {
          const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
          return algebra.rewriteErr(ctx, visitedError);
        }
        return algebra.rewriteErr(ctx, ctx.factory.createIdentifier("undefined"));
      }

      if (ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression;
        const method = n.expression.name.text;

        if (ts.isIdentifier(obj) && (obj.text === "Result" || obj.text === "R")) {
          if (method === "ok" && n.arguments.length >= 1) {
            const visitedValue = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteOk(ctx, visitedValue);
          }
          if (method === "err" && n.arguments.length >= 1) {
            const visitedError = ts.visitNode(n.arguments[0], visit) as ts.Expression;
            return algebra.rewriteErr(ctx, visitedError);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Node;
}

// ---------------------------------------------------------------------------
// Return-type-driven specialization entry point
// ---------------------------------------------------------------------------

export function tryReturnTypeDrivenSpecialize(
  ctx: MacroContextImpl,
  verbose: boolean,
  specCache: SpecializationCache,
  node: ts.CallExpression
): ts.Expression | undefined {
  let fnType: ts.Type;
  try {
    fnType = ctx.typeChecker.getTypeAtLocation(node.expression);
  } catch {
    return undefined;
  }
  const callSigs = fnType.getCallSignatures();
  if (!callSigs.length) return undefined;

  const returnType = callSigs[0].getReturnType();

  const returnTypeName = getTypeName(ctx.typeChecker, returnType);
  if (
    returnTypeName !== "Result" &&
    returnTypeName !== "Either" &&
    returnTypeName !== "Validation"
  ) {
    return undefined;
  }

  const contextualType = getContextualTypeForCall(ctx.typeChecker, node);
  if (!contextualType) {
    return undefined;
  }

  const targetTypeName = getTypeName(ctx.typeChecker, contextualType);
  if (!targetTypeName) {
    return undefined;
  }

  if (returnTypeName === targetTypeName) {
    return undefined;
  }

  const algebra = getResultAlgebra(targetTypeName);
  if (!algebra) {
    return undefined;
  }

  const fnName = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : "<anonymous>";

  if (verbose) {
    console.log(
      `[typesugar] Return-type-driven specialization: ${fnName} from ${returnTypeName ?? "Result"} to ${targetTypeName}`
    );
  }

  const fnBody = resolveAutoSpecFunctionBody(ctx.typeChecker, node.expression);
  if (!fnBody) {
    return undefined;
  }

  let fnSymbolId = fnName;
  try {
    const fnSymbol = ctx.typeChecker.getSymbolAtLocation(node.expression);
    if (fnSymbol) {
      fnSymbolId = (fnSymbol as unknown as { id?: number }).id?.toString() ?? fnName;
    }
  } catch {
    // Use fnName as fallback
  }
  const cacheKey = SpecializationCache.computeKey(fnSymbolId, [algebra.name]);

  const cachedEntry = specCache.get(cacheKey);
  if (cachedEntry) {
    if (verbose) {
      console.log(
        `[typesugar] Reusing cached result-type specialization: ${cachedEntry.ident.text}`
      );
    }
    return ctx.factory.createCallExpression(
      cachedEntry.ident,
      node.typeArguments,
      Array.from(node.arguments)
    );
  }

  const specialized = specializeForResultAlgebra(ctx, fnBody, algebra);
  if (!specialized) {
    return undefined;
  }

  const hoistedIdent = SpecializationCache.generateHoistedName(fnName, [algebra.name], ctx.hygiene);
  const hoistedDecl = createHoistedSpecialization(ctx.factory, hoistedIdent, specialized);

  specCache.set(cacheKey, hoistedIdent, hoistedDecl);

  if (verbose) {
    console.log(`[typesugar] Created hoisted result-type specialization: ${hoistedIdent.text}`);
  }

  return ctx.factory.createCallExpression(
    hoistedIdent,
    node.typeArguments,
    Array.from(node.arguments)
  );
}

// ---------------------------------------------------------------------------
// Derived instance call inlining (Wave 4 — PEP-019)
// ---------------------------------------------------------------------------

const MAX_RECURSIVE_INLINE_DEPTH = 10;

/**
 * Try to inline a direct method call on a known typeclass instance.
 *
 * Handles patterns like:
 *   eqPoint.eq(p1, p2)  → p1.x === p2.x && p1.y === p2.y
 *   showUser.show(u)     → `User(name = ${u.name}, age = ${u.age})`
 *
 * After initial inlining, recursively resolves nested instance calls
 * (e.g., eqNumber.eq(a.x, b.x) → a.x === b.x).
 */
export function tryInlineDerivedInstanceCall(
  ctx: MacroContextImpl,
  node: ts.CallExpression,
  dceTracker: DerivedInstanceDCETracker | undefined
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ts.isIdentifier(node.expression.expression)) return undefined;

  const instanceName = node.expression.expression.text;
  const methodName = node.expression.name.text;

  let methodMap = getInstanceOrIntrinsicMethods(instanceName);

  if (!methodMap) {
    methodMap = tryExtractInstanceFromSource(ctx, node.expression.expression);
  }

  if (!methodMap) return undefined;

  const method = methodMap.methods.get(methodName);
  if (!method) return undefined;

  const inlined = inlineMethod(ctx, method, Array.from(node.arguments));
  if (!inlined) return undefined;

  if (dceTracker) {
    dceTracker.recordInlinedUse(instanceName);
  }

  const result = recursivelyInlineInstanceCalls(ctx, inlined, 0);

  return preserveSourceMap(result, node);
}

/**
 * Recursively inline nested instance method calls within an expression.
 *
 * After the top-level inline (e.g., eqPoint.eq → body with eqNumber.eq calls),
 * this walks the result and inlines any remaining known instance calls.
 */
function recursivelyInlineInstanceCalls(
  ctx: MacroContextImpl,
  node: ts.Expression,
  depth: number
): ts.Expression {
  if (depth >= MAX_RECURSIVE_INLINE_DEPTH) return node;

  function visit(n: ts.Node): ts.Node {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression)
    ) {
      const instName = n.expression.expression.text;
      const methName = n.expression.name.text;

      const methodMap = getInstanceOrIntrinsicMethods(instName);
      if (methodMap) {
        const method = methodMap.methods.get(methName);
        if (method) {
          const inlined = inlineMethod(ctx, method, Array.from(n.arguments));
          if (inlined) {
            const deeper = recursivelyInlineInstanceCalls(ctx, inlined, depth + 1);
            return ts.visitEachChild(deeper, visit, ctx.transformContext);
          }
        }
      }
    }

    return ts.visitEachChild(n, visit, ctx.transformContext);
  }

  return ts.visitNode(node, visit) as ts.Expression;
}

// ---------------------------------------------------------------------------
// Derived Instance Dead Code Elimination (DCE) Tracker
// ---------------------------------------------------------------------------

/**
 * Tracks usage of derived instance variables across a file.
 *
 * When all uses of a derived instance are inlined at their call sites,
 * the instance declaration itself becomes dead code and can be removed
 * along with its runtime registration call.
 */
export class DerivedInstanceDCETracker {
  /** Instance names that had method calls inlined */
  private inlinedUses = new Map<string, number>();

  /** Instance names referenced in non-inlineable positions (passed as values) */
  private valueRefs = new Set<string>();

  /** Instance variable declarations (for removal) */
  private declarations = new Map<string, ts.VariableStatement>();

  /** Runtime registration calls (for removal) */
  private registrationCalls = new Map<string, ts.ExpressionStatement>();

  recordInlinedUse(instanceName: string): void {
    this.inlinedUses.set(instanceName, (this.inlinedUses.get(instanceName) ?? 0) + 1);
  }

  recordValueRef(instanceName: string): void {
    this.valueRefs.add(instanceName);
  }

  trackDeclaration(instanceName: string, stmt: ts.VariableStatement): void {
    this.declarations.set(instanceName, stmt);
  }

  trackRegistrationCall(instanceName: string, stmt: ts.ExpressionStatement): void {
    this.registrationCalls.set(instanceName, stmt);
  }

  /**
   * Check if an instance can be eliminated (all uses were inlined).
   */
  canEliminate(instanceName: string): boolean {
    return this.inlinedUses.has(instanceName) && !this.valueRefs.has(instanceName);
  }

  /**
   * Get the set of statements to remove from the file.
   */
  getStatementsToRemove(): Set<ts.Statement> {
    const toRemove = new Set<ts.Statement>();

    for (const [name] of this.inlinedUses) {
      if (this.canEliminate(name)) {
        const decl = this.declarations.get(name);
        if (decl) toRemove.add(decl);
        const regCall = this.registrationCalls.get(name);
        if (regCall) toRemove.add(regCall);
      }
    }

    return toRemove;
  }

  /**
   * Get names of instances that were fully inlined and can be eliminated.
   */
  getEliminatedNames(): string[] {
    const names: string[] = [];
    for (const [name] of this.inlinedUses) {
      if (this.canEliminate(name)) {
        names.push(name);
      }
    }
    return names;
  }
}

/**
 * Scan a statement to detect derived instance declarations and registration calls.
 *
 * Derived instances follow the pattern:
 *   const eqPoint: Eq<Point> = /*#__PURE__*\/ { eq: ..., neq: ... };
 *   /*#__PURE__*\/ Eq.registerInstance<Point>("Point", eqPoint);
 */
export function scanForDerivedInstanceDeclarations(
  stmt: ts.Statement,
  dceTracker: DerivedInstanceDCETracker
): void {
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        const name = decl.name.text;
        if (isRegisteredInstance(name)) {
          dceTracker.trackDeclaration(name, stmt);
        }
      }
    }
  }

  if (
    ts.isExpressionStatement(stmt) &&
    ts.isCallExpression(stmt.expression) &&
    ts.isPropertyAccessExpression(stmt.expression.expression)
  ) {
    const propAccess = stmt.expression.expression;
    if (propAccess.name.text === "registerInstance" && stmt.expression.arguments.length >= 2) {
      const lastArg = stmt.expression.arguments[stmt.expression.arguments.length - 1];
      if (ts.isIdentifier(lastArg)) {
        dceTracker.trackRegistrationCall(lastArg.text, stmt);
      }
    }
  }
}

/**
 * Check if an identifier reference to a known instance is a non-inlineable use.
 *
 * Non-inlineable uses include:
 * - Passing the instance as a function argument: map(xs, eqPoint)
 * - Assigning to a variable: const eq = eqPoint
 * - Property access that isn't a method call: eqPoint.eq (without calling it)
 */
export function checkForValueRef(node: ts.Identifier, dceTracker: DerivedInstanceDCETracker): void {
  const name = node.text;
  if (!isRegisteredInstance(name)) return;

  const parent = node.parent;
  if (!parent) return;

  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
    const grandparent = parent.parent;
    if (grandparent && ts.isCallExpression(grandparent) && grandparent.expression === parent) {
      return;
    }
    dceTracker.recordValueRef(name);
    return;
  }

  if (ts.isCallExpression(parent)) {
    if (ts.isPropertyAccessExpression(parent.expression) && parent.expression.expression === node) {
      return;
    }
  }

  if (
    ts.isExpressionStatement(parent) &&
    ts.isCallExpression(parent.expression) &&
    ts.isPropertyAccessExpression(parent.expression.expression) &&
    parent.expression.expression.name.text === "registerInstance"
  ) {
    return;
  }

  const isRegCallArg =
    ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === "registerInstance";
  if (isRegCallArg) {
    return;
  }

  dceTracker.recordValueRef(name);
}

// ---------------------------------------------------------------------------
// Post-pass DCE for derived instances
// ---------------------------------------------------------------------------

/**
 * Eliminate derived instance declarations that have no remaining references
 * after all call-site inlining is complete.
 *
 * Scans the transformed statements for:
 * 1. Derived instance declarations: `const eqPoint = { ... }`
 * 2. Registration calls: `Eq.registerInstance("Point", eqPoint)`
 *
 * If an instance variable has no references outside its own declaration
 * and registration call, both statements are removed.
 */
export function eliminateDeadDerivedInstances(
  statements: ts.Statement[],
  inlinedInstanceNames: ReadonlySet<string>,
  verbose: boolean
): ts.Statement[] {
  if (inlinedInstanceNames.size === 0) return statements;

  const instanceDecls = new Map<string, { declIndex: number; regIndex?: number }>();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          inlinedInstanceNames.has(decl.name.text)
        ) {
          instanceDecls.set(decl.name.text, { declIndex: i });
        }
      }
    }

    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isPropertyAccessExpression(stmt.expression.expression) &&
      stmt.expression.expression.name.text === "registerInstance" &&
      stmt.expression.arguments.length >= 2
    ) {
      const lastArg = stmt.expression.arguments[stmt.expression.arguments.length - 1];
      if (ts.isIdentifier(lastArg) && instanceDecls.has(lastArg.text)) {
        instanceDecls.get(lastArg.text)!.regIndex = i;
      }
    }
  }

  if (instanceDecls.size === 0) return statements;

  const toRemove = new Set<number>();

  for (const [name, { declIndex, regIndex }] of instanceDecls) {
    let hasExternalRef = false;

    for (let i = 0; i < statements.length; i++) {
      if (i === declIndex || i === regIndex) continue;
      if (containsIdentifierRef(statements[i], name)) {
        hasExternalRef = true;
        break;
      }
    }

    if (!hasExternalRef) {
      toRemove.add(declIndex);
      if (regIndex !== undefined) toRemove.add(regIndex);
      if (verbose) {
        console.log(`[typesugar] DCE: removed fully-inlined instance '${name}'`);
      }
    }
  }

  if (toRemove.size === 0) return statements;

  return statements.filter((_, i) => !toRemove.has(i));
}

function containsIdentifierRef(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;

  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsIdentifierRef(child, name)) {
      found = true;
    }
  });

  return found;
}
