/**
 * Extension method rewriting, operator overloading, HKT transformation,
 * tagged template macros, type macros, and specialize-extension handling.
 *
 * Each function takes explicit parameters instead of relying on class state,
 * so the MacroTransformer methods become thin delegation wrappers.
 */

import * as ts from "typescript";

import {
  getOperatorString,
  getSyntaxForOperator,
  findInstance,
  getInstanceMethods,
  createSpecializedFunction,
  isKindAnnotation,
  transformHKTDeclaration,
  instanceRegistry,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  findStandaloneExtension,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
  type StandaloneExtensionInfo,
  ExpressionMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  globalResolutionScope,
  isInOptedOutScope,
  preserveSourceMap,
  findTypeRewrite,
  getAllTypeRewrites,
  type TypeRewriteEntry,
  type MethodInlinePattern,
  extractTypeArgumentsContent,
  stripTypeArguments,
} from "@typesugar/core";

import { createMacroErrorExpression, type VisitFn } from "./transformer-utils.js";

// ---------------------------------------------------------------------------
// Callback types for cross-cutting concerns
// ---------------------------------------------------------------------------

export type ResolveMacroFn = (
  node: ts.Node,
  macroName: string,
  kind: MacroDefinition["kind"]
) => MacroDefinition | undefined;

export type ResolveExtensionFn = (
  node: ts.CallExpression,
  methodName: string,
  receiverType: ts.Type
) => StandaloneExtensionInfo | undefined;

// ---------------------------------------------------------------------------
// Tagged template expansion
// ---------------------------------------------------------------------------

export function tryExpandTaggedTemplate(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TaggedTemplateExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  if (!ts.isIdentifier(node.tag)) return undefined;

  const tagName = node.tag.text;

  const taggedMacro = resolveMacroFromSymbol(node.tag, tagName, "tagged-template") as
    | TaggedTemplateMacroDef
    | undefined;
  if (taggedMacro) {
    if (verbose) {
      console.log(`[typesugar] Expanding tagged template macro: ${tagName}`);
    }

    try {
      if (taggedMacro.validate && !taggedMacro.validate(ctx, node)) {
        ctx.reportError(node, `Tagged template validation failed for '${tagName}'`);
        return createMacroErrorExpression(
          ctx.factory,
          `typesugar: tagged template '${tagName}' validation failed`
        );
      }

      const result = ctx.hygiene.withScope(() => taggedMacro.expand(ctx, node));
      if (result === (node as ts.Node)) {
        return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
      }
      const visited = ts.visitNode(result, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    } catch (error) {
      ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
      return createMacroErrorExpression(
        ctx.factory,
        `typesugar: tagged template '${tagName}' expansion failed: ${error}`
      );
    }
  }

  const exprMacro = resolveMacroFromSymbol(node.tag, tagName, "expression") as
    | ExpressionMacro
    | undefined;
  if (!exprMacro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding tagged template via expression macro: ${tagName}`);
  }

  try {
    const result = ctx.hygiene.withScope(() =>
      exprMacro.expand(ctx, node as unknown as ts.CallExpression, [
        node.template as unknown as ts.Expression,
      ])
    );
    if (result === (node as unknown as ts.Expression)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.Expression;
    }
    const visited = ts.visitNode(result, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Tagged template macro expansion failed: ${error}`);
    return createMacroErrorExpression(
      ctx.factory,
      `typesugar: tagged template '${tagName}' expansion failed: ${error}`
    );
  }
}

// ---------------------------------------------------------------------------
// Type macro expansion
// ---------------------------------------------------------------------------

