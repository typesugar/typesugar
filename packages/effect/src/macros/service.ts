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
 * class HttpClient extends Context.Tag("HttpClient")<
 *   HttpClient,
 *   {
 *     readonly get: (url: string) => Effect.Effect<Response, HttpError>
 *     readonly post: (url: string, body: unknown) => Effect.Effect<Response, HttpError>
 *   }
 * >() {}
 *
 * namespace HttpClient {
 *   export const get = Effect.serviceFunctionEffect(HttpClient, (_: HttpClient) => _.get)
 *   export const post = Effect.serviceFunctionEffect(HttpClient, (_: HttpClient) => _.post)
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
 * Global registry for Effect services.
 * Maps service name to service metadata.
 */
export const serviceRegistry = new Map<string, ServiceInfo>();

/**
 * Register a service in the global registry.
 */
export function registerService(info: ServiceInfo): void {
  if (serviceRegistry.has(info.name)) {
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
 * Generate the Context.Tag class declaration.
 */
function generateTagClass(
  factory: ts.NodeFactory,
  serviceName: string,
  methods: ServiceMethodInfo[]
): ts.ClassDeclaration {
  // Build the service shape type literal
  const typeMembers: ts.TypeElement[] = methods.map((method) => {
    // Build parameter types for the function type
    const paramTypes: ts.ParameterDeclaration[] = method.params.map((p) =>
      factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier(p.name),
        undefined,
        factory.createTypeReferenceNode(p.typeString)
      )
    );

    // Create the function type
    const funcType = factory.createFunctionTypeNode(
      undefined,
      paramTypes,
      factory.createTypeReferenceNode(method.returnType)
    );

    // Create readonly property signature
    return factory.createPropertySignature(
      [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
      factory.createIdentifier(method.name),
      undefined,
      funcType
    );
  });

  const shapeTypeLiteral = factory.createTypeLiteralNode(typeMembers);

  // Context.Tag("ServiceName")<ServiceName, ShapeType>()
  // This is a complex heritage clause
  const tagCall = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Context"),
      factory.createIdentifier("Tag")
    ),
    undefined,
    [factory.createStringLiteral(serviceName)]
  );

  // The extends clause: Context.Tag("ServiceName")<ServiceName, ShapeType>()
  const extendsExpression = factory.createCallExpression(
    factory.createExpressionWithTypeArguments(tagCall, [
      factory.createTypeReferenceNode(serviceName),
      shapeTypeLiteral,
    ]),
    undefined,
    []
  );

  const heritageClause = factory.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
    factory.createExpressionWithTypeArguments(extendsExpression, []),
  ]);

  return factory.createClassDeclaration(
    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    factory.createIdentifier(`${serviceName}Tag`),
    undefined,
    [heritageClause],
    []
  );
}

/**
 * Generate accessor functions namespace.
 */
function generateAccessorNamespace(
  factory: ts.NodeFactory,
  serviceName: string,
  methods: ServiceMethodInfo[]
): ts.ModuleDeclaration {
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
                factory.createIdentifier("Effect"),
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
    const factory = ctx.factory;

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
    outputs.push(generateTagClass(factory, serviceName, methods));

    // 3. Generate the accessor namespace
    outputs.push(generateAccessorNamespace(factory, serviceName, methods));

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
