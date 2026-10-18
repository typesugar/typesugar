/**
 * @service Attribute Macro
 *
 * Transforms an interface into an Effect Context.Tag service.
 *
 * Input:
 * ```typescript
 * @service
 * interface HttpClient {
 *   get(url: string): Effect.Effect<Response, HttpError>
 *   post(url: string, body: unknown): Effect.Effect<Response, HttpError>
 * }
 * ```
 *
 * Output:
 * ```typescript
 * interface HttpClient {
 *   get(url: string): Effect.Effect<Response, HttpError>
 *   post(url: string, body: unknown): Effect.Effect<Response, HttpError>
 * }
 *
 * export class HttpClientTag extends Context.Tag("HttpClient")<
 *   HttpClientTag,
 *   {
 *     readonly get: (url: string) => Effect.Effect<Response, HttpError>
 *     readonly post: (url: string, body: unknown) => Effect.Effect<Response, HttpError>
 *   }
 * >() {}
 *
 * export namespace HttpClient {
 *   export const Tag = HttpClientTag
 *   export const get = Effect.serviceFunctionEffect(HttpClientTag, (_) => _.get)
 *   export const post = Effect.serviceFunctionEffect(HttpClientTag, (_) => _.post)
 * }
 * ```
 *
 * @module
 */

import * as ts from "typescript";
import { type AttributeMacro, type MacroContext, defineAttributeMacro } from "@typesugar/core";

/**
 * Service metadata stored in the registry.
 */
export interface ServiceInfo {
  /** Service name (interface name) */
  name: string;
  /** Methods exposed by the service */
  methods: ServiceMethodInfo[];
  /** Source file where the service was defined */
  sourceFile: string;
}

/**
 * Method metadata for a service.
 */
export interface ServiceMethodInfo {
  /** Method name */
  name: string;
  /** Parameter signatures as strings */
  params: Array<{ name: string; typeString: string }>;
  /** Return type string (usually Effect.Effect<...>) */
  returnType: string;
}

/**
 * Registry of `@service` declarations seen by the transformer, keyed by
 * service name.
 *
 * SHAPE (per CLAUDE.md "Resolving things a macro just generated"): a LIVE
 * KEYED REGISTRY written by `@service` as it expands and read by `@layer` in
 * the same pass. It is advisory only — `@layer` uses it for a "service not
 * found" warning and never generates code from it — so a service declared in
 * a file that has not been transformed yet just produces that warning.
 * Re-registration from the SAME file (watch mode, a re-expanded file) silently
 * replaces the entry; a same-named service from a DIFFERENT file is a real
 * name clash and warns.
 */
export const serviceRegistry = new Map<string, ServiceInfo>();

/**
 * Register a service in the registry (replacing any earlier entry).
 */
export function registerService(info: ServiceInfo): void {
  const existing = serviceRegistry.get(info.name);
  if (existing && existing.sourceFile !== info.sourceFile) {
    console.warn(`Service '${info.name}' is already registered, overwriting.`);
  }
  serviceRegistry.set(info.name, info);
}

/**
 * Get service info by name.
 */
export function getService(name: string): ServiceInfo | undefined {
  return serviceRegistry.get(name);
}

/**
 * Extract method information from an interface.
 */
function extractMethods(ctx: MacroContext, iface: ts.InterfaceDeclaration): ServiceMethodInfo[] {
  const methods: ServiceMethodInfo[] = [];
  const typeChecker = ctx.typeChecker;

  for (const member of iface.members) {
    if (ts.isMethodSignature(member) && member.name) {
      const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

      const params: Array<{ name: string; typeString: string }> = [];
      for (const param of member.parameters) {
        const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
        const paramType = param.type
          ? param.type.getText()
          : typeChecker.typeToString(typeChecker.getTypeAtLocation(param));
        params.push({ name: paramName, typeString: paramType });
      }

      const returnType = member.type ? member.type.getText() : "unknown";

      methods.push({ name: methodName, params, returnType });
    } else if (ts.isPropertySignature(member) && member.name && member.type) {
      // Handle property signatures that are function types
      if (ts.isFunctionTypeNode(member.type)) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : member.name.getText();

        const params: Array<{ name: string; typeString: string }> = [];
        for (const param of member.type.parameters) {
          const paramName = ts.isIdentifier(param.name) ? param.name.text : param.name.getText();
          const paramType = param.type ? param.type.getText() : "unknown";
          params.push({ name: paramName, typeString: paramType });
        }

        const returnType = member.type.type ? member.type.type.getText() : "unknown";

        methods.push({ name: methodName, params, returnType });
      }
    }
  }

  return methods;
}

/**
 * Build the service-shape type literal from the interface's own member nodes.
 *
 * Method signatures become `readonly name: <T>(params) => R` reusing the
 * ORIGINAL type-parameter, parameter and return-type nodes, so `?`, `...rest`,
 * defaults-free optional params, method generics and `this` types survive
 * exactly (a previous version rebuilt each parameter from its text as a
 * `TypeReference`, dropping `?`/`...` and method type parameters). Property
 * signatures are kept as `readonly` properties.
 */