export function tryExpandTypeMacro(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  node: ts.TypeReferenceNode
): ts.TypeNode | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  let macroName: string | undefined;
  let identNode: ts.Node | undefined;

  if (ts.isIdentifier(node.typeName)) {
    macroName = node.typeName.text;
    identNode = node.typeName;
  } else if (ts.isQualifiedName(node.typeName)) {
    if (
      ts.isIdentifier(node.typeName.left) &&
      (node.typeName.left.text === "typesugar" || node.typeName.left.text === "typemacro")
    ) {
      macroName = node.typeName.right.text;
      identNode = node.typeName;
    }
  }

  if (!macroName || !identNode) return undefined;

  const macro = resolveMacroFromSymbol(identNode, macroName, "type") as TypeMacro | undefined;
  if (!macro) return undefined;

  if (verbose) {
    console.log(`[typesugar] Expanding type macro: ${macroName}`);
  }

  try {
    const typeArgs = node.typeArguments ? Array.from(node.typeArguments) : [];
    const result = ctx.hygiene.withScope(() => macro.expand(ctx, node, typeArgs));
    if (result === (node as ts.Node)) {
      return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
    }
    const visited = ts.visitNode(result, visit) as ts.TypeNode;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type macro expansion failed: ${error}`);
    return ts.visitEachChild(node, visit, ctx.transformContext) as ts.TypeNode;
  }
}

// ---------------------------------------------------------------------------
// fn.specialize(dict) extension
// ---------------------------------------------------------------------------

export function tryRewriteSpecializeExtension(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  const propAccess = node.expression as ts.PropertyAccessExpression;
  const fnExpr = propAccess.expression;

  const fnType = ctx.typeChecker.getTypeAtLocation(fnExpr);
  const callSignatures = fnType.getCallSignatures();
  if (callSignatures.length === 0) {
    return undefined;
  }

  if (node.arguments.length === 0) {
    ctx.reportError(node, "fn.specialize() requires at least one typeclass instance argument");
    return node;
  }

  const dictArgs = Array.from(node.arguments);

  if (verbose) {
    const fnName = ts.isIdentifier(fnExpr) ? fnExpr.text : "<expr>";
    const dictNames = dictArgs.map((d) => (ts.isIdentifier(d) ? d.text : "<expr>")).join(", ");
    console.log(`[typesugar] Rewriting ${fnName}.specialize(${dictNames})`);
  }

  const specialized = createSpecializedFunction(ctx, {
    fnExpr,
    dictExprs: dictArgs,
    callExpr: node,
    suppressWarnings: false,
  });

  try {
    const visited = ts.visitNode(specialized, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `specialize() extension method failed: ${error}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Extension method rewriting
// ---------------------------------------------------------------------------

export function tryRewriteExtensionMethod(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  resolveMacroFromSymbol: ResolveMacroFn,
  resolveExtensionFromImports: ResolveExtensionFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const propAccess = node.expression as ts.PropertyAccessExpression;
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  if (ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression)) {
    const calleeName = receiver.expression.text;
    const calleeMacro = resolveMacroFromSymbol(receiver.expression, calleeName, "expression");
    if (calleeMacro) {
      return undefined;
    }
  }

  const receiverType = ctx.typeChecker.getTypeAtLocation(receiver);

  if (!ctx.isTypeReliable(receiverType)) {
    const couldBeExtension = getAllStandaloneExtensions().some((e) => e.methodName === methodName);
    if (couldBeExtension) {
      ctx.reportWarning(
        node,
        `typesugar skipped extension method '${methodName}' rewrite because the receiver type could not be resolved. Fix upstream type errors first.`
      );
    }
    return undefined;
  }

  const existingProp = receiverType.getProperty(methodName);

  let forceRewrite = false;
  if (existingProp) {
    const potentialExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (potentialExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      const isSameObject = receiverText && potentialExt.qualifier === receiverText;
      if (!isSameObject) {
        forceRewrite = true;
      }
    }
  }

  if (existingProp && !forceRewrite) {
    return undefined;
  }

  const typeName = ctx.typeChecker.typeToString(receiverType);

  let standaloneExt = findStandaloneExtension(methodName, typeName);
  if (!standaloneExt) {
    const baseTypeName = stripTypeArguments(typeName);
    if (baseTypeName !== typeName) {
      standaloneExt = findStandaloneExtension(methodName, baseTypeName);
    }
  }

  if (!standaloneExt) {
    standaloneExt = resolveExtensionFromImports(node, methodName, receiverType);
    if (standaloneExt) {
      const receiverText = ts.isIdentifier(receiver) ? receiver.text : null;
      if (receiverText && standaloneExt.qualifier === receiverText) {
        standaloneExt = undefined;
      }
    }
  }

  if (!standaloneExt) {
    return undefined;
  }

  if (verbose) {
    const qual = standaloneExt.qualifier
      ? `${standaloneExt.qualifier}.${standaloneExt.methodName}`
      : standaloneExt.methodName;
    console.log(
      `[typesugar] Rewriting standalone extension: ${typeName}.${methodName}() → ${qual}(...)`
    );
  }

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    standaloneExt,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Extension method rewrite failed: ${error}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// HKT transformation
// ---------------------------------------------------------------------------

export function tryTransformHKTDeclaration(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined {
  const typeParams = node.typeParameters;
  if (!typeParams) return undefined;

  let hasKA = false;
  for (const param of typeParams) {
    if (isKindAnnotation(param)) {
      hasKA = true;
      break;
    }
  }

  if (!hasKA) return undefined;

  if (verbose) {
    const name = node.name?.text ?? "Anonymous";
    console.log(`[typesugar] Transforming HKT declaration: ${name}`);
  }

  try {
    const transformed = transformHKTDeclaration(ctx, node);
    const visited = ts.visitEachChild(transformed, visit, ctx.transformContext) as
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `HKT transformation failed: ${error}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Operator rewriting helpers
// ---------------------------------------------------------------------------

export function inferIdentifierResultType(
  ctx: MacroContextImpl,
  node: ts.Identifier
): string | undefined {
  const symbol = ctx.typeChecker.getSymbolAtLocation(node);
  if (!symbol) return undefined;

  const decls = symbol.getDeclarations();
  if (!decls || decls.length === 0) return undefined;

  for (const decl of decls) {
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      let init: ts.Expression = decl.initializer;
      while (ts.isParenthesizedExpression(init)) {
        init = init.expression;
      }

      if (ts.isBinaryExpression(init)) {
        const inferred = inferBinaryExprResultType(ctx, init);
        if (inferred) return inferred;
      }
    }
  }

  return undefined;
}

/**
 * Cache for union type alias member lookups. Maps a type alias name to
 * the set of base member names in its union, or null if not found/not a union.
 * Automatically cleared when the program instance changes.
 */
const unionMemberCache = new Map<string, Set<string> | null>();
let unionMemberCacheProgram: ts.Program | undefined;

function getUnionMembers(ctx: MacroContextImpl, candidateBase: string): Set<string> | null {
  if (ctx.program !== unionMemberCacheProgram) {
    unionMemberCache.clear();
    unionMemberCacheProgram = ctx.program;
  }
  if (unionMemberCache.has(candidateBase)) {
    return unionMemberCache.get(candidateBase)!;
  }

  let result: Set<string> | null = null;
  for (const sf of ctx.program.getSourceFiles()) {
    for (const stmt of sf.statements) {
      if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === candidateBase) {
        const aliasType = ctx.typeChecker.getTypeAtLocation(stmt.type);
        if (aliasType.isUnion?.()) {
          result = new Set<string>();
          for (const unionMember of aliasType.types) {
            const memberName = ctx.typeChecker.typeToString(unionMember);
            result.add(stripTypeArguments(memberName));
          }
        }
        break;
      }
    }
    if (result !== null) break;
  }

  unionMemberCache.set(candidateBase, result);
  return result;
}

/**
 * Search for a union type alias whose members include the operand's base type.
 * This handles the case where e.g. `Constant<T>` is a member of `Expression<T>`
 * and the Numeric instance is registered for `Expression`, not `Constant`.
 * Includes declaration files so that types from compiled packages are found.
 * Uses a cache to avoid repeated file scanning.
 */
function findUnionMemberInstance(
  ctx: MacroContextImpl,
  candidate: { typeclassName: string; forType: string; instanceName: string; derived: boolean },
  candidateBase: string,
  candidateArg: string,
  baseTypeName: string,
  typeArg: string
): typeof candidate | undefined {
  const members = getUnionMembers(ctx, candidateBase);
  if (
    members?.has(baseTypeName) &&
    (candidateArg === typeArg || candidateArg === typeArg.split("<")[0] || !candidateArg)
  ) {
    return candidate;
  }
  return undefined;
}

export function inferBinaryExprResultType(
  ctx: MacroContextImpl,
  node: ts.BinaryExpression
): string | undefined {
  const opString = getOperatorString(node.operatorToken.kind);
  if (!opString) return undefined;

  const entries = getSyntaxForOperator(opString);
  if (!entries || entries.length === 0) return undefined;

  let unwrappedLeft: ts.Expression = node.left;
  while (ts.isParenthesizedExpression(unwrappedLeft)) {
    unwrappedLeft = unwrappedLeft.expression;
  }

  let leftTypeName: string;
  if (ts.isBinaryExpression(unwrappedLeft)) {
    const inferred = inferBinaryExprResultType(ctx, unwrappedLeft);
    leftTypeName =
      inferred ?? ctx.typeChecker.typeToString(ctx.typeChecker.getTypeAtLocation(unwrappedLeft));
  } else {
    leftTypeName = ctx.typeChecker.typeToString(ctx.typeChecker.getTypeAtLocation(node.left));
  }

  const baseTypeName = stripTypeArguments(leftTypeName);
  const typeArg = extractTypeArgumentsContent(leftTypeName) ?? "";

  const currentFileName = ctx.sourceFile.fileName;
  for (const entry of entries) {
    let inst =
      findInstance(entry.typeclass, leftTypeName, currentFileName) ??
      findInstance(entry.typeclass, baseTypeName, currentFileName);

    if (!inst) {
      const candidateInstances = instanceRegistry.filter(
        (i) => i.typeclassName === entry.typeclass
      );
      for (const candidate of candidateInstances) {
        const candidateBase = stripTypeArguments(candidate.forType);
        const candidateArg = extractTypeArgumentsContent(candidate.forType) ?? "";

        inst = findUnionMemberInstance(
          ctx,
          candidate,
          candidateBase,
          candidateArg,
          baseTypeName,
          typeArg
        );
        if (inst) break;
      }
    }

    if (inst) {
      return inst.forType;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Operator rewriting entry point
// ---------------------------------------------------------------------------

export function tryRewriteTypeclassOperator(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.BinaryExpression
): ts.Expression | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "extensions")) {
    return undefined;
  }

  const opString = getOperatorString(node.operatorToken.kind);
  if (!opString) return undefined;

  const entries = getSyntaxForOperator(opString);
  if (!entries || entries.length === 0) return undefined;

  let unwrappedLeft: ts.Expression = node.left;
  while (ts.isParenthesizedExpression(unwrappedLeft)) {
    unwrappedLeft = unwrappedLeft.expression;
  }

  let typeName: string;
  if (ts.isBinaryExpression(unwrappedLeft)) {
    const inferred = inferBinaryExprResultType(ctx, unwrappedLeft);
    typeName =
      inferred ?? ctx.typeChecker.typeToString(ctx.typeChecker.getTypeAtLocation(unwrappedLeft));
  } else if (ts.isIdentifier(unwrappedLeft)) {
    const inferred = inferIdentifierResultType(ctx, unwrappedLeft);
    typeName =
      inferred ?? ctx.typeChecker.typeToString(ctx.typeChecker.getTypeAtLocation(node.left));
  } else {
    const leftType = ctx.typeChecker.getTypeAtLocation(node.left);
    typeName = ctx.typeChecker.typeToString(leftType);
  }
  const baseTypeName = stripTypeArguments(typeName);
  const typeArg = extractTypeArgumentsContent(typeName) ?? "";

  const PRIMITIVE_TYPES = new Set([
    "number",
    "string",
    "boolean",
    "bigint",
    "null",
    "undefined",
    "any",
    "unknown",
  ]);
  if (PRIMITIVE_TYPES.has(baseTypeName)) {
    return undefined;
  }

  let matchedEntry: { typeclass: string; method: string } | undefined;
  let matchedInstance:
    | { typeclassName: string; forType: string; instanceName: string; derived: boolean }
    | undefined;

  const sfn = ctx.sourceFile.fileName;
  for (const entry of entries) {
    let inst =
      findInstance(entry.typeclass, typeName, sfn) ??
      findInstance(entry.typeclass, baseTypeName, sfn);

    if (!inst) {
      const candidateInstances = instanceRegistry.filter(
        (i) => i.typeclassName === entry.typeclass
      );
      for (const candidate of candidateInstances) {
        const candidateBase = stripTypeArguments(candidate.forType);
        const candidateArg = extractTypeArgumentsContent(candidate.forType) ?? "";

        inst = findUnionMemberInstance(
          ctx,
          candidate,
          candidateBase,
          candidateArg,
          baseTypeName,
          typeArg
        );
        if (inst) break;
      }
    }

    if (inst) {
      if (matchedEntry) {
        ctx.reportError(
          node,
          `Ambiguous operator '${opString}' for type '${typeName}': ` +
            `both ${matchedEntry.typeclass}.${matchedEntry.method} and ` +
            `${entry.typeclass}.${entry.method} apply. ` +
            `Use explicit method calls to disambiguate.`
        );
        return undefined;
      }
      matchedEntry = entry;
      matchedInstance = inst;
    }
  }

  if (!matchedEntry || !matchedInstance) {
    return undefined;
  }

  if (verbose) {
    console.log(
      `[typesugar] Rewriting operator: ${typeName} ${opString} → ` +
        `${matchedEntry.typeclass}.${matchedEntry.method}()`
    );
  }

  const factory = ctx.factory;
  const left = ts.visitNode(node.left, visit) as ts.Expression;
  const right = ts.visitNode(node.right, visit) as ts.Expression;

  const dictMethodMap = getInstanceMethods(matchedInstance.instanceName);
  if (dictMethodMap) {
    const dictMethod = dictMethodMap.methods.get(matchedEntry.method);
    if (dictMethod && dictMethod.source) {
      // TODO: Full inlining will be added in Step 6 (auto-specialization).
    }
  }

  const methodAccess = factory.createPropertyAccessExpression(
    factory.createIdentifier(matchedInstance.instanceName),
    matchedEntry.method
  );
  const rewritten = factory.createCallExpression(methodAccess, undefined, [left, right]);
  return preserveSourceMap(rewritten, node);
}

// ---------------------------------------------------------------------------
// @opaque type rewrite — method, constructor, and accessor erasure (PEP-012)
// ---------------------------------------------------------------------------

/**
 * Resolve the type rewrite registry key for a TypeScript type.
 *
 * `typeToString` output is presentation-dependent — it can emit qualified names
 * like `import("./foo").MyType` depending on the compilation context. This
 * helper tries multiple strategies to find the registered name:
 *
 * 1. Direct `typeToString` result (fast path, covers the common case)
 * 2. `type.symbol?.name` / `type.aliasSymbol?.name` (works for cross-module types)
 * 3. Strip `import(...)` prefix from the `typeToString` output
 */
function resolveTypeRewriteName(typeChecker: ts.TypeChecker, type: ts.Type): string | undefined {
  // Fast path: direct string match (preserves existing behavior)
  const typeStr = typeChecker.typeToString(type);
  if (findTypeRewrite(typeStr)) return typeStr;

  // Try the symbol name — avoids presentation-dependent formatting
  const symbolName = type.symbol?.name ?? type.aliasSymbol?.name;
  if (symbolName && symbolName !== typeStr && findTypeRewrite(symbolName)) return symbolName;

  // Strip import("...").TypeName prefix that typeToString sometimes emits
  const importMatch = typeStr.match(/^import\([^)]+\)\.(.+)$/);
  if (importMatch && findTypeRewrite(importMatch[1])) return importMatch[1];

  return undefined;
}

function buildConstantExpression(factory: ts.NodeFactory, value: string): ts.Expression {
  switch (value) {
    case "null":
      return factory.createNull();
    case "undefined":
      return factory.createIdentifier("undefined");
    case "true":
      return factory.createTrue();
    case "false":
      return factory.createFalse();
    default: {
      const num = Number(value);
      if (!isNaN(num)) {
        return factory.createNumericLiteral(num);
      }
      if (value.startsWith('"') || value.startsWith("'")) {
        return factory.createStringLiteral(value.slice(1, -1));
      }
      return factory.createIdentifier(value);
    }
  }
}

/** Check if a path is absolute (Unix `/...` or Windows `C:/...` / `C:\...`). Browser-safe. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p);
}

function isWithinSourceModule(filePath: string, sourceModule: string): boolean {
  const normFile = filePath.replace(/\\/g, "/");
  const normModule = sourceModule.replace(/\\/g, "/");
  if (isAbsolutePath(normModule)) {
    return normFile === normModule;
  }
  const modulePath = normModule.replace(/^@/, "");
  const fileNoExt = normFile.replace(/\.[^/.]+$/, "");
  return fileNoExt.endsWith(modulePath) || fileNoExt.endsWith(modulePath + "/index");
}

/**
 * Rewrite a method call on an @opaque type.
 *
 * When a `methodInlines` pattern is registered for the method, the call is
 * inlined to a null-check expression (e.g., `x.map(fn)` → `x != null ? fn(x) : null`).
 * When the receiver is a literal `null`, the expression is constant-folded.
 * Falls back to standalone function call rewriting when no inline pattern exists.
 */
export function tryRewriteOpaqueMethodCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;

  const propAccess = node.expression;
  const methodName = propAccess.name.text;
  const receiver = propAccess.expression;

  let receiverType: ts.Type;
  try {
    receiverType = ctx.typeChecker.getTypeAtLocation(receiver);
  } catch {
    // TypeChecker may throw on unresolvable receiver expressions — skip type rewrite
    return undefined;
  }
  if (!ctx.isTypeReliable(receiverType)) return undefined;

  const typeName = resolveTypeRewriteName(ctx.typeChecker, receiverType);
  if (!typeName) return undefined;
  const entry = findTypeRewrite(typeName)!;

  if (entry.transparent && entry.sourceModule) {
    if (isWithinSourceModule(ctx.sourceFile.fileName, entry.sourceModule)) {
      return undefined;
    }
  }

  const methods = entry.methods;
  if (!methods) return undefined;

  const standaloneFnName = methods.get(methodName);
  if (!standaloneFnName) return undefined;

  const inlinePattern = entry.methodInlines?.get(methodName);
  if (inlinePattern) {
    const visitedReceiver = ts.visitNode(receiver, visit) as ts.Expression;
    const visitedArgs = node.arguments.map((a) => ts.visitNode(a, visit) as ts.Expression);
    const result = buildOpaqueInlineExpression(
      ctx.factory,
      inlinePattern,
      visitedReceiver,
      visitedArgs,
      verbose,
      typeName,
      methodName
    );
    if (result) return preserveSourceMap(result, node);
  }

  if (verbose) {
    console.log(`[typesugar] Type rewrite: ${typeName}.${methodName}() → ${standaloneFnName}(...)`);
  }

  const ext: StandaloneExtensionInfo = {
    methodName: standaloneFnName,
    forType: entry.typeName,
  };

  const rewritten = buildStandaloneExtensionCall(
    ctx.factory,
    ext,
    receiver,
    Array.from(node.arguments)
  );

  try {
    const visited = ts.visitNode(rewritten, visit) as ts.Expression;
    return preserveSourceMap(visited, node);
  } catch (error) {
    ctx.reportError(node, `Type rewrite method erasure failed: ${error}`);
    return undefined;
  }
}

function isNullLiteral(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword;
}

function isSimpleExpression(node: ts.Expression): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    isNullLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

/**
 * Build an inlined expression for an @opaque method call.
 * When the receiver is a literal `null`, constant-folds the result.
 * When the receiver is complex (not a simple identifier/literal), wraps in
 * an IIFE to avoid evaluating the receiver multiple times.
 */
function buildOpaqueInlineExpression(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[],
  verbose: boolean,
  typeName: string,
  methodName: string
): ts.Expression | undefined {
  if (isNullLiteral(receiver)) {
    if (verbose) {
      console.log(`[typesugar] Opaque inline (constant-folded null): ${typeName}.${methodName}()`);
    }
    return constantFoldNull(factory, pattern, args);
  }

  if (isKnownNonNullLiteral(receiver)) {
    if (verbose) {
      console.log(
        `[typesugar] Opaque inline (constant-folded non-null): ${typeName}.${methodName}()`
      );
    }
    return constantFoldNonNull(factory, pattern, receiver, args);
  }

  if (verbose) {
    console.log(`[typesugar] Opaque inline (inlined): ${typeName}.${methodName}()`);
  }

  if (isSimpleExpression(receiver)) {
    return buildInlineTernary(factory, pattern, receiver, args);
  }

  // Complex receiver: wrap in IIFE to evaluate once
  // ((_opt) => _opt != null ? fn(_opt) : null)(receiver)
  const param = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createIdentifier("_opt"),
    undefined,
    undefined,
    undefined
  );
  const optRef = factory.createIdentifier("_opt");
  const body = buildInlineTernary(factory, pattern, optRef, args);
  if (!body) return undefined;

  const arrow = factory.createArrowFunction(
    undefined,
    undefined,
    [param],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
  return factory.createCallExpression(factory.createParenthesizedExpression(arrow), undefined, [
    receiver,
  ]);
}

function isKnownNonNullLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * When the receiver is a known non-null literal (string, number, boolean),
 * the null check can be eliminated entirely.
 */
function constantFoldNonNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      return fn ? factory.createCallExpression(fn, undefined, [receiver]) : undefined;
    }
    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createCallExpression(pred, undefined, [receiver]),
        undefined,
        receiver,
        undefined,
        factory.createNull()
      );
    }
    case "null-coalesce-call":
    case "null-coalesce-value":
      return receiver;
    case "fold": {
      const onSome = args[1];
      return onSome ? factory.createCallExpression(onSome, undefined, [receiver]) : undefined;
    }
  }
}

function constantFoldNull(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  args: ts.Expression[]
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "null-check-apply":
    case "null-check-predicate":
      return factory.createNull();
    case "null-coalesce-call": {
      const defaultFn = args[0];
      return defaultFn ? factory.createCallExpression(defaultFn, undefined, []) : undefined;
    }
    case "null-coalesce-value":
      return args[0];
    case "fold": {
      const onNone = args[0];
      return onNone ? factory.createCallExpression(onNone, undefined, []) : undefined;
    }
  }
}

function buildInlineTernary(
  factory: ts.NodeFactory,
  pattern: MethodInlinePattern,
  receiver: ts.Expression,
  args: ts.Expression[]
): ts.Expression | undefined {
  const nullExpr = factory.createNull();
  const notNull = factory.createBinaryExpression(
    receiver,
    ts.SyntaxKind.ExclamationEqualsToken,
    nullExpr
  );

  switch (pattern.kind) {
    case "null-check-apply": {
      const fn = args[0];
      if (!fn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(fn, undefined, [receiver]),
        undefined,
        nullExpr
      );
    }

    case "null-check-predicate": {
      const pred = args[0];
      if (!pred) return undefined;
      return factory.createConditionalExpression(
        factory.createBinaryExpression(
          notNull,
          ts.SyntaxKind.AmpersandAmpersandToken,
          factory.createCallExpression(pred, undefined, [receiver])
        ),
        undefined,
        receiver,
        undefined,
        nullExpr
      );
    }

    case "null-coalesce-call": {
      const defaultFn = args[0];
      if (!defaultFn) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        factory.createCallExpression(defaultFn, undefined, [])
      );
    }

    case "null-coalesce-value": {
      const defaultVal = args[0];
      if (!defaultVal) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        receiver,
        undefined,
        defaultVal
      );
    }

    case "fold": {
      const onNone = args[0];
      const onSome = args[1];
      if (!onNone || !onSome) return undefined;
      return factory.createConditionalExpression(
        notNull,
        undefined,
        factory.createCallExpression(onSome, undefined, [receiver]),
        undefined,
        factory.createCallExpression(onNone, undefined, [])
      );
    }
  }
}

/**
 * Erase an @opaque constructor call: `Some(x)` → `x`, `Left(e)` → literal.
 */
export function tryEraseOpaqueConstructorCall(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.CallExpression
): ts.Expression | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;

  const ctorName = node.expression.text;

  for (const entry of getAllTypeRewrites()) {
    if (!entry.constructors) continue;

    const ctor = entry.constructors.get(ctorName);
    if (!ctor) continue;

    if (entry.transparent && entry.sourceModule) {
      if (isWithinSourceModule(ctx.sourceFile.fileName, entry.sourceModule)) {
        return undefined;
      }
    }

    if (ctor.kind === "identity") {
      if (node.arguments.length !== 1) {
        ctx.reportWarning(
          node,
          `Identity constructor '${ctorName}' expects exactly 1 argument, got ${node.arguments.length}`
        );
        return undefined;
      }

      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(arg) → arg`);
      }

      const arg = node.arguments[0];
      const visited = ts.visitNode(arg, visit) as ts.Expression;
      return preserveSourceMap(visited, node);
    }

    if (ctor.kind === "constant") {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(
        buildConstantExpression(ctx.factory, ctor.value ?? "undefined"),
        node
      );
    }

    if (ctor.kind === "custom" && ctor.value) {
      if (verbose) {
        console.log(`[typesugar] Constructor erasure: ${ctorName}(...) → ${ctor.value}`);
      }
      return preserveSourceMap(ctx.factory.createIdentifier(ctor.value), node);
    }
  }

  return undefined;
}

