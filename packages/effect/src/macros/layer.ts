/**
 * @layer Attribute Macro
 *
 * Transforms a const declaration into an Effect Layer.
 *
 * Input:
 * ```typescript
 * @layer(HttpClient)
 * const httpClientLive = {
 *   get: (url) => Effect.tryPromise(() => fetch(url)),
 *   post: (url, body) => Effect.tryPromise(() => fetch(url, { method: "POST", body: JSON.stringify(body) })),
 * }
 *
 * @layer(UserRepo, { requires: [Database] })
 * const userRepoLive = Effect.gen(function*() {
 *   const db = yield* Database
 *   return {
 *     findById: (id) => db.query(`SELECT * FROM users WHERE id = $1`, [id])
 *   }
 * })
 * ```
 *
 * Output:
 * ```typescript
 * const httpClientLive = Layer.succeed(HttpClientTag, {
 *   get: (url) => Effect.tryPromise(() => fetch(url)),
 *   post: (url, body) => Effect.tryPromise(() => fetch(url, { method: "POST", body: JSON.stringify(body) })),
 * })
 *
 * const userRepoLive = Layer.effect(UserRepoTag, Effect.gen(function*() {
 *   const db = yield* Database
 *   return {
 *     findById: (id) => db.query(`SELECT * FROM users WHERE id = $1`, [id])
 *   }
 * }))
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import { type AttributeMacro, type MacroContext, defineAttributeMacro } from "@typesugar/core";
import { getService, type ServiceInfo } from "./service.js";

/**
 * Layer metadata stored in the registry.
 */
export interface LayerInfo {
  /** Variable name of the layer */
  name: string;
  /** Service this layer provides */
  provides: string;
  /** Services this layer depends on */
  requires: string[];
  /** Source file where the layer was defined */
  sourceFile: string;
  /** Layer type: succeed (sync), effect (async), or scoped (resource) */
  layerType: "succeed" | "effect" | "scoped";
}

/**
 * Registry of `@layer` declarations seen by the transformer.
 *
 * SHAPE (per CLAUDE.md "Resolving things a macro just generated"): this is a
 * LIVE KEYED REGISTRY, written by `@layer` as it expands and read by
 * `resolveLayer<R>()` in the same pass. Within one file that is the safe
 * shape (declare-before-use). ACROSS files it depends on the other file
 * having been transformed earlier in this process — there is no Program-level
 * scan of imported files yet — so `resolveLayer` additionally restricts
 * candidates to the current file's import graph and reports an error (never a
 * silent fallback to every registered layer) when the only providers live in
 * files that are not imported.
 *
 * Keyed by `sourceFile + "\0" + name`, so two files that each declare a
 * `live` layer don't clobber each other, and re-transforming a file (watch
 * mode, language service) replaces its own entries instead of warning.
 */
export const layerRegistry = new Map<string, LayerInfo>();

function layerKey(info: Pick<LayerInfo, "sourceFile" | "name">): string {
  return `${info.sourceFile}\0${info.name}`;
}

/**
 * Register a layer in the registry (replacing an earlier registration of the
 * same layer from the same file).
 */
export function registerLayer(info: LayerInfo): void {
  layerRegistry.set(layerKey(info), info);
}

/**
 * Get layer info by variable name (first match across files), optionally
 * restricted to one source file.
 */
export function getLayer(name: string, sourceFile?: string): LayerInfo | undefined {
  if (sourceFile !== undefined) return layerRegistry.get(layerKey({ sourceFile, name }));
  for (const info of layerRegistry.values()) {
    if (info.name === name) return info;
  }
  return undefined;
}

/**
 * Get all layers that provide a specific service.
 */
export function getLayersForService(serviceName: string): LayerInfo[] {
  return Array.from(layerRegistry.values()).filter((layer) => layer.provides === serviceName);
}

/**
 * Parse @layer decorator arguments.
 * Supports:
 * - @layer(ServiceName)
 * - @layer(ServiceName, { requires: [Dep1, Dep2] })
 */
function parseLayerArgs(
  ctx: MacroContext,
  args: readonly ts.Expression[]
): { serviceName: string; requires: string[] } | undefined {
  if (args.length === 0) {
    return undefined;
  }

  const firstArg = args[0];
  let serviceName: string | undefined;
  let requires: string[] = [];

  // First argument: service identifier
  if (ts.isIdentifier(firstArg)) {
    serviceName = firstArg.text;
  } else if (ts.isStringLiteral(firstArg)) {
    serviceName = firstArg.text;
  } else {
    return undefined;
  }

  // Second argument (optional): options object
  if (args.length > 1 && ts.isObjectLiteralExpression(args[1])) {
    for (const prop of args[1].properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "requires"
      ) {
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          for (const elem of prop.initializer.elements) {
            if (ts.isIdentifier(elem)) {
              requires.push(elem.text);
            } else if (ts.isStringLiteral(elem)) {
              requires.push(elem.text);
            }
          }
        }
      }
    }
  }

  return serviceName ? { serviceName, requires } : undefined;
}

