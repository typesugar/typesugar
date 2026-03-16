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

  const remainingParams = params.filter((_, i) => !dictParamIndices.has(i));
  const specializedBody = rewriteDictCallsForAutoSpec(ctx, body, dictParamMap);

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
      if (!suppressWarnings) {
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
