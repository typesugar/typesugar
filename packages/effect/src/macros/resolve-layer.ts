/**
 * resolveLayer<R>() Expression Macro
 *
 * Automatically resolves and composes layers to satisfy Effect requirements.
 *
 * Input:
 * ```typescript
 * // Given these layers are registered:
 * @layer(Database) const databaseLive = { ... }
 * @layer(UserRepo, { requires: [Database] }) const userRepoLive = ...
 * @layer(HttpClient) const httpClientLive = { ... }
 * @layer(EmailService, { requires: [HttpClient] }) const emailServiceLive = ...
 *
 * // Resolve all layers for an Effect with requirements:
 * const program: Effect<void, Error, UserRepo | EmailService> = ...
 * const runnable = program.pipe(Effect.provide(resolveLayer<UserRepo | EmailService>()))
 * ```
 *
 * Output:
 * ```typescript
 * const runnable = program.pipe(Effect.provide(
 *   Layer.merge(
 *     userRepoLive.pipe(Layer.provide(databaseLive)),
 *     emailServiceLive.pipe(Layer.provide(httpClientLive))
 *   )
 * ))
 * ```
 *
 * The macro:
 * 1. Parses the union type R to extract required services
 * 2. Looks up layers for each required service from the @layer registry
 * 3. Builds a dependency graph from layer metadata
 * 4. Topologically sorts to ensure dependencies are provided first
 * 5. Generates Layer.provide/merge composition
 *
 * @module
 */

import * as ts from "typescript";
import { type ExpressionMacro, type MacroContext, defineExpressionMacro } from "@typesugar/core";
import { layerRegistry, getLayersForService, type LayerInfo } from "./layer.js";

/**
 * Extract service names from a union type (e.g., "UserRepo | EmailService").
 */
function extractServiceNames(ctx: MacroContext, typeNode: ts.TypeNode): string[] {
  const services: string[] = [];

  function visit(node: ts.TypeNode): void {
    if (ts.isUnionTypeNode(node)) {
      for (const member of node.types) {
        visit(member);
      }
    } else if (ts.isTypeReferenceNode(node)) {
      const typeName = node.typeName;
      if (ts.isIdentifier(typeName)) {
        services.push(typeName.text);
      } else if (ts.isQualifiedName(typeName)) {
        services.push(typeName.right.text);
      }
    } else if (ts.isIntersectionTypeNode(node)) {
      for (const member of node.types) {
        visit(member);
      }
    }
  }

  visit(typeNode);
  return services;
}

/**
 * Build a dependency graph from layer metadata.
 * Returns a map from service name to its dependencies.
 */
function buildDependencyGraph(
  layers: LayerInfo[]
): Map<string, { layer: LayerInfo; dependencies: string[] }> {
  const graph = new Map<string, { layer: LayerInfo; dependencies: string[] }>();

  for (const layer of layers) {
    graph.set(layer.provides, {
      layer,
      dependencies: layer.requires,
    });
  }

  return graph;
}

/**
 * Topological sort of service names based on dependencies.
 * Returns services in order such that dependencies come before dependents.
 */
function topologicalSort(
  services: string[],
  graph: Map<string, { layer: LayerInfo; dependencies: string[] }>
): { sorted: string[]; missing: string[] } {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: string[] = [];
  const missing: string[] = [];

  function visit(service: string): void {
    if (visited.has(service)) return;
    if (visiting.has(service)) {
      throw new Error(`Circular dependency detected involving '${service}'`);
    }

    visiting.add(service);

    const entry = graph.get(service);
    if (entry) {
      for (const dep of entry.dependencies) {
        visit(dep);
      }
    } else if (!visited.has(service)) {
      missing.push(service);
    }

    visiting.delete(service);
    visited.add(service);
    sorted.push(service);
  }

  for (const service of services) {
    visit(service);
  }

  return { sorted, missing };
}

/**
 * Find the best layer for each service.
 * Prefers layers from the current source file.
 */
function selectLayers(services: string[], currentFile: string): Map<string, LayerInfo | null> {
  const selected = new Map<string, LayerInfo | null>();

  for (const service of services) {
    const layers = getLayersForService(service);
    if (layers.length === 0) {
      selected.set(service, null);
    } else if (layers.length === 1) {
      selected.set(service, layers[0]);
    } else {
      // Prefer layer from current file, otherwise take first
      const localLayer = layers.find((l) => l.sourceFile === currentFile);
      selected.set(service, localLayer ?? layers[0]);
    }
  }

  return selected;
}

/**
 * Generate the Layer composition AST.
 */