/**
 * Detect the layer type based on the initializer expression.
 * - Object literal → Layer.succeed (sync)
 * - Effect.gen / Effect.flatMap → Layer.effect (async)
 * - Effect.acquireRelease / bracket → Layer.scoped (resource)
 */
function detectLayerType(
  ctx: MacroContext,
  initializer: ts.Expression
): "succeed" | "effect" | "scoped" {
  // If it's an object literal, use Layer.succeed
  if (ts.isObjectLiteralExpression(initializer)) {
    return "succeed";
  }

  // If it's a call expression, check what it calls
  if (ts.isCallExpression(initializer)) {
    const callExpr = initializer.expression;
    if (ts.isPropertyAccessExpression(callExpr)) {
      const methodName = callExpr.name.text;
      const objName = ts.isIdentifier(callExpr.expression) ? callExpr.expression.text : "";

      // Effect.acquireRelease, Effect.acquireUseRelease, etc.
      if (
        objName === "Effect" &&
        (methodName.includes("acquire") || methodName === "scoped" || methodName === "bracket")
      ) {
        return "scoped";
      }
    }
  }

  // Default to effect for anything else (Effect.gen, Effect.map, etc.)
  return "effect";
}

/**
 * Generate the Layer wrapper call.
 */
function generateLayerWrapper(
  ctx: MacroContext,
  serviceName: string,
  initializer: ts.Expression,
  layerType: "succeed" | "effect" | "scoped"
): ts.Expression {
  const factory = ctx.factory;
  const tagIdentifier = factory.createIdentifier(`${serviceName}Tag`);

  const layerMethod =
    layerType === "succeed" ? "succeed" : layerType === "scoped" ? "scoped" : "effect";

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      ctx.ensureImport("Layer", "effect"),
      factory.createIdentifier(layerMethod)
    ),
    undefined,
    [tagIdentifier, initializer]
  );
}

/**
 * @layer attribute macro.
 *
 * Transforms a const declaration into an Effect Layer with:
 * - Automatic Layer.succeed/effect/scoped wrapping
 * - Registration in the layer registry for automatic resolution
 * - Dependency tracking for `resolveLayer<>()`
 */
export const layerAttribute: AttributeMacro = defineAttributeMacro({
  name: "layer",
  module: "@typesugar/effect",
  description: "Define an Effect Layer for a service with automatic wrapping",
  validTargets: ["property"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    const factory = ctx.factory;

    // Handle variable statements (const declarations)
    if (!ts.isVariableDeclaration(target)) {
      ctx.reportError(target, "@layer can only be applied to const declarations");
      return target;
    }

    const varName = ts.isIdentifier(target.name) ? target.name.text : target.name.getText();

    // Parse arguments
    const parsedArgs = parseLayerArgs(ctx, args);
    if (!parsedArgs) {
      ctx.reportError(
        target,
        "@layer requires a service identifier: @layer(ServiceName) or @layer(ServiceName, { requires: [...] })"
      );
      return target;
    }

    const { serviceName, requires } = parsedArgs;

    // Verify service exists (warning only, not error)
    const serviceInfo = getService(serviceName);
    if (!serviceInfo) {
      ctx.reportWarning(
        target,
        `Service '${serviceName}' not found in registry. Make sure @service decorator is applied to the interface.`
      );
    }

    // Get the initializer
    if (!target.initializer) {
      ctx.reportError(target, "@layer requires an initializer (the layer implementation)");
      return target;
    }

    // Detect layer type
    const layerType = detectLayerType(ctx, target.initializer);

    // Register the layer
    registerLayer({
      name: varName,
      provides: serviceName,
      requires,
      sourceFile: ctx.sourceFile.fileName,
      layerType,
    });

    // Generate the wrapped layer
    const wrappedInitializer = generateLayerWrapper(
      ctx,
      serviceName,
      target.initializer,
      layerType
    );

    // Create new variable declaration with wrapped initializer
    const newDeclaration = factory.createVariableDeclaration(
      target.name,
      target.exclamationToken,
      target.type,
      wrappedInitializer
    );

    return newDeclaration;
  },
});

/**
 * Runtime placeholder for @layer decorator.
 * This is a decorator factory that returns a no-op decorator.
 */
export function layer<S>(_service: S, _options?: { requires?: unknown[] }): <T>(target: T) => T {
  return (target) => target;
}
