import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

export const transformIntoMacro = defineExpressionMacro({
  name: "transformInto",
  module: "@typesugar/mapper",
  description: "Zero-cost compile-time object mapping",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1) {
      ctx.reportError(callExpr, "transformInto expects at least 1 argument");
      return callExpr;
    }

    const sourceExpr = args[0];
    const configExpr = args[1];

    // 1. Get From and To types
    const fromType = ctx.getTypeOf(sourceExpr);
    // The return type of transformInto<From, To> is To
    const toType = ctx.getTypeOf(callExpr);

    // 2. Parse config
    const config = parseConfig(ctx, configExpr);

    // 3. Build the object literal mapping expression
    return buildMappingExpression(ctx, callExpr, sourceExpr, fromType, toType, config);
  },
});

export const transformArrayIntoMacro = defineExpressionMacro({
  name: "transformArrayInto",
  module: "@typesugar/mapper",
  description: "Zero-cost compile-time array mapping",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1) {
      ctx.reportError(callExpr, "transformArrayInto expects at least 1 argument");
      return callExpr;
    }

    const itemsExpr = args[0];
    const configExpr = args[1];

    // Parse config for element-level mapping
    const config = parseConfig(ctx, configExpr);

    // Get the return type: To[] — we need the element type To
    const returnType = ctx.getTypeOf(callExpr);
    // Get the element type of the source array
    const itemsType = ctx.getTypeOf(itemsExpr);

    // Extract element types from array types
    const fromElementType = getArrayElementType(ctx, itemsType);
    const toElementType = getArrayElementType(ctx, returnType);

    if (!fromElementType || !toElementType) {
      ctx.reportError(callExpr, "transformArrayInto: could not resolve array element types");
      return callExpr;
    }

    // Generate: items.map((__item) => ({ ... }))
    const itemParam = ctx.generateUniqueName("item");
    const mappingExpr = buildMappingExpressionFromTypes(
      ctx,
      callExpr,
      itemParam,
      fromElementType,
      toElementType,
      config
    );

    const mapCallback = ctx.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ctx.factory.createParameterDeclaration(
          undefined,
          undefined,
          itemParam,
          undefined,
          undefined,
          undefined
        ),
      ],
      undefined,
      ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      mappingExpr
    );

    return ctx.factory.createCallExpression(
      ctx.factory.createPropertyAccessExpression(itemsExpr, "map"),
      undefined,
      [mapCallback]
    );
  },
});

/**
 * Build the full mapping expression for an object, handling temp vars if needed.
 */
function buildMappingExpression(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  sourceExpr: ts.Expression,
  fromType: ts.Type,
  toType: ts.Type,
  config: ParsedConfig
): ts.Expression {
  // Avoid duplicate evaluation of source expression if it's complex
  let sourceIdent: ts.Expression = sourceExpr;
  let needsTempVar = false;
  let tempName: ts.Identifier | undefined;

  if (!ts.isIdentifier(sourceExpr) && !isSimpleLiteral(sourceExpr)) {
    needsTempVar = true;
    tempName = ctx.generateUniqueName("src");
    sourceIdent = tempName;
  }

  const objLit = buildObjectLiteral(ctx, callExpr, sourceIdent, fromType, toType, config);

  // If we needed a temp variable, wrap in an IIFE
  if (needsTempVar && tempName) {
    return ctx.factory.createCallExpression(
      ctx.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ctx.factory.createBlock(
          [
            ctx.factory.createVariableStatement(
              undefined,
              ctx.factory.createVariableDeclarationList(
                [ctx.factory.createVariableDeclaration(tempName, undefined, undefined, sourceExpr)],
                ts.NodeFlags.Const
              )
            ),
            ctx.factory.createReturnStatement(objLit),
          ],
          true
        )
      ),
      undefined,
      []
    );
  }

  return objLit;
}

/**
 * Build the mapping expression using already-resolved types and a simple identifier source.
 */
function buildMappingExpressionFromTypes(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  sourceIdent: ts.Identifier,
  fromType: ts.Type,
  toType: ts.Type,
  config: ParsedConfig
): ts.Expression {
  return buildObjectLiteral(ctx, callExpr, sourceIdent, fromType, toType, config);
}