/**
 * Erase a bare constant constructor reference: `None` → `null`.
 */
export function tryEraseOpaqueConstantRef(
  ctx: MacroContextImpl,
  verbose: boolean,
  node: ts.Identifier
): ts.Expression | undefined {
  const name = node.text;

  if (
    node.parent &&
    ((ts.isVariableDeclaration(node.parent) && node.parent.name === node) ||
      (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) ||
      (ts.isParameter(node.parent) && node.parent.name === node) ||
      (ts.isPropertyDeclaration(node.parent) && node.parent.name === node) ||
      ts.isImportSpecifier(node.parent) ||
      ts.isExportSpecifier(node.parent))
  ) {
    return undefined;
  }

  if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
    return undefined;
  }

  for (const entry of getAllTypeRewrites()) {
    if (!entry.constructors) continue;

    const ctor = entry.constructors.get(name);
    if (!ctor || ctor.kind !== "constant") continue;

    if (entry.transparent && entry.sourceModule) {
      if (isWithinSourceModule(ctx.sourceFile.fileName, entry.sourceModule)) {
        return undefined;
      }
    }

    if (verbose) {
      console.log(`[typesugar] Constant constructor ref erasure: ${name} → ${ctor.value}`);
    }

    return preserveSourceMap(buildConstantExpression(ctx.factory, ctor.value ?? "undefined"), node);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// @opaque type annotation erasure (PEP-019 Wave 1)
// ---------------------------------------------------------------------------

/**
 * Extract an opaque type rewrite entry from a TypeNode (e.g., `Option<Money>`).
 * Returns the entry if the type name is registered in the type rewrite registry.
 */
function getOpaqueEntryFromTypeNode(typeNode: ts.TypeNode): TypeRewriteEntry | undefined {
  if (!ts.isTypeReferenceNode(typeNode)) return undefined;

  const typeName = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : ts.isQualifiedName(typeNode.typeName)
      ? typeNode.typeName.right.text
      : undefined;

  if (!typeName) return undefined;
  return findTypeRewrite(typeName);
}

/**
 * Check if an initializer expression would be erased by opaque constructor
 * erasure for the given type rewrite entry.
 */
function wouldBeOpaqueErased(init: ts.Expression, entry: TypeRewriteEntry): boolean {
  if (!entry.constructors) return false;

  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
    return entry.constructors.has(init.expression.text);
  }

  if (ts.isIdentifier(init)) {
    const ctor = entry.constructors.get(init.text);
    return ctor !== undefined && ctor.kind === "constant";
  }

  return false;
}

