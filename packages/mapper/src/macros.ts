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

    // 3. Get properties
    const fromProps = ctx.getPropertiesOfType(fromType);
    const toProps = ctx.getPropertiesOfType(toType);

    const fromPropNames = new Set(fromProps.map((p) => p.name));

    const resultProperties: ts.ObjectLiteralElementLike[] = [];

    // Avoid duplicate evaluation of source expression if it's complex
    let sourceIdent = sourceExpr;
    let needsTempVar = false;
    let tempName: ts.Identifier | undefined;

    if (!ts.isIdentifier(sourceExpr) && !isSimpleLiteral(sourceExpr)) {
      needsTempVar = true;
      tempName = ctx.generateUniqueName("src");
      sourceIdent = tempName;
    }

    // 4. Map fields
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
        // Inline it via IIFE for the lambda, or direct call
        const inlineCall = ctx.factory.createCallExpression(computeLambda, undefined, [
          sourceIdent,
        ]);
        resultProperties.push(ctx.factory.createPropertyAssignment(name, inlineCall));
        continue;
      }

      // Is it renamed?
      let sourceName = name;
      if (config.rename.has(name)) {
        sourceName = config.rename.get(name)!;
      }

      // Find in source
      if (fromPropNames.has(sourceName)) {
        // Determine safe property access
        const isIdentifierName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sourceName);
        const propAccess = isIdentifierName
          ? ctx.factory.createPropertyAccessExpression(sourceIdent, sourceName)
          : ctx.factory.createElementAccessExpression(
              sourceIdent,
              ctx.factory.createStringLiteral(sourceName)
            );

        // TODO: Deep type compatibility check using ctx.isAssignableTo
        // and recursive transform if needed.

        // Write the assignment: { targetName: sourceIdent.sourceName }
        const isTargetIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
        const propName = isTargetIdentifier
          ? ctx.factory.createIdentifier(name)
          : ctx.factory.createStringLiteral(name);

        resultProperties.push(ctx.factory.createPropertyAssignment(propName, propAccess));
        continue;
      }

      // Missing mapping
      ctx.reportError(
        callExpr,
        `Cannot map field '${name}': No matching field '${sourceName}' in source type and no constant/compute rule provided.`
      );
    }

    const objLit = ctx.factory.createObjectLiteralExpression(resultProperties, true);

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
                  [
                    ctx.factory.createVariableDeclaration(
                      tempName,
                      undefined,
                      undefined,
                      sourceExpr
                    ),
                  ],
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
  },
});

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
}

function parseConfig(ctx: MacroContext, configExpr?: ts.Expression): ParsedConfig {
  const config: ParsedConfig = {
    rename: new Map<string, string>(),
    compute: new Map<string, ts.Expression>(),
    const: new Map<string, ts.Expression>(),
    ignoreTarget: new Set<string>(),
    ignoreSource: new Set<string>(),
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
      }
    }
  }

  return config;
}

export function register(): void {
  globalRegistry.register(transformIntoMacro);
}