function generateLayerComposition(
  ctx: MacroContext,
  sortedServices: string[],
  selectedLayers: Map<string, LayerInfo | null>,
  graph: Map<string, { layer: LayerInfo; dependencies: string[] }>
): ts.Expression {
  const { factory } = ctx;

  // Build individual layer expressions with their dependencies provided
  const layerExprs: ts.Expression[] = [];

  for (const service of sortedServices) {
    const layer = selectedLayers.get(service);
    if (!layer) continue;

    const entry = graph.get(service);
    const deps = entry?.dependencies ?? [];

    // Start with the base layer identifier
    let expr: ts.Expression = factory.createIdentifier(layer.name);

    // If this layer has dependencies, wrap with Layer.provide
    if (deps.length > 0) {
      // Get the dependency layers
      const depLayers: ts.Expression[] = [];
      for (const dep of deps) {
        const depLayer = selectedLayers.get(dep);
        if (depLayer) {
          depLayers.push(factory.createIdentifier(depLayer.name));
        }
      }

      if (depLayers.length > 0) {
        // Merge multiple dependencies
        let depExpr: ts.Expression;
        if (depLayers.length === 1) {
          depExpr = depLayers[0];
        } else {
          depExpr = factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("Layer"),
              factory.createIdentifier("merge")
            ),
            undefined,
            depLayers
          );
        }

        // layer.pipe(Layer.provide(depLayer))
        expr = factory.createCallExpression(
          factory.createPropertyAccessExpression(expr, factory.createIdentifier("pipe")),
          undefined,
          [
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("Layer"),
                factory.createIdentifier("provide")
              ),
              undefined,
              [depExpr]
            ),
          ]
        );
      }
    }

    layerExprs.push(expr);
  }

  // Merge all top-level layers
  if (layerExprs.length === 0) {
    // No layers found, return Layer.empty
    return factory.createPropertyAccessExpression(
      factory.createIdentifier("Layer"),
      factory.createIdentifier("empty")
    );
  } else if (layerExprs.length === 1) {
    return layerExprs[0];
  } else {
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("merge")
      ),
      undefined,
      layerExprs
    );
  }
}

/**
 * The resolveLayer<R>() expression macro.
 */
export const resolveLayerMacro: ExpressionMacro = defineExpressionMacro({
  name: "resolveLayer",
  description: "Automatically resolve and compose Effect layers for requirements",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const { factory, sourceFile } = ctx;

    // Get the type argument R from resolveLayer<R>()
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "resolveLayer<R>() requires a type argument specifying the required services"
      );
      return factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("empty")
      );
    }

    const requirementsType = typeArgs[0];

    // Extract service names from the type
    const requiredServices = extractServiceNames(ctx, requirementsType);

    if (requiredServices.length === 0) {
      ctx.reportWarning(callExpr, "resolveLayer<R>() received no recognizable service types");
      return factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("empty")
      );
    }

    // Get the current file path for layer selection preference
    const currentFile = sourceFile.fileName;

    // Select the best layer for each service
    const selectedLayers = selectLayers(requiredServices, currentFile);

    // Check for missing layers
    const missingServices: string[] = [];
    for (const [service, layer] of selectedLayers) {
      if (!layer) {
        missingServices.push(service);
      }
    }

    if (missingServices.length > 0) {
      ctx.reportError(
        callExpr,
        `No @layer found for required services: ${missingServices.join(", ")}. ` +
          `Register layers using @layer(${missingServices[0]}) decorator.`
      );
      return factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("empty")
      );
    }

    // Build the dependency graph from all selected layers
    const allLayers = Array.from(selectedLayers.values()).filter((l): l is LayerInfo => l !== null);

    // Also include transitive dependencies
    const allRequiredServices = new Set(requiredServices);
    const queue = [...requiredServices];
    while (queue.length > 0) {
      const service = queue.shift()!;
      const layer = selectedLayers.get(service);
      if (layer) {
        for (const dep of layer.requires) {
          if (!allRequiredServices.has(dep)) {
            allRequiredServices.add(dep);
            queue.push(dep);
            // Select layer for this dependency too
            const depLayers = getLayersForService(dep);
            if (depLayers.length > 0) {
              const localLayer = depLayers.find((l) => l.sourceFile === currentFile);
              selectedLayers.set(dep, localLayer ?? depLayers[0]);
            } else {
              selectedLayers.set(dep, null);
              missingServices.push(dep);
            }
          }
        }
      }
    }

    // Check again for missing transitive dependencies
    if (missingServices.length > 0) {
      ctx.reportError(
        callExpr,
        `No @layer found for transitive dependencies: ${missingServices.join(", ")}. ` +
          `Register layers using @layer decorators.`
      );
      return factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("empty")
      );
    }

    // Build dependency graph with all layers
    const finalLayers = Array.from(selectedLayers.values()).filter(
      (l): l is LayerInfo => l !== null
    );
    const graph = buildDependencyGraph(finalLayers);

    // Topological sort
    try {
      const { sorted, missing } = topologicalSort(Array.from(allRequiredServices), graph);

      if (missing.length > 0) {
        ctx.reportError(callExpr, `Cannot resolve layers for: ${missing.join(", ")}`);
        return factory.createPropertyAccessExpression(
          factory.createIdentifier("Layer"),
          factory.createIdentifier("empty")
        );
      }

      // Generate the layer composition
      return generateLayerComposition(ctx, sorted, selectedLayers, graph);
    } catch (error) {
      ctx.reportError(
        callExpr,
        `Failed to resolve layers: ${error instanceof Error ? error.message : String(error)}`
      );
      return factory.createPropertyAccessExpression(
        factory.createIdentifier("Layer"),
        factory.createIdentifier("empty")
      );
    }
  },
});

/**
 * Runtime placeholder for resolveLayer<R>().
 * Should be transformed at compile time.
 */
export function resolveLayer<R>(): never {
  throw new Error(
    "resolveLayer<R>() was not transformed at compile time. " +
      "Make sure @typesugar/effect is registered with the transformer."
  );
}