/**
 * Build the core object literal for a mapping.
 */
function buildObjectLiteral(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  sourceIdent: ts.Expression,
  fromType: ts.Type,
  toType: ts.Type,
  config: ParsedConfig
): ts.ObjectLiteralExpression {
  const fromProps = ctx.getPropertiesOfType(fromType);
  const toProps = ctx.getPropertiesOfType(toType);
  const fromPropNames = new Set(fromProps.map((p) => p.name));
  const resultProperties: ts.ObjectLiteralElementLike[] = [];

  // Apply renamePaths: transform dot-notation renames into nested property assignments
  // We collect which top-level target fields are handled by renamePaths
  const renamePathsHandled = new Set<string>();

  for (const toProp of toProps) {
    const name = toProp.name;

    // Skip ignored target fields
    if (config.ignoreTarget.has(name)) {
      continue;
    }

    // Is it a constant?
    if (config.const.has(name)) {
      resultProperties.push(ctx.factory.createPropertyAssignment(name, config.const.get(name)!));
      continue;
    }

    // Is it computed?
    if (config.compute.has(name)) {
      const computeLambda = config.compute.get(name)!;
      const inlineCall = ctx.factory.createCallExpression(computeLambda, undefined, [sourceIdent]);
      resultProperties.push(ctx.factory.createPropertyAssignment(name, inlineCall));
      continue;
    }

    // Is it a collection field with sub-config?
    if (config.collections.has(name)) {
      const collectionConfigExpr = config.collections.get(name)!;
      const subConfig = parseConfig(ctx, collectionConfigExpr);

      // Get the source field access
      let sourceName = name;
      if (config.rename.has(name)) {
        sourceName = config.rename.get(name)!;
      }

      if (!fromPropNames.has(sourceName)) {
        ctx.reportError(
          callExpr,
          `Cannot map collection field '${name}': No matching field '${sourceName}' in source type.`
        );
        continue;
      }

      const sourceArrayAccess = createPropertyAccess(ctx, sourceIdent, sourceName);

      // Get element types from array types
      const fromFieldSymbol = fromProps.find((p) => p.name === sourceName);
      const toFieldSymbol = toProps.find((p) => p.name === name);

      if (fromFieldSymbol && toFieldSymbol) {
        const fromFieldType = ctx.typeChecker.getTypeOfSymbol(fromFieldSymbol);
        const toFieldType = ctx.typeChecker.getTypeOfSymbol(toFieldSymbol);
        const fromElemType = getArrayElementType(ctx, fromFieldType);
        const toElemType = getArrayElementType(ctx, toFieldType);

        if (fromElemType && toElemType) {
          const itemParam = ctx.generateUniqueName("item");
          const elementMapping = buildMappingExpressionFromTypes(
            ctx,
            callExpr,
            itemParam,
            fromElemType,
            toElemType,
            subConfig
          );

          const mapCallback = ctx.factory.createArrowFunction(
            undefined,
            undefined,
            [
              ctx.factory.createParameterDeclaration(
                undefined,
                undefined,
                itemParam,
                undefined,
                undefined,
                undefined
              ),
            ],
            undefined,
            ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            elementMapping
          );

          const mapCall = ctx.factory.createCallExpression(
            ctx.factory.createPropertyAccessExpression(sourceArrayAccess, "map"),
            undefined,
            [mapCallback]
          );

          resultProperties.push(
            ctx.factory.createPropertyAssignment(createPropName(ctx, name), mapCall)
          );
          continue;
        }
      }

      // Fallback: just copy the array
      resultProperties.push(
        ctx.factory.createPropertyAssignment(createPropName(ctx, name), sourceArrayAccess)
      );
      continue;
    }

    // Is it a nested object field with sub-config?
    if (config.nested.has(name)) {
      const nestedConfigExpr = config.nested.get(name)!;
      const subConfig = parseConfig(ctx, nestedConfigExpr);

      // Get the source field access
      let sourceName = name;
      if (config.rename.has(name)) {
        sourceName = config.rename.get(name)!;
      }

      if (!fromPropNames.has(sourceName)) {
        ctx.reportError(
          callExpr,
          `Cannot map nested field '${name}': No matching field '${sourceName}' in source type.`
        );
        continue;
      }

      const sourceFieldAccess = createPropertyAccess(ctx, sourceIdent, sourceName);

      // Get nested types from field symbols
      const fromFieldSymbol = fromProps.find((p) => p.name === sourceName);
      const toFieldSymbol = toProps.find((p) => p.name === name);

      if (fromFieldSymbol && toFieldSymbol) {
        const fromFieldType = ctx.typeChecker.getTypeOfSymbol(fromFieldSymbol);
        const toFieldType = ctx.typeChecker.getTypeOfSymbol(toFieldSymbol);

        const nestedObjLit = buildObjectLiteral(
          ctx,
          callExpr,
          sourceFieldAccess,
          fromFieldType,
          toFieldType,
          subConfig
        );

        resultProperties.push(
          ctx.factory.createPropertyAssignment(createPropName(ctx, name), nestedObjLit)
        );
        continue;
      }

      // Fallback: direct copy
      resultProperties.push(
        ctx.factory.createPropertyAssignment(createPropName(ctx, name), sourceFieldAccess)
      );
      continue;
    }

    // Check renamePaths for this field
    const renamePathEntries = getRenamePaths(config, name);
    if (renamePathEntries.length > 0) {
      // This field has dot-notation renames - build a nested object with overrides
      const nestedExpr = buildRenamePathsObject(
        ctx,
        sourceIdent,
        name,
        renamePathEntries,
        fromType,
        toType,
        fromProps,
        toProps
      );
      if (nestedExpr) {
        resultProperties.push(
          ctx.factory.createPropertyAssignment(createPropName(ctx, name), nestedExpr)
        );
        renamePathsHandled.add(name);
        continue;
      }
    }

    // Is it renamed?
    let sourceName = name;
    if (config.rename.has(name)) {
      sourceName = config.rename.get(name)!;
    }

    // Check top-level renamePaths (no dot in target path)
    if (config.renamePaths.has(name)) {
      const sourcePathStr = config.renamePaths.get(name)!;
      const sourceParts = sourcePathStr.split(".");
      let access: ts.Expression = sourceIdent;
      for (const part of sourceParts) {
        access = createPropertyAccess(ctx, access, part);
      }
      resultProperties.push(
        ctx.factory.createPropertyAssignment(createPropName(ctx, name), access)
      );
      continue;
    }

    // Find in source
    if (fromPropNames.has(sourceName)) {
      const propAccess = createPropertyAccess(ctx, sourceIdent, sourceName);
      resultProperties.push(
        ctx.factory.createPropertyAssignment(createPropName(ctx, name), propAccess)
      );
      continue;
    }

    // Missing mapping
    ctx.reportError(
      callExpr,
      `Cannot map field '${name}': No matching field '${sourceName}' in source type and no constant/compute rule provided.`
    );
  }

  return ctx.factory.createObjectLiteralExpression(resultProperties, true);
}

