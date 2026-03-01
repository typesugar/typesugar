/**
 * Layer.make<R>(...layers) Expression Macro — ZIO-style Explicit Wiring
 *
 * Takes layer expressions as explicit arguments, resolves the dependency
 * graph at compile time, and generates the composed Layer expression.
 *
 * Follows ZIO's `ZLayer.make[R]` naming and approach: you list the
 * ingredients, the compiler figures out the wiring.
 *
 * Input:
 * ```typescript
 * // Given these layer variables:
 * const databaseLive = Layer.succeed(DatabaseTag, { ... })
 * const userRepoLive = Layer.effect(UserRepoTag, ...)  // requires Database
 * const httpClientLive = Layer.succeed(HttpClientTag, { ... })
 *
 * // Compose them with automatic wiring:
 * const appLayer = layerMake<UserRepo | HttpClient>(
 *   userRepoLive, databaseLive, httpClientLive
 * )
 * ```
 *
 * Output:
 * ```typescript
 * const appLayer = Layer.merge(
 *   userRepoLive.pipe(Layer.provide(databaseLive)),
 *   httpClientLive
 * )
 * ```
 *
 * Options:
 * - `layerMake<R>(...layers)` — basic composition
 * - `layerMake<R>(...layers, { debug: true })` — emit wiring graph as info diagnostic
 *
 * @module
 */

import * as ts from "typescript";
import { type ExpressionMacro, type MacroContext, defineExpressionMacro } from "@typesugar/core";
import type { LayerInfo } from "./layer.js";
import {
  resolveGraph,
  generateLayerComposition,
  formatDebugTree,
  extractServiceNames,
  CircularDependencyError,
} from "./layer-graph.js";

/**
 * Attempt to extract LayerInfo from a layer expression's type.
 *
 * A Layer in Effect has type `Layer<ROut, E, RIn>` (Effect 3.x).
 * We use the type checker to extract what it provides (ROut) and
 * requires (RIn) from the expression's type.
 *
 * Falls back to checking the layer registry if type extraction fails.
 */
function extractLayerInfoFromType(
  ctx: MacroContext,
  expr: ts.Expression,
  exprName: string
): LayerInfo | null {
  const type = ctx.getTypeOf(expr);
  if (!type) return null;

  const typeStr = ctx.typeChecker.typeToString(type);

  // Try to match Layer<ROut, E, RIn> pattern
  // Effect 3.x: Layer.Layer<ROut, E, RIn>
  // The type string might be: Layer<UserRepo, never, Database>
  const layerMatch = typeStr.match(/Layer<([^,>]+)(?:,\s*([^,>]+))?(?:,\s*([^,>]+))?>$/);
  if (layerMatch) {
    const provides = layerMatch[1].trim();
    const requiresStr = layerMatch[3]?.trim() ?? "never";

    const requires = requiresStr === "never" ? [] : requiresStr.split("|").map((s) => s.trim());

    return {
      name: exprName,
      provides,
      requires,
      sourceFile: ctx.sourceFile.fileName,
      layerType: "effect",
    };
  }

  // Try extracting from the type's type arguments directly
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol) {
    const typeArgs = ctx.typeChecker.getTypeArguments(type as ts.TypeReference);
    if (typeArgs && typeArgs.length >= 1) {
      const rOut = ctx.typeChecker.typeToString(typeArgs[0]);
      const rIn = typeArgs.length >= 3 ? ctx.typeChecker.typeToString(typeArgs[2]) : "never";

      const requires = rIn === "never" ? [] : rIn.split("|").map((s) => s.trim());

      return {
        name: exprName,
        provides: rOut,
        requires,
        sourceFile: ctx.sourceFile.fileName,
        layerType: "effect",
      };
    }
  }

  return null;
}

/**
 * Get a stable name for a layer expression (for graph building and diagnostics).
 */
function getLayerExprName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return expr.name.text;
  }
  return `<anonymous layer>`;
}

/**
 * Check if the last argument is an options object with `debug: true`.
 */
function extractDebugOption(args: readonly ts.Expression[]): {
  layers: readonly ts.Expression[];
  debug: boolean;
} {
  if (args.length === 0) return { layers: args, debug: false };

  const lastArg = args[args.length - 1];
  if (ts.isObjectLiteralExpression(lastArg)) {
    for (const prop of lastArg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "debug" &&
        prop.initializer.kind === ts.SyntaxKind.TrueKeyword
      ) {
        return { layers: args.slice(0, -1), debug: true };
      }
    }
  }

  return { layers: args, debug: false };
}

