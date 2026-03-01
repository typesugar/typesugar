/**
 * Shared Layer Dependency Graph Utilities
 *
 * Used by both `layerMake<R>(...)` (explicit wiring) and
 * `resolveLayer<R>()` (implicit wiring from registry).
 *
 * Built on `@typesugar/graph` — uses its `topoSort`, `detectCycles`,
 * and `createDigraph` rather than reimplementing graph algorithms.
 *
 * @module
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import { createDigraph, topoSort, detectCycles } from "@typesugar/graph";
import type { Graph } from "@typesugar/graph";
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
  /** The underlying @typesugar/graph Graph (for further analysis) */
  rawGraph: Graph;
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
 * Build a ResolvedLayer map from layer metadata.
 */
function buildResolvedMap(
  layers: LayerInfo[]
): Map<string, ResolvedLayer> {
  const map = new Map<string, ResolvedLayer>();
  for (const layer of layers) {
    map.set(layer.provides, {
      layer,
      dependencies: layer.requires,
    });
  }
  return map;
}

/**
 * Convert layer metadata into a @typesugar/graph Graph for analysis.
 *
 * Nodes = service names, edges = "requires" relationships (from dependent → dependency).
 */
function layersToGraph(layers: LayerInfo[]): Graph {
  const nodeSet = new Set<string>();
  const edges: [string, string][] = [];

  for (const layer of layers) {
    nodeSet.add(layer.provides);
    for (const dep of layer.requires) {
      nodeSet.add(dep);
      edges.push([layer.provides, dep]);
    }
  }

  return createDigraph([...nodeSet], edges);
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

  const resolvedMap = buildResolvedMap(resolvedLayers);
  const rawGraph = layersToGraph(resolvedLayers);

  // Use @typesugar/graph's topoSort with cycle detection
  const sortResult = topoSort(rawGraph);

  let sorted: string[];
  if (sortResult.ok) {
    // topoSort gives dependencies-first order, but we need to
    // reverse since our edges point from dependent → dependency
    sorted = [...sortResult.order].reverse();
  } else {
    // Cycle detected — get the cycle from detectCycles for a better message
    const cycles = detectCycles(rawGraph);
    const cycle = cycles[0] ?? sortResult.cycle;
    throw new CircularDependencyError(
      cycle.length > 0 ? [...cycle, cycle[0]] : sortResult.cycle
    );
  }

  // Add any services that are required but have no layer (missing)
  // so callers can report them
  for (const service of allRequired) {
    if (!sorted.includes(service)) {
      sorted.push(service);
      if (!missing.includes(service)) {
        missing.push(service);
      }
    }
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

  return { sorted, missing, graph: resolvedMap, unused, rawGraph };
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

  // Find top-level services (not depended on by anything in the graph)
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