/**
 * Get renamePaths entries that target a specific top-level field (dot-notation paths).
 * For "address.location": "address.city", returns entries for top-level field "address".
 */
function getRenamePaths(
  config: ParsedConfig,
  topLevelField: string
): Array<{ targetSubPath: string[]; sourcePath: string[] }> {
  const entries: Array<{ targetSubPath: string[]; sourcePath: string[] }> = [];
  for (const [targetPath, sourcePath] of config.renamePaths) {
    const targetParts = targetPath.split(".");
    if (targetParts.length > 1 && targetParts[0] === topLevelField) {
      entries.push({
        targetSubPath: targetParts.slice(1),
        sourcePath: sourcePath.split("."),
      });
    }
  }
  return entries;
}

/**
 * Build an object expression for a nested field with renamePaths overrides.
 */
function buildRenamePathsObject(
  ctx: MacroContext,
  sourceIdent: ts.Expression,
  targetFieldName: string,
  renameEntries: Array<{ targetSubPath: string[]; sourcePath: string[] }>,
  _fromType: ts.Type,
  _toType: ts.Type,
  fromProps: ts.Symbol[],
  toProps: ts.Symbol[]
): ts.Expression | undefined {
  // Get the nested target type's properties
  const toFieldSymbol = toProps.find((p) => p.name === targetFieldName);
  const fromFieldSymbol = fromProps.find((p) => p.name === targetFieldName);
  if (!toFieldSymbol || !fromFieldSymbol) return undefined;

  const toFieldType = ctx.typeChecker.getTypeOfSymbol(toFieldSymbol);
  const fromFieldType = ctx.typeChecker.getTypeOfSymbol(fromFieldSymbol);
  const nestedToProps = ctx.getPropertiesOfType(toFieldType);
  const nestedFromPropNames = new Set(ctx.getPropertiesOfType(fromFieldType).map((p) => p.name));

  // Build a rename map for the nested level from renamePaths
  const nestedRenames = new Map<string, string[]>();
  for (const entry of renameEntries) {
    if (entry.targetSubPath.length === 1) {
      nestedRenames.set(entry.targetSubPath[0], entry.sourcePath);
    }
  }

  const sourceFieldAccess = createPropertyAccess(ctx, sourceIdent, targetFieldName);
  const properties: ts.ObjectLiteralElementLike[] = [];

  for (const nestedToProp of nestedToProps) {
    const nestedName = nestedToProp.name;

    if (nestedRenames.has(nestedName)) {
      // Use the renamePaths source path
      const sourceParts = nestedRenames.get(nestedName)!;
      let access: ts.Expression = sourceIdent;
      for (const part of sourceParts) {
        access = createPropertyAccess(ctx, access, part);
      }
      properties.push(
        ctx.factory.createPropertyAssignment(createPropName(ctx, nestedName), access)
      );
    } else if (nestedFromPropNames.has(nestedName)) {
      // Direct copy from source nested field
      properties.push(
        ctx.factory.createPropertyAssignment(
          createPropName(ctx, nestedName),
          createPropertyAccess(ctx, sourceFieldAccess, nestedName)
        )
      );
    }
  }

  return ctx.factory.createObjectLiteralExpression(properties, true);
}