/**
 * The layerMake<R>(...layers) expression macro.
 *
 * ZIO-style explicit layer wiring: you list the layer values,
 * the compiler resolves the dependency graph and generates composition.
 */
export const layerMakeMacro: ExpressionMacro = defineExpressionMacro({
  name: "layerMake",
  description: "ZIO-style automatic layer composition from explicit layer arguments",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory } = ctx;

    // Get the type argument R from layerMake<R>(...)
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "layerMake<R>(...layers) requires a type argument specifying the target services"
      );
      return emptyLayer(factory);
    }

    const { layers: layerArgs, debug } = extractDebugOption(args);

    if (layerArgs.length === 0) {
      ctx.reportError(callExpr, "layerMake<R>(...layers) requires at least one layer argument");
      return emptyLayer(factory);
    }

    // Extract the target service names from the type argument
    const targetServices = extractServiceNames(ctx, typeArgs[0]);
    if (targetServices.length === 0) {
      ctx.reportWarning(callExpr, "layerMake<R>() received no recognizable service types in R");
      return emptyLayer(factory);
    }

    // Build LayerInfo for each provided layer argument
    const providedLayers: LayerInfo[] = [];
    const layerExprMap = new Map<string, ts.Expression>();

    for (const layerArg of layerArgs) {
      const name = getLayerExprName(layerArg);
      const info = extractLayerInfoFromType(ctx, layerArg, name);

      if (info) {
        providedLayers.push(info);
        layerExprMap.set(name, layerArg);
      } else {
        ctx.reportWarning(
          layerArg,
          `Could not determine what service '${name}' provides. ` +
            `Ensure it has type Layer<Service, E, Requirements>.`
        );
      }
    }

    // Build a lookup function that only considers the explicitly provided layers
    const layersByService = new Map<string, LayerInfo[]>();
    for (const layer of providedLayers) {
      const existing = layersByService.get(layer.provides) ?? [];
      existing.push(layer);
      layersByService.set(layer.provides, existing);
    }

    const findLayersForService = (service: string): LayerInfo[] =>
      layersByService.get(service) ?? [];

    // Check for ambiguous providers
    for (const [service, candidates] of layersByService) {
      if (candidates.length > 1) {
        const names = candidates.map((c) => c.name).join(", ");
        ctx.reportError(
          callExpr,
          `Multiple layers provide '${service}': ${names}. ` +
            `Remove duplicates or use resolveLayer<R>() for priority-based resolution.`
        );
        return emptyLayer(factory);
      }
    }

    // Resolve the dependency graph
    try {
      const resolution = resolveGraph(targetServices, findLayersForService, providedLayers);

      if (resolution.missing.length > 0) {
        const missingList = resolution.missing
          .map((m) => {
            // Find which provided layer requires this missing service
            const requiredBy = providedLayers
              .filter((l) => l.requires.includes(m))
              .map((l) => l.name);
            const suffix = requiredBy.length > 0 ? ` (required by ${requiredBy.join(", ")})` : "";
            return `  - ${m}${suffix}`;
          })
          .join("\n");

        ctx.reportError(
          callExpr,
          `Missing layers for:\n${missingList}\n` +
            `Add the missing layers to layerMake<R>() arguments.`
        );
        return emptyLayer(factory);
      }

      if (resolution.unused.length > 0) {
        const unusedNames = resolution.unused.map((l) => l.name).join(", ");
        ctx.reportWarning(callExpr, `Unused layers (provided but not required): ${unusedNames}`);
      }

      // Emit debug tree if requested
      if (debug) {
        const tree = formatDebugTree(resolution);
        ctx.reportWarning(callExpr, tree);
      }

      return generateLayerComposition(ctx, resolution, layerExprMap);
    } catch (e) {
      if (e instanceof CircularDependencyError) {
        ctx.reportError(callExpr, `Circular layer dependency: ${e.cycle.join(" → ")}`);
        return emptyLayer(factory);
      }
      ctx.reportError(
        callExpr,
        `Layer resolution failed: ${e instanceof Error ? e.message : String(e)}`
      );
      return emptyLayer(factory);
    }
  },
});

function emptyLayer(factory: ts.NodeFactory): ts.Expression {
  return factory.createPropertyAccessExpression(
    factory.createIdentifier("Layer"),
    factory.createIdentifier("empty")
  );
}

/**
 * Runtime placeholder for layerMake macro.
 * The compiler plugin replaces this with the composed Layer expression.
 */
export function layerMake<R>(...args: unknown[]): never {
  void args;
  throw new Error(
    "layerMake<R>() was not transformed at compile time. " +
      "Make sure @typesugar/effect is registered with the transformer."
  );
}
