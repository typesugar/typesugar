// src/api.ts
function transformInto(source, config) {
  throw new Error(
    "transformInto() was called at runtime. This indicates the typesugar transformer is not configured correctly. Please ensure your build tool is configured to use the typesugar transformer."
  );
}

// src/macros.ts
import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
var transformIntoMacro = defineExpressionMacro({
  name: "transformInto",
  module: "@typesugar/mapper",
  description: "Zero-cost compile-time object mapping",
  expand(ctx, callExpr, args) {
    if (args.length < 1) {
      ctx.reportError(callExpr, "transformInto expects at least 1 argument");
      return callExpr;
    }
    const sourceExpr = args[0];
    const configExpr = args[1];
    const fromType = ctx.getTypeOf(sourceExpr);
    const toType = ctx.getTypeOf(callExpr);
    const config = parseConfig(ctx, configExpr);
    const fromProps = ctx.getPropertiesOfType(fromType);
    const toProps = ctx.getPropertiesOfType(toType);
    const fromPropNames = new Set(fromProps.map((p) => p.name));
    const resultProperties = [];
    let sourceIdent = sourceExpr;
    let needsTempVar = false;
    let tempName;
    if (!ts.isIdentifier(sourceExpr) && !isSimpleLiteral(sourceExpr)) {
      needsTempVar = true;
      tempName = ctx.generateUniqueName("src");
      sourceIdent = tempName;
    }
    for (const toProp of toProps) {
      const name = toProp.name;
      if (config.const.has(name)) {
        resultProperties.push(ctx.factory.createPropertyAssignment(name, config.const.get(name)));
        continue;
      }
      if (config.compute.has(name)) {
        const computeLambda = config.compute.get(name);
        const inlineCall = ctx.factory.createCallExpression(computeLambda, void 0, [
          sourceIdent
        ]);
        resultProperties.push(ctx.factory.createPropertyAssignment(name, inlineCall));
        continue;
      }
      let sourceName = name;
      if (config.rename.has(name)) {
        sourceName = config.rename.get(name);
      }
      if (fromPropNames.has(sourceName)) {
        const isIdentifierName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sourceName);
        const propAccess = isIdentifierName ? ctx.factory.createPropertyAccessExpression(sourceIdent, sourceName) : ctx.factory.createElementAccessExpression(
          sourceIdent,
          ctx.factory.createStringLiteral(sourceName)
        );
        const isTargetIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
        const propName = isTargetIdentifier ? ctx.factory.createIdentifier(name) : ctx.factory.createStringLiteral(name);
        resultProperties.push(ctx.factory.createPropertyAssignment(propName, propAccess));
        continue;
      }
      ctx.reportError(
        callExpr,
        `Cannot map field '${name}': No matching field '${sourceName}' in source type and no constant/compute rule provided.`
      );
    }
    const objLit = ctx.factory.createObjectLiteralExpression(resultProperties, true);
    if (needsTempVar && tempName) {
      return ctx.factory.createCallExpression(
        ctx.factory.createArrowFunction(
          void 0,
          void 0,
          [],
          void 0,
          ctx.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          ctx.factory.createBlock(
            [
              ctx.factory.createVariableStatement(
                void 0,
                ctx.factory.createVariableDeclarationList(
                  [
                    ctx.factory.createVariableDeclaration(
                      tempName,
                      void 0,
                      void 0,
                      sourceExpr
                    )
                  ],
                  ts.NodeFlags.Const
                )
              ),
              ctx.factory.createReturnStatement(objLit)
            ],
            true
          )
        ),
        void 0,
        []
      );
    }
    return objLit;
  }
});
function isSimpleLiteral(expr) {
  return ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword;
}
function parseConfig(ctx, configExpr) {
  const config = {
    rename: /* @__PURE__ */ new Map(),
    compute: /* @__PURE__ */ new Map(),
    const: /* @__PURE__ */ new Map()
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
      }
    }
  }
  return config;
}
function register() {
  globalRegistry.register(transformIntoMacro);
}

// src/index.ts
register();
export {
  transformInto
};
//# sourceMappingURL=index.js.map