/**
 * Create a safe property access expression.
 */
function createPropertyAccess(ctx: MacroContext, expr: ts.Expression, name: string): ts.Expression {
  const isIdentifierName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
  return isIdentifierName
    ? ctx.factory.createPropertyAccessExpression(expr, name)
    : ctx.factory.createElementAccessExpression(expr, ctx.factory.createStringLiteral(name));
}

/**
 * Create a property name node.
 */
function createPropName(ctx: MacroContext, name: string): ts.Identifier | ts.StringLiteral {
  const isIdentifierName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
  return isIdentifierName
    ? ctx.factory.createIdentifier(name)
    : ctx.factory.createStringLiteral(name);
}

/**
 * Extract the element type from an array type.
 */
function getArrayElementType(ctx: MacroContext, type: ts.Type): ts.Type | undefined {
  // Check for number index type (arrays have numeric indexer)
  const numberIndexType = type.getNumberIndexType();
  if (numberIndexType) return numberIndexType;

  // Try type arguments if it's a generic Array<T>
  if ((type as ts.TypeReference).typeArguments?.length) {
    return (type as ts.TypeReference).typeArguments![0];
  }

  return undefined;
}

function isSimpleLiteral(expr: ts.Expression): boolean {
  return (
    ts.isStringLiteral(expr) ||
    ts.isNumericLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  );
}

interface ParsedConfig {
  rename: Map<string, string>;
  compute: Map<string, ts.Expression>;
  const: Map<string, ts.Expression>;
  ignoreTarget: Set<string>;
  ignoreSource: Set<string>;
  nested: Map<string, ts.Expression>;
  collections: Map<string, ts.Expression>;
  renamePaths: Map<string, string>;
}

