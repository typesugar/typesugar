/**
 * Shared Layer Dependency Graph Utilities
 *
 * Used by both `Layer.make<R>(...)` (explicit wiring) and
 * `resolveLayer<R>()` (implicit wiring from registry).
 *
 * @module
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import type { LayerInfo } from "./layer.js";

/**
 * A node in the resolved dependency graph, ready for code generation.
 */
export interface ResolvedLayer {
  /** The layer metadata */
  layer: LayerInfo;
  /** Service names this layer depends on */
  dependencies: string[];
}

/**
 * Result of dependency graph resolution.
 */
export interface GraphResolution {
  /** Services in topological order (dependencies before dependents) */
  sorted: string[];
  /** Services that have no layer provider */
  missing: string[];
  /** The full graph with resolved layers */
  graph: Map<string, ResolvedLayer>;
  /** Layers that were provided but not needed */
  unused: LayerInfo[];
}

/**
 * Build a dependency graph from layer metadata.
 */
export function buildDependencyGraph(
  layers: LayerInfo[]
): Map<string, ResolvedLayer> {
  const graph = new Map<string, ResolvedLayer>();

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
 * Throws on circular dependencies with the cycle path.
 */
export function topologicalSort(
  services: string[],
  graph: Map<string, ResolvedLayer>
): { sorted: string[]; missing: string[] } {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  const sorted: string[] = [];
  const missing: string[] = [];

  function visit(service: string): void {
    if (visited.has(service)) return;
    if (visiting.has(service)) {
      const cycleStart = path.indexOf(service);
      const cycle = [...path.slice(cycleStart), service];
      throw new CircularDependencyError(cycle);
    }

    visiting.add(service);
    path.push(service);

    const entry = graph.get(service);
    if (entry) {
      for (const dep of entry.dependencies) {
        visit(dep);
      }
    } else {
      missing.push(service);
    }

    path.pop();
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
 * Error thrown when a circular dependency is detected.
 */
export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(" → ")}`);
    this.name = "CircularDependencyError";
  }
}

/**
 * Resolve the full dependency graph for a set of required services.
 *
 * Starting from the required services, walks transitive dependencies
 * and selects the best layer for each service.
 */
export function resolveGraph(
  requiredServices: string[],
  findLayersForService: (serviceName: string) => LayerInfo[],
  allAvailableLayers?: LayerInfo[],
  preferFile?: string
): GraphResolution {
  const selectedLayers = new Map<string, LayerInfo | null>();
  const allRequired = new Set(requiredServices);
  const queue = [...requiredServices];

  while (queue.length > 0) {
    const service = queue.shift()!;
    if (selectedLayers.has(service)) continue;

    const candidates = findLayersForService(service);
    if (candidates.length === 0) {
      selectedLayers.set(service, null);
      continue;
    }

    const selected =
      (preferFile
        ? candidates.find((l) => l.sourceFile === preferFile)
        : undefined) ?? candidates[0];
    selectedLayers.set(service, selected);

    for (const dep of selected.requires) {
      if (!allRequired.has(dep)) {
        allRequired.add(dep);
        queue.push(dep);
      }
    }
  }

  const missing: string[] = [];
  for (const [service, layer] of selectedLayers) {
    if (!layer) missing.push(service);
  }

  const resolvedLayers = Array.from(selectedLayers.values()).filter(
    (l): l is LayerInfo => l !== null
  );
  const graph = buildDependencyGraph(resolvedLayers);

  let sorted: string[] = [];
  try {
    const result = topologicalSort(Array.from(allRequired), graph);
    sorted = result.sorted;
    missing.push(...result.missing.filter((m) => !missing.includes(m)));
  } catch (e) {
    if (e instanceof CircularDependencyError) {
      throw e;
    }
    throw e;
  }

  const unused: LayerInfo[] = [];
  if (allAvailableLayers) {
    const usedNames = new Set(resolvedLayers.map((l) => l.name));
    for (const l of allAvailableLayers) {
      if (!usedNames.has(l.name)) {
        unused.push(l);
      }
    }
  }

  return { sorted, missing, graph, unused };
}

/**
 * Generate the Layer composition AST from a resolved graph.
 */
export function generateLayerComposition(
  ctx: MacroContext,
  resolution: GraphResolution,
  layerExpressions: Map<string, ts.Expression>
): ts.Expression {
  const { factory } = ctx;
  const { sorted, graph } = resolution;
  const layerExprs: ts.Expression[] = [];

  for (const service of sorted) {
    const entry = graph.get(service);
    if (!entry) continue;

    const baseExpr = layerExpressions.get(entry.layer.name);
    if (!baseExpr) continue;

    let expr: ts.Expression = baseExpr;
    const deps = entry.dependencies;

    if (deps.length > 0) {
      const depExprs: ts.Expression[] = [];
      for (const dep of deps) {
        const depEntry = graph.get(dep);
        if (depEntry) {
          const depExpr = layerExpressions.get(depEntry.layer.name);
          if (depExpr) depExprs.push(depExpr);
        }
      }

      if (depExprs.length > 0) {
        let depExpr: ts.Expression;
        if (depExprs.length === 1) {
          depExpr = depExprs[0];
        } else {
          depExpr = factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("Layer"),
              factory.createIdentifier("merge")
            ),
            undefined,
            depExprs
          );
        }

        expr = factory.createCallExpression(
          factory.createPropertyAccessExpression(
            expr,
            factory.createIdentifier("pipe")
          ),
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

  if (layerExprs.length === 0) {
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
 * Format the resolved dependency graph as a tree string.
 * Follows ZIO's Debug.tree format.
 */
export function formatDebugTree(resolution: GraphResolution): string {
  const { sorted, graph } = resolution;
  const lines: string[] = ["Layer Wiring Graph", ""];

  const topLevel = sorted.filter((s) => {
    for (const [, entry] of graph) {
      if (entry.dependencies.includes(s)) return false;
    }
    return graph.has(s);
  });

  function printNode(service: string, prefix: string, isLast: boolean): void {
    const entry = graph.get(service);
    if (!entry) return;

    const connector = isLast ? "╰─" : "├─";
    const icon = entry.dependencies.length > 0 ? "◑" : "◉";
    lines.push(`${prefix}${connector}${icon} ${entry.layer.name}`);

    const childPrefix = prefix + (isLast ? "  " : "│ ");
    const deps = entry.dependencies.filter((d) => graph.has(d));
    for (let i = 0; i < deps.length; i++) {
      printNode(deps[i], childPrefix, i === deps.length - 1);
    }
  }

  if (topLevel.length === 0) {
    lines.push("  (empty)");
  } else {
    for (let i = 0; i < topLevel.length; i++) {
      const entry = graph.get(topLevel[i]);
      if (!entry) continue;
      const icon = entry.dependencies.length > 0 ? "◑" : "◉";
      lines.push(`${icon} ${entry.layer.name}`);

      const deps = entry.dependencies.filter((d) => graph.has(d));
      for (let j = 0; j < deps.length; j++) {
        printNode(deps[j], "", j === deps.length - 1);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Extract service names from a TypeScript union/intersection type node.
 */
export function extractServiceNames(
  _ctx: MacroContext,
  typeNode: ts.TypeNode
): string[] {
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