function buildShapeType(ctx: MacroContext, iface: ts.InterfaceDeclaration): ts.TypeLiteralNode {
  const factory = ctx.factory;
  const readonly = () => [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)];
  const members: ts.TypeElement[] = [];
  for (const member of iface.members) {
    if (ts.isMethodSignature(member)) {
      members.push(
        factory.createPropertySignature(
          readonly(),
          member.name,
          member.questionToken,
          factory.createFunctionTypeNode(
            member.typeParameters,
            member.parameters,
            member.type ?? factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
          )
        )
      );
    } else if (ts.isPropertySignature(member)) {
      members.push(
        factory.createPropertySignature(
          readonly(),
          member.name,
          member.questionToken,
          member.type ?? factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
        )
      );
    } else {
      ctx.reportWarning(
        member,
        "@service: only method and property signatures are part of the service shape; this member is ignored"
      );
    }
  }
  return factory.createTypeLiteralNode(members);
}

/**
 * Generate the Context.Tag class declaration:
 * `export class XTag extends Context.Tag("X")<XTag, Shape>() {}`.
 * `Context` is referenced through `ctx.ensureImport`, so the file needn't
 * import it.
 */
function generateTagClass(
  ctx: MacroContext,
  iface: ts.InterfaceDeclaration,
  serviceName: string
): ts.ClassDeclaration {
  const factory = ctx.factory;
  const tagClassName = `${serviceName}Tag`;

  const tagCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(ctx.ensureImport("Context", "effect"), "Tag"),
    undefined,
    [factory.createStringLiteral(serviceName)]
  );

  // Context.Tag("X")<XTag, Shape>()
  const extendsExpression = factory.createCallExpression(
    factory.createExpressionWithTypeArguments(tagCall, [
      factory.createTypeReferenceNode(tagClassName),
      buildShapeType(ctx, iface),
    ]),
    undefined,
    []
  );

  const heritageClause = factory.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
    factory.createExpressionWithTypeArguments(extendsExpression, []),
  ]);

  return factory.createClassDeclaration(
    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    factory.createIdentifier(tagClassName),
    undefined,
    [heritageClause],
    []
  );
}

/**
 * Generate accessor functions namespace.
 */
function generateAccessorNamespace(
  ctx: MacroContext,
  serviceName: string,
  methods: ServiceMethodInfo[]
): ts.ModuleDeclaration {
  const factory = ctx.factory;
  const statements: ts.Statement[] = [];

  // Generate const accessor for the Tag
  statements.push(
    factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier("Tag"),
            undefined,
            undefined,
            factory.createIdentifier(`${serviceName}Tag`)
          ),
        ],
        ts.NodeFlags.Const
      )
    )
  );

  // Generate Effect.serviceFunctionEffect for each method
  for (const method of methods) {
    // Accessors are `export const <name>`; a quoted/computed method name has no
    // identifier form (it stays reachable through the Tag).
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method.name)) continue;
    const accessor = factory.createVariableStatement(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier(method.name),
            undefined,
            undefined,
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                ctx.ensureImport("Effect", "effect"),
                factory.createIdentifier("serviceFunctionEffect")
              ),
              undefined,
              [
                factory.createIdentifier(`${serviceName}Tag`),
                factory.createArrowFunction(
                  undefined,
                  undefined,
                  [
                    factory.createParameterDeclaration(
                      undefined,
                      undefined,
                      factory.createIdentifier("_")
                    ),
                  ],
                  undefined,
                  factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("_"),
                    factory.createIdentifier(method.name)
                  )
                ),
              ]
            )
          ),
        ],
        ts.NodeFlags.Const
      )
    );
    statements.push(accessor);
  }

  return factory.createModuleDeclaration(
    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    factory.createIdentifier(serviceName),
    factory.createModuleBlock(statements),
    ts.NodeFlags.Namespace
  );
}

/**
 * @service attribute macro.
 *
 * Transforms an interface into an Effect Context.Tag service with:
 * - A Context.Tag class for dependency injection
 * - A namespace with accessor functions for each method
 * - Registration in the service registry for layer resolution
 */
export const serviceAttribute: AttributeMacro = defineAttributeMacro({
  name: "service",
  module: "@typesugar/effect",
  description: "Define an Effect service from an interface with Context.Tag",
  validTargets: ["interface"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isInterfaceDeclaration(target)) {
      ctx.reportError(target, "@service can only be applied to interfaces");
      return target;
    }

    const serviceName = target.name.text;

    // Extract method information
    const methods = extractMethods(ctx, target);

    if (methods.length === 0) {
      ctx.reportWarning(
        target,
        `@service interface '${serviceName}' has no methods. Consider adding methods that return Effect.Effect<...>.`
      );
    }

    // Register the service
    registerService({
      name: serviceName,
      methods,
      sourceFile: ctx.sourceFile.fileName,
    });

    // Generate outputs
    const outputs: ts.Node[] = [];

    // 1. Keep the original interface (unchanged)
    outputs.push(target);

    // 2. Generate the Context.Tag class
    outputs.push(generateTagClass(ctx, target, serviceName));

    // 3. Generate the accessor namespace
    outputs.push(generateAccessorNamespace(ctx, serviceName, methods));

    return outputs;
  },
});

/**
 * Runtime placeholder for @service (should be transformed at compile time).
 * This is a no-op decorator that signals to the macro system.
 */
export function service<T>(_target: T): T {
  return _target;
}