/**
 * When a variable declaration has a type annotation referencing an @opaque type
 * and its initializer would be erased by opaque constructor/constant erasure,
 * strip the type annotation to prevent invalid TypeScript output.
 *
 * `const x: Option<Money> = Some(m)` → `const x = m`
 * `const x: Option<Money> = None` → `const x = null`
 */
export function tryStripOpaqueTypeAnnotation(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.VariableDeclaration
): ts.VariableDeclaration | undefined {
  if (!node.type || !node.initializer) return undefined;

  const opaqueEntry = getOpaqueEntryFromTypeNode(node.type);
  if (!opaqueEntry) return undefined;

  // For same-project opaque types (transparent), skip stripping inside
  // the defining module where the implementation uses the raw representation.
  if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
    if (isWithinSourceModule(ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
      return undefined;
    }
  }

  // For library-imported opaque types (non-transparent), the published .d.ts
  // has a type alias (e.g., `type Option<A> = A | null`), so the annotation
  // is valid after constructor erasure — keep it.
  if (!opaqueEntry.transparent) return undefined;

  if (!wouldBeOpaqueErased(node.initializer, opaqueEntry)) return undefined;

  if (verbose) {
    console.log(
      `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from variable declaration`
    );
  }

  const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
  const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

  return preserveSourceMap(
    ctx.factory.updateVariableDeclaration(
      node,
      visitedName,
      node.exclamationToken,
      undefined,
      visitedInit
    ),
    node
  );
}