function parseConfig(ctx: MacroContext, configExpr?: ts.Expression): ParsedConfig {
  const config: ParsedConfig = {
    rename: new Map<string, string>(),
    compute: new Map<string, ts.Expression>(),
    const: new Map<string, ts.Expression>(),
    ignoreTarget: new Set<string>(),
    ignoreSource: new Set<string>(),
    nested: new Map<string, ts.Expression>(),
    collections: new Map<string, ts.Expression>(),
    renamePaths: new Map<string, string>(),
  };

  if (!configExpr || !ts.isObjectLiteralExpression(configExpr)) {
    return config;
  }

  for (const prop of configExpr.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      const key = prop.name.text;
      if (key === "rename" || key === "compute" || key === "const") {
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          for (const subProp of prop.initializer.properties) {
            if (ts.isPropertyAssignment(subProp)) {
              let targetKey = "";
              if (ts.isIdentifier(subProp.name)) {
                targetKey = subProp.name.text;
              } else if (ts.isStringLiteral(subProp.name)) {
                targetKey = subProp.name.text;
              }

              if (targetKey) {
                if (key === "rename" && ts.isStringLiteral(subProp.initializer)) {
                  config.rename.set(targetKey, subProp.initializer.text);
                } else if (key === "compute") {
                  config.compute.set(targetKey, subProp.initializer);
                } else if (key === "const") {
                  config.const.set(targetKey, subProp.initializer);
                }
              }
            }
          }
        }
      } else if (key === "ignore" && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const subProp of prop.initializer.properties) {
          if (ts.isPropertyAssignment(subProp) && ts.isIdentifier(subProp.name)) {
            const subKey = subProp.name.text;
            if (
              (subKey === "source" || subKey === "target") &&
              ts.isArrayLiteralExpression(subProp.initializer)
            ) {
              const set = subKey === "target" ? config.ignoreTarget : config.ignoreSource;
              for (const elem of subProp.initializer.elements) {
                if (ts.isStringLiteral(elem)) {
                  set.add(elem.text);
                } else if (ts.isIdentifier(elem)) {
                  set.add(elem.text);
                }
              }
            }
          }
        }
      } else if (key === "nested" && ts.isObjectLiteralExpression(prop.initializer)) {
        // Parse nested: { fieldName: { ...subConfig } }
        for (const subProp of prop.initializer.properties) {
          if (ts.isPropertyAssignment(subProp)) {
            let fieldName = "";
            if (ts.isIdentifier(subProp.name)) {
              fieldName = subProp.name.text;
            } else if (ts.isStringLiteral(subProp.name)) {
              fieldName = subProp.name.text;
            }
            if (fieldName) {
              config.nested.set(fieldName, subProp.initializer);
            }
          }
        }
      } else if (key === "collections" && ts.isObjectLiteralExpression(prop.initializer)) {
        // Parse collections: { fieldName: { ...subConfig } }
        for (const subProp of prop.initializer.properties) {
          if (ts.isPropertyAssignment(subProp)) {
            let fieldName = "";
            if (ts.isIdentifier(subProp.name)) {
              fieldName = subProp.name.text;
            } else if (ts.isStringLiteral(subProp.name)) {
              fieldName = subProp.name.text;
            }
            if (fieldName) {
              config.collections.set(fieldName, subProp.initializer);
            }
          }
        }
      } else if (key === "renamePaths" && ts.isObjectLiteralExpression(prop.initializer)) {
        // Parse renamePaths: { "target.path": "source.path" }
        for (const subProp of prop.initializer.properties) {
          if (ts.isPropertyAssignment(subProp) && ts.isStringLiteral(subProp.initializer)) {
            let targetPath = "";
            if (ts.isIdentifier(subProp.name)) {
              targetPath = subProp.name.text;
            } else if (ts.isStringLiteral(subProp.name)) {
              targetPath = subProp.name.text;
            }
            if (targetPath) {
              config.renamePaths.set(targetPath, subProp.initializer.text);
            }
          }
        }
      }
    }
  }

  return config;
}

export function register(): void {
  globalRegistry.register(transformIntoMacro);
  globalRegistry.register(transformArrayIntoMacro);
}
