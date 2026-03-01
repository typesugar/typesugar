"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  transformInto: () => transformInto
});
module.exports = __toCommonJS(index_exports);

// src/api.ts
function transformInto(source, config) {
  throw new Error(
    "transformInto() was called at runtime. This indicates the typesugar transformer is not configured correctly. Please ensure your build tool is configured to use the typesugar transformer."
  );
}

// src/macros.ts
var ts = __toESM(require("typescript"), 1);
var import_core = require("@typesugar/core");
var transformIntoMacro = (0, import_core.defineExpressionMacro)({
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
      if (config.ignoreTarget.has(name)) {
        continue;
      }
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
    const: /* @__PURE__ */ new Map(),
    ignoreTarget: /* @__PURE__ */ new Set(),
    ignoreSource: /* @__PURE__ */ new Set()
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
            if ((subKey === "source" || subKey === "target") && ts.isArrayLiteralExpression(subProp.initializer)) {
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
function register() {
  import_core.globalRegistry.register(transformIntoMacro);
}

// src/index.ts
register();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  transformInto
});
//# sourceMappingURL=index.cjs.map