/**
 * When a function parameter has a type annotation referencing an @opaque type
 * and a default value that would be erased by opaque constructor/constant erasure,
 * strip the type annotation to prevent invalid TypeScript output.
 *
 * `function f(x: Option<Money> = Some(m))` → `function f(x = m)`
 */
export function tryStripOpaqueParamAnnotation(
  ctx: MacroContextImpl,
  verbose: boolean,
  visit: VisitFn,
  node: ts.ParameterDeclaration
): ts.ParameterDeclaration | undefined {
  if (!node.type || !node.initializer) return undefined;

  const opaqueEntry = getOpaqueEntryFromTypeNode(node.type);
  if (!opaqueEntry) return undefined;

  if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
    if (isWithinSourceModule(ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
      return undefined;
    }
  }

  // Library-imported opaque types have erased type aliases — annotation is valid
  if (!opaqueEntry.transparent) return undefined;

  if (!wouldBeOpaqueErased(node.initializer, opaqueEntry)) return undefined;

  if (verbose) {
    console.log(
      `[typesugar] Type annotation erasure: stripping ${opaqueEntry.typeName} from parameter`
    );
  }

  const visitedName = ts.visitNode(node.name, visit) as ts.BindingName;
  const visitedInit = ts.visitNode(node.initializer, visit) as ts.Expression;

  return preserveSourceMap(
    ctx.factory.updateParameterDeclaration(
      node,
      node.modifiers,
      node.dotDotDotToken,
      visitedName,
      node.questionToken,
      undefined,
      visitedInit
    ),
    node
  );
}

/**
 * When a function's return type annotation references an @opaque type
 * and the body contains return statements using erased opaque constructors,
 * strip the return type to prevent invalid TypeScript output.
 *
 * `function findPort(...): Option<number> { return Some(x); }`
 * → `function findPort(...) { return x; }`
 */
export function shouldStripOpaqueReturnType(
  ctx: MacroContextImpl,
  returnType: ts.TypeNode | undefined,
  _body: ts.Block | ts.ConciseBody | undefined
): boolean {
  if (!returnType) return false;

  const opaqueEntry = getOpaqueEntryFromTypeNode(returnType);
  if (!opaqueEntry) return false;

  if (opaqueEntry.transparent && opaqueEntry.sourceModule) {
    if (isWithinSourceModule(ctx.sourceFile.fileName, opaqueEntry.sourceModule)) {
      return false;
    }
  }

  // Library-imported opaque types have erased type aliases — annotation is valid
  if (!opaqueEntry.transparent) return false;

  return true;
}
