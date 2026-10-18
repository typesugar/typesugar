/**
 * resolveLayer<R>() Expression Macro — Implicit Layer Resolution
 *
 * Automatically resolves and composes layers to satisfy Effect requirements
 * by searching registered layers from the current file's import scope.
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
 *   emailServiceLive.pipe(Layer.provideMerge(httpClientLive.pipe(
 *     Layer.provideMerge(userRepoLive.pipe(Layer.provideMerge(databaseLive)))
 *   )))
 * ))
 * ```
 *
 * Options:
 * - `resolveLayer<R>()` — resolve from import scope
 * - `resolveLayer<R>({ debug: true })` — also emit wiring graph
 *
 * @module
 */

import * as ts from "typescript";
import { type ExpressionMacro, type MacroContext, defineExpressionMacro } from "@typesugar/core";
import { getLayersForService, type LayerInfo } from "./layer.js";
import { EFFECT001, EFFECT020, reportEffectDiagnostic } from "../diagnostics.js";
import {
  resolveGraph,
  generateLayerComposition,
  formatDebugTree,
  extractServiceNames,
  CircularDependencyError,
} from "./layer-graph.js";

/**
 * Collect the set of source files reachable from the current file's imports.
 * This scopes the layer registry to the "import graph" — only layers defined
 * in files that the current file transitively imports are candidates.
 */
function collectImportScope(ctx: MacroContext, maxDepth: number = 5): Set<string> {
  const scope = new Set<string>();
  const sourceFile = ctx.sourceFile;
  scope.add(sourceFile.fileName);

  const program = ctx.program;
  if (!program) return scope;

  const queue: Array<{ file: ts.SourceFile; depth: number }> = [{ file: sourceFile, depth: 0 }];
  const visited = new Set<string>([sourceFile.fileName]);

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    for (const stmt of file.statements) {
      if (!ts.isImportDeclaration(stmt)) continue;
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

      const moduleName = stmt.moduleSpecifier.text;
      const resolved = ts.resolveModuleName(
        moduleName,
        file.fileName,
        program.getCompilerOptions(),
        ts.sys
      );
      const resolvedFileName = resolved.resolvedModule?.resolvedFileName;
      if (!resolvedFileName || visited.has(resolvedFileName)) continue;

      visited.add(resolvedFileName);
      scope.add(resolvedFileName);

      const importedFile = program.getSourceFile(resolvedFileName);
      if (importedFile) {
        queue.push({ file: importedFile, depth: depth + 1 });
      }
    }
  }

  return scope;
}

/**
 * Get layers for a service, scoped to the import graph.
 *
 * There is deliberately NO fallback to the whole registry: a layer declared
 * in a file this file doesn't import is not in scope here, so referencing its
 * variable would be a ReferenceError at runtime (and which layer "wins" would
 * depend on the order files happened to be transformed in). Out-of-scope
 * providers are recorded in `outOfScope` so the caller can name them in its
 * diagnostic.
 */
function getScopedLayersForService(
  serviceName: string,
  importScope: Set<string>,
  outOfScope: Map<string, LayerInfo[]>
): LayerInfo[] {
  const allLayers = getLayersForService(serviceName);
  const scoped = allLayers.filter((l) => importScope.has(l.sourceFile));
  if (scoped.length === 0 && allLayers.length > 0) {
    outOfScope.set(serviceName, allLayers);
  }
  return scoped;
}

/**
 * Check if the argument is an options object with `debug: true`.
 */
function hasDebugOption(args: readonly ts.Expression[]): boolean {
  if (args.length === 0) return false;
  const arg = args[0];
  if (!ts.isObjectLiteralExpression(arg)) return false;

  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "debug" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      return true;
    }
  }
  return false;
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
      return emptyLayer(ctx);
    }

    const debug = hasDebugOption(args);
    const requirementsType = typeArgs[0];
    const requiredServices = extractServiceNames(ctx, requirementsType);

    if (requiredServices.length === 0) {
      ctx.reportWarning(callExpr, "resolveLayer<R>() received no recognizable service types");
      return emptyLayer(ctx);
    }

    // Build the import scope for scoped resolution
    const importScope = collectImportScope(ctx);

    const outOfScope = new Map<string, LayerInfo[]>();
    const findLayers = (service: string): LayerInfo[] =>
      getScopedLayersForService(service, importScope, outOfScope);

    try {
      const resolution = resolveGraph(requiredServices, findLayers, undefined, sourceFile.fileName);

      if (resolution.missing.length > 0) {
        for (const m of resolution.missing) {
          const diag = reportEffectDiagnostic(ctx, EFFECT001).at(callExpr).withArgs({ service: m });
          const providers = outOfScope.get(m);
          if (providers) {
            diag
              .note(
                `'${m}' is provided by ${providers
                  .map((l) => `${l.name} (${l.sourceFile})`)
                  .join(", ")}, which is not imported by this file`
              )
              .help("Import that module or pass the layer to layerMake<R>().");
          } else {
            diag.help(`Add a layer with @layer(${m}).`);
          }
          diag.emit();
        }
        return emptyLayer(ctx);
      }

      // Build expression map from resolved layers (identifiers)
      const layerExprMap = new Map<string, ts.Expression>();
      for (const [, entry] of resolution.graph) {
        layerExprMap.set(entry.layer.name, factory.createIdentifier(entry.layer.name));
      }

      if (debug) {
        const tree = formatDebugTree(resolution);
        ctx.reportWarning(callExpr, tree);
      }

      return generateLayerComposition(ctx, resolution, layerExprMap);
    } catch (e) {
      if (e instanceof CircularDependencyError) {
        reportEffectDiagnostic(ctx, EFFECT020)
          .at(callExpr)
          .note(`Dependency cycle: ${e.cycle.join(" → ")}`)
          .emit();
        return emptyLayer(ctx);
      }
      ctx.reportError(
        callExpr,
        `Failed to resolve layers: ${e instanceof Error ? e.message : String(e)}`
      );
      return emptyLayer(ctx);
    }
  },
});

function emptyLayer(ctx: MacroContext): ts.Expression {
  return ctx.factory.createPropertyAccessExpression(
    ctx.ensureImport("Layer", "effect"),
    ctx.factory.createIdentifier("empty")
  );
}

/**
 * Runtime placeholder for resolveLayer<R>().
 * Should be transformed at compile time.
 */
export function resolveLayer<R>(_options?: { debug?: boolean }): never {
  void _options;
  throw new Error(
    "resolveLayer<R>() was not transformed at compile time. " +
      "Make sure @typesugar/effect is registered with the transformer."
  );
}
