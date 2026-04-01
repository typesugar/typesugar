/**
 * JSDoc macro handling, decorator parsing/sorting, and derive expansion.
 *
 * Functions for detecting JSDoc macro tags, synthesizing decorators from
 * JSDoc comments, topologically sorting decorators, expanding derive macros,
 * and extracting type information for derive implementations.
 */

import * as ts from "typescript";

import {
  builtinDerivations,
  instanceRegistry,
  instanceVarName,
  companionPath,
  tryExtractSumType,
} from "@typesugar/macros";

import {
  MacroContextImpl,
  globalRegistry,
  type MacroDefinition,
  DeriveTypeInfo,
  DeriveFieldInfo,
  DeriveVariantInfo,
  globalResolutionScope,
  isInOptedOutScope,
  getSuggestionsForSymbol,
  formatSuggestionsMessage,
} from "@typesugar/core";

import { safeGetNodeText, isPrimitiveType, type VisitFn } from "./transformer-utils.js";

// ---------------------------------------------------------------------------
// JSDoc macro tags
// ---------------------------------------------------------------------------

export const JSDOC_MACRO_TAGS: ReadonlyMap<string, string> = new Map([
  ["typeclass", "typeclass"],
  ["impl", "impl"],
  ["instance", "instance"],
  ["deriving", "deriving"],
  ["operators", "operators"],
  ["operator", "operator"],
  ["extension", "extension"],
  ["reflect", "reflect"],
  ["hkt", "hkt"],
]);

export function isJSDocMacroTargetNode(
  node: ts.Node
): node is
  | ts.InterfaceDeclaration
  | ts.ClassDeclaration
  | ts.TypeAliasDeclaration
  | ts.VariableStatement
  | ts.VariableDeclaration {
  return (
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isVariableDeclaration(node)
  );
}

export function hasJSDocMacroTags(node: ts.Node): boolean {
  if (!isJSDocMacroTargetNode(node)) {
    return false;
  }

  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (JSDOC_MACRO_TAGS.has(tag.tagName.text)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// JSDoc macro expansion
// ---------------------------------------------------------------------------

export function tryExpandJSDocMacros(
  ctx: MacroContextImpl,
  verbose: boolean,
  node: ts.Node
): ts.Node | ts.Node[] | undefined {
  if (isInOptedOutScope(ctx.sourceFile, node, globalResolutionScope, "macros")) {
    return undefined;
  }

  if (!isJSDocMacroTargetNode(node)) {
    return undefined;
  }

  const tags = ts.getJSDocTags(node);
  const results: ts.Node[] = [];

  let targetDecl: ts.Declaration;
  if (ts.isVariableStatement(node)) {
    if (node.declarationList.declarations.length === 0) {
      return undefined;
    }
    targetDecl = node.declarationList.declarations[0];
  } else {
    targetDecl = node;
  }

  let currentNode: ts.Declaration = targetDecl;

  for (const tag of tags) {
    const macroName = JSDOC_MACRO_TAGS.get(tag.tagName.text);
    if (!macroName) continue;

    const macro = globalRegistry.getAttribute(macroName);
    if (!macro) {
      ctx.reportWarning(tag, `Unknown JSDoc macro tag @${tag.tagName.text}`);
      continue;
    }

    const args = parseJSDocMacroArgs(ctx, tag, macroName);

    const syntheticDecorator = createSyntheticDecorator(ctx, tag, macroName, args);

    try {
      if (verbose) {
        console.log(`[typesugar] Expanding JSDoc macro: @${tag.tagName.text}`);
      }

      const expanded = macro.expand(ctx, syntheticDecorator, currentNode, args);

      if (expanded === undefined) continue;

      if (Array.isArray(expanded)) {
        if (expanded.length > 0) {
          currentNode = expanded[0] as ts.Declaration;
          results.push(...expanded.slice(1));
        }
      } else {
        currentNode = expanded as ts.Declaration;
      }
    } catch (err) {
      const macroTag = tag.tagName.text;
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.reportError(tag, `@${macroTag} macro failed (this may be transient — try saving again)`);
      if (verbose) {
        console.error(
          `[typesugar] @${macroTag} expand threw: ${err instanceof Error ? err.stack : errMsg}`
        );
      }
    }
  }

  const wasExpanded = currentNode !== targetDecl || results.length > 0;
  if (!wasExpanded) {
    return undefined;
  }

  if (ts.isVariableStatement(node)) {
    const factory = ctx.factory;
    const updatedDecl = currentNode as ts.VariableDeclaration;
    const updatedDeclList = factory.updateVariableDeclarationList(node.declarationList, [
      updatedDecl,
      ...node.declarationList.declarations.slice(1),
    ]);
    const updatedStmt = factory.updateVariableStatement(node, node.modifiers, updatedDeclList);
    return results.length > 0 ? [updatedStmt, ...results] : updatedStmt;
  }

  return results.length > 0 ? [currentNode, ...results] : currentNode;
}

// ---------------------------------------------------------------------------
// JSDoc argument parsing
// ---------------------------------------------------------------------------

export function parseJSDocMacroArgs(
  ctx: MacroContextImpl,
  tag: ts.JSDocTag,
  macroName: string
): ts.Expression[] {
  const comment =
    typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);

  const trimmed = comment?.trim() ?? "";

  switch (macroName) {
    case "typeclass":
      if (!trimmed) return [];
      try {
        JSON.parse(trimmed);
        return [ctx.factory.createStringLiteral(trimmed)];
      } catch {
        return [];
      }

    case "impl":
    case "instance":
      if (!trimmed) return [];
      return [ctx.factory.createStringLiteral(trimmed)];

    case "deriving": {
      if (!trimmed) return [];
      const tcNames = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return tcNames.map((name) => ctx.factory.createIdentifier(name));
    }

    default:
      return [];
  }
}

export function createSyntheticDecorator(
  ctx: MacroContextImpl,
  tag: ts.JSDocTag,
  macroName: string,
  args: ts.Expression[]
): ts.Decorator {
  const factory = ctx.factory;

  let expression: ts.Expression;
  if (args.length === 0) {
    expression = factory.createIdentifier(macroName);
  } else {
    expression = factory.createCallExpression(factory.createIdentifier(macroName), undefined, args);
  }

  const decorator = factory.createDecorator(expression);
  return ts.setTextRange(decorator, tag);
}

// ---------------------------------------------------------------------------
// Decorator parsing and sorting
// ---------------------------------------------------------------------------

export function parseDecorator(decorator: ts.Decorator): {
  macroName: string;
  args: ts.Expression[];
  identNode: ts.Node | undefined;
} {
  const expr = decorator.expression;

  if (ts.isIdentifier(expr)) {
    return { macroName: expr.text, args: [], identNode: expr };
  }

  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) {
      return {
        macroName: expr.expression.text,
        args: Array.from(expr.arguments),
        identNode: expr.expression,
      };
    }
  }

  return { macroName: "", args: [], identNode: undefined };
}

export function sortDecoratorsByDependency(decorators: readonly ts.Decorator[]): ts.Decorator[] {
  const parsed = decorators.map((d) => ({
    decorator: d,
    ...parseDecorator(d),
  }));

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < parsed.length; i++) {
    const name = parsed[i].macroName;
    if (name) nameToIndex.set(name, i);
  }

  let hasDeps = false;
  for (const p of parsed) {
    if (!p.macroName) continue;
    const macro = globalRegistry.getAttribute(p.macroName) ?? globalRegistry.getDerive(p.macroName);
    if (macro?.expandAfter && macro.expandAfter.length > 0) {
      hasDeps = true;
      break;
    }
  }
  if (!hasDeps) return [...decorators];

  const n = parsed.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);

  for (let i = 0; i < n; i++) {
    const name = parsed[i].macroName;
    if (!name) continue;
    const macro = globalRegistry.getAttribute(name) ?? globalRegistry.getDerive(name);
    if (!macro?.expandAfter) continue;
    for (const dep of macro.expandAfter) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
      }
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: ts.Decorator[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(parsed[idx].decorator);
    for (const next of adj[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length < n) {
    return [...decorators];
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Derive dependency sorting
// ---------------------------------------------------------------------------

const BUILTIN_DERIVE_DEPS: Record<string, string[]> = {
  Ord: ["Eq"],
  Monoid: ["Semigroup"],
};

export function sortDeriveArgsByDependency(args: ts.Expression[]): ts.Expression[] {
  const identArgs = args.filter(ts.isIdentifier);
  if (identArgs.length < 2) return [...args];

  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (ts.isIdentifier(a)) nameToIndex.set(a.text, i);
  }

  let hasDeps = false;
  const n = args.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj: number[][] = [];
  for (let i = 0; i < n; i++) adj.push([]);

  for (let i = 0; i < n; i++) {
    const a = args[i];
    if (!ts.isIdentifier(a)) continue;
    const name = a.text;

    const deps: string[] = [];

    const deriveMacro = globalRegistry.getDerive(name);
    if (deriveMacro?.expandAfter) {
      deps.push(...deriveMacro.expandAfter);
    }

    const tcMacro = globalRegistry.getDerive(`${name}TC`);
    if (tcMacro?.expandAfter) {
      deps.push(...tcMacro.expandAfter);
    }

    const builtinDeps = BUILTIN_DERIVE_DEPS[name];
    if (builtinDeps) {
      deps.push(...builtinDeps);
    }

    for (const dep of deps) {
      const depIdx = nameToIndex.get(dep);
      if (depIdx !== undefined) {
        adj[depIdx].push(i);
        inDegree[i]++;
        hasDeps = true;
      }
    }
  }

  if (!hasDeps) return [...args];

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const sorted: ts.Expression[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const idx = queue.shift()!;
    sorted.push(args[idx]);
    for (const next of adj[idx]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length < n) {
    return [...args];
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Derive decorator expansion
// ---------------------------------------------------------------------------

export function expandDeriveDecorator(
  ctx: MacroContextImpl,
  verbose: boolean,
  decorator: ts.Decorator,
  node: ts.Node,
  args: ts.Expression[]
): ts.Statement[] | undefined {
  if (
    !ts.isInterfaceDeclaration(node) &&
    !ts.isClassDeclaration(node) &&
    !ts.isTypeAliasDeclaration(node)
  ) {
    ctx.reportError(
      decorator,
      "@derive can only be applied to interfaces, classes, or type aliases"
    );
    return undefined;
  }

  const sortedArgs = sortDeriveArgsByDependency(args);
  const statements: ts.Statement[] = [];
  const typeInfo = extractTypeInfo(ctx, node);
  const typeName = node.name?.text ?? "Anonymous";

  for (const arg of sortedArgs) {
    if (!ts.isIdentifier(arg)) {
      ctx.reportError(arg, "derive arguments must be identifiers");
      continue;
    }

    const deriveName = arg.text;

    const deriveMacro = globalRegistry.getDerive(deriveName);
    if (deriveMacro) {
      if (verbose) {
        console.log(`[typesugar] Expanding derive macro: ${deriveName}`);
      }

      try {
        const result = ctx.hygiene.withScope(() => deriveMacro.expand(ctx, node, typeInfo));
        statements.push(...result);
      } catch (error) {
        ctx.reportError(arg, `Derive macro expansion failed: ${error}`);
      }
      continue;
    }

    const typeclassDerivation = builtinDerivations[deriveName];
    if (typeclassDerivation) {
      if (verbose) {
        console.log(`[typesugar] Auto-deriving typeclass instance: ${deriveName} for ${typeName}`);
      }
      try {
        let code: string;

        if (ts.isTypeAliasDeclaration(node)) {
          const sumInfo = tryExtractSumType(ctx, node);
          if (sumInfo) {
            code = typeclassDerivation.deriveSum(typeName, sumInfo.discriminant, sumInfo.variants);
          } else {
            code = typeclassDerivation.deriveProduct(typeName, typeInfo.fields);
          }
        } else {
          code = typeclassDerivation.deriveProduct(typeName, typeInfo.fields);
        }

        const parsedStmts = ctx.parseStatements(code);
        statements.push(...parsedStmts);

        const uncap = deriveName.charAt(0).toLowerCase() + deriveName.slice(1);
        instanceRegistry.push({
          typeclassName: deriveName,
          forType: typeName,
          instanceName: instanceVarName(uncap, typeName),
          companionPath: companionPath(deriveName, typeName),
          derived: true,
        });
      } catch (error) {
        ctx.reportError(arg, `Typeclass auto-derivation failed for ${deriveName}: ${error}`);
      }
      continue;
    }

    const tcDeriveMacro = globalRegistry.getDerive(`${deriveName}TC`);
    if (tcDeriveMacro) {
      if (verbose) {
        console.log(`[typesugar] Expanding typeclass derive macro: ${deriveName}TC`);
      }
      try {
        const result = ctx.hygiene.withScope(() => tcDeriveMacro.expand(ctx, node, typeInfo));
        statements.push(...result);
      } catch (error) {
        ctx.reportError(arg, `Typeclass derive macro expansion failed: ${error}`);
      }
      continue;
    }

    const suggestions = getSuggestionsForSymbol(deriveName);
    const suggestionMsg = formatSuggestionsMessage(suggestions);
    const message = suggestionMsg
      ? `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
        `typeclass with auto-derivation, or typeclass derive macro ` +
        `('${deriveName}TC').\n\n${suggestionMsg}`
      : `Unknown derive: '${deriveName}'. Not a registered derive macro, ` +
        `typeclass with auto-derivation, or typeclass derive macro ` +
        `('${deriveName}TC').`;
    ctx.reportError(arg, message);
  }

  return statements.length > 0 ? statements : undefined;
}

// ---------------------------------------------------------------------------
// Type info extraction for derives
// ---------------------------------------------------------------------------

export function extractTypeInfo(
  ctx: MacroContextImpl,
  node: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
): DeriveTypeInfo {
  const name = node.name?.text ?? "Anonymous";
  const typeParameters = node.typeParameters ? Array.from(node.typeParameters) : [];

  let type: ts.Type;
  try {
    type = ctx.typeChecker.getTypeAtLocation(node);
  } catch {
    return {
      name,
      fields: [],
      typeParameters,
      type: undefined as unknown as ts.Type,
      kind: "product",
    };
  }

  if (ts.isTypeAliasDeclaration(node)) {
    const sumInfo = tryExtractSumType(ctx, node);
    if (sumInfo) {
      return extractSumTypeInfo(ctx, node, name, typeParameters, type, sumInfo);
    }
  }

  if (ts.isTypeAliasDeclaration(node) && isPrimitiveType(type)) {
    return { name, fields: [], typeParameters, type, kind: "primitive" };
  }

  const fields: DeriveFieldInfo[] = [];
  let properties: ts.Symbol[];
  try {
    properties = ctx.typeChecker.getPropertiesOfType(type);
  } catch {
    return { name, fields: [], typeParameters, type, kind: "product" };
  }

  let isRecursive = false;
  for (const prop of properties) {
    const declarations = prop.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const decl = declarations[0];
    let propType: ts.Type;
    let propTypeString: string;
    try {
      propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
      propTypeString = ctx.typeChecker.typeToString(propType);
    } catch {
      propType = type;
      propTypeString = "unknown";
    }

    if (propTypeString === name || propTypeString.includes(`${name}<`)) {
      isRecursive = true;
    }

    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const readonly =
      ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
        ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
        : false;

    fields.push({
      name: prop.name,
      typeString: propTypeString,
      type: propType,
      optional,
      readonly,
      symbol: prop,
    });
  }

  return { name, fields, typeParameters, type, kind: "product", isRecursive };
}

function extractSumTypeInfo(
  ctx: MacroContextImpl,
  node: ts.TypeAliasDeclaration,
  name: string,
  typeParameters: ts.TypeParameterDeclaration[],
  type: ts.Type,
  sumInfo: { discriminant: string; variants: Array<{ tag: string; typeName: string }> }
): DeriveTypeInfo {
  const variants: DeriveVariantInfo[] = [];
  let isRecursive = false;

  if (ts.isUnionTypeNode(node.type)) {
    for (const member of node.type.types) {
      if (!ts.isTypeReferenceNode(member)) continue;

      const memberTypeName = ts.isIdentifier(member.typeName)
        ? member.typeName.text
        : safeGetNodeText(member.typeName, ctx.sourceFile);
      const variantInfo = sumInfo.variants.find((v) => v.typeName === memberTypeName);
      if (!variantInfo) continue;

      const memberType = ctx.typeChecker.getTypeFromTypeNode(member);
      const fields: DeriveFieldInfo[] = [];

      try {
        const props = ctx.typeChecker.getPropertiesOfType(memberType);
        for (const prop of props) {
          if (prop.name === sumInfo.discriminant) continue;

          const declarations = prop.getDeclarations();
          if (!declarations || declarations.length === 0) continue;

          const decl = declarations[0];
          let propType: ts.Type;
          let propTypeString: string;
          try {
            propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl);
            propTypeString = ctx.typeChecker.typeToString(propType);
          } catch {
            propType = memberType;
            propTypeString = "unknown";
          }

          if (propTypeString === name || propTypeString.includes(`${name}<`)) {
            isRecursive = true;
          }

          const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
          const readonly =
            ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
              ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
              : false;

          fields.push({
            name: prop.name,
            typeString: propTypeString,
            type: propType,
            optional,
            readonly,
            symbol: prop,
          });
        }
      } catch {
        // Skip variant if we can't get its properties
      }

      variants.push({
        tag: variantInfo.tag,
        typeName: variantInfo.typeName,
        fields,
      });
    }
  }

  return {
    name,
    fields: [],
    typeParameters,
    type,
    kind: "sum",
    variants,
    discriminant: sumInfo.discriminant,
    isRecursive,
  };
}
