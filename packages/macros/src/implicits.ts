/**
 * Implicit Parameters - @implicits
 *
 * Provides automatic typeclass instance resolution at call sites with
 * automatic propagation through nested calls.
 *
 * ## Overview
 *
 * - `@instance` - (from typeclass.ts) Registers a typeclass instance
 * - `@implicits` - Marks a function as having implicit parameters
 *
 * ## Example
 *
 * ```typescript
 * // Register typeclass instances with @instance
 * @instance
 * const showNumber: Show<number> = {
 *   show: (a) => String(a),
 * };
 *
 * // Mark function as having implicit parameters
 * @implicits
 * function show<A>(a: A, S: Show<A>): string {
 *   return S.show(a);
 * }
 *
 * // Call site - implicit param is filled in automatically!
 * show(42);
 * // Expands to: show(42, Show.summon<number>("number"))
 * ```
 *
 * ## Auto-Detection
 *
 * By default, `@implicits` auto-detects parameters that:
 * - Are typed as `TypeclassName<T>` where `TypeclassName` is a registered typeclass
 * - `T` is a type parameter of the function
 *
 * For disambiguation, you can specify parameter names explicitly:
 * ```typescript
 * @implicits("E")  // Only E is implicit, not the callback f
 * function foo<A>(a: A, f: (x: A) => A, E: Eq<A>): A { ... }
 * ```
 *
 * ## Automatic Propagation
 *
 * When inside an `@implicits` function, resolved instances are automatically
 * passed to nested `@implicits` calls:
 *
 * ```typescript
 * @implicits
 * function outer<A>(a: A, S: Show<A>): void {
 *   inner(a);  // S is automatically passed to inner!
 * }
 *
 * @implicits
 * function inner<A>(a: A, S: Show<A>): void {
 *   console.log(S.show(a));
 * }
 *
 * // With custom instance - flows through!
 * outer(42, customShow);
 * // → inner gets customShow, not the global instance
 * ```
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import { defineAttributeMacro, defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";
import { instanceRegistry, typeclassRegistry } from "./typeclass.js";
import {
  formatResolutionTrace,
  generateHelpFromTrace,
  type ResolutionAttempt,
  type ResolutionTrace,
} from "@typesugar/core";

// ============================================================================
// Types
// ============================================================================

interface ImplicitParamInfo {
  /** Parameter index in the function signature */
  paramIndex: number;
  /** Parameter name */
  paramName: string;
  /** Typeclass name (e.g., "Show") */
  typeclassName: string;
  /** Type parameter name (e.g., "A" in Show<A>) */
  typeParamName: string;
  /** Full type string */
  typeString: string;
}

interface ImplicitsFunctionInfo {
  /** Function name */
  functionName: string;
  /** Source file */
  sourceFile: string;
  /** Implicit parameters */
  implicitParams: ImplicitParamInfo[];
  /** Total parameter count */
  totalParams: number;
  /** Type parameters of the function */
  typeParams: string[];
  /** Explicitly specified param names (if any) */
  explicitParamNames?: string[];
}

/** Registry of functions marked with @implicits */
const implicitsFunctions = new Map<string, ImplicitsFunctionInfo>();

/**
 * Implicit scope - tracks which implicit instances are available
 * at the current point in the code (for propagation).
 */
interface ImplicitScope {
  /** Map of typeclass+type -> variable name providing it */
  available: Map<string, string>;
}

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Register a function that has implicit parameters
 */
export function registerImplicitsFunction(info: ImplicitsFunctionInfo): void {
  const key = `${info.sourceFile}::${info.functionName}`;
  implicitsFunctions.set(key, info);
}

/**
 * Get function info if it has @implicits decorator
 */
export function getImplicitsFunction(
  functionName: string,
  sourceFile?: string
): ImplicitsFunctionInfo | undefined {
  if (sourceFile) {
    const key = `${sourceFile}::${functionName}`;
    const result = implicitsFunctions.get(key);
    if (result) return result;
  }

  for (const info of Array.from(implicitsFunctions.values())) {
    if (info.functionName === functionName) {
      return info;
    }
  }

  return undefined;
}

/**
 * Check if a type name is a registered typeclass
 */
export function isRegisteredTypeclass(name: string): boolean {
  return typeclassRegistry.has(name);
}

/**
 * Resolve an implicit instance from the registry
 */
export function resolveImplicit(
  typeclassName: string,
  forType: string
): { instanceName: string; derived: boolean } | undefined {
  const instance = instanceRegistry.find(
    (i) => i.typeclassName === typeclassName && i.forType === forType
  );
  if (instance) {
    return {
      instanceName: instance.instanceName,
      derived: instance.derived ?? false,
    };
  }
  return undefined;
}

// ============================================================================
// @implicits - Function Decorator
// ============================================================================

export const implicitsAttribute = defineAttributeMacro({
  name: "implicits",
  // No module constraint - @implicits is used as a bare decorator without importing
  description: "Mark a function as having implicit parameters that are auto-resolved",
  validTargets: ["function"],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target) || !target.name) {
      ctx.reportError(decorator, "@implicits can only be applied to named function declarations");
      return target;
    }

    const functionName = target.name.text;

    // Extract explicit param names from decorator args (if provided)
    const explicitParamNames: string[] = [];
    for (const arg of args) {
      if (ts.isStringLiteral(arg)) {
        explicitParamNames.push(arg.text);
      }
    }

    // Extract type parameters
    const typeParams: string[] = [];
    if (target.typeParameters) {
      for (const tp of target.typeParameters) {
        typeParams.push(tp.name.text);
      }
    }

    // Detect implicit parameters
    const implicitParams: ImplicitParamInfo[] = [];

    for (let i = 0; i < target.parameters.length; i++) {
      const param = target.parameters[i];
      const paramName = ts.isIdentifier(param.name)
        ? param.name.text
        : ctx.hygiene.mangleName(`p${i}`);

      // If explicit names provided, only those are implicit
      if (explicitParamNames.length > 0) {
        if (!explicitParamNames.includes(paramName)) {
          continue;
        }
      }

      // Check if param type is TypeclassName<TypeParam>
      if (!param.type || !ts.isTypeReferenceNode(param.type)) {
        continue;
      }

      const typeName = param.type.typeName;
      if (!ts.isIdentifier(typeName)) {
        continue;
      }

      const typeclassName = typeName.text;

      // Must be a registered typeclass (or we're in auto-detect mode with explicit names)
      if (explicitParamNames.length === 0 && !isRegisteredTypeclass(typeclassName)) {
        continue;
      }

      // Get type argument
      const typeArgs = param.type.typeArguments;
      if (!typeArgs || typeArgs.length === 0) {
        continue;
      }

      const typeArg = typeArgs[0];
      const typeParamName = typeArg.getText();

      // In auto-detect mode, type arg must be a type parameter of the function
      if (explicitParamNames.length === 0 && !typeParams.includes(typeParamName)) {
        continue;
      }

      implicitParams.push({
        paramIndex: i,
        paramName,
        typeclassName,
        typeParamName,
        typeString: param.type.getText(),
      });
    }

    if (implicitParams.length === 0) {
      ctx.reportWarning(
        decorator,
        `@implicits on '${functionName}' found no implicit parameters. ` +
          `Implicit params must be typed as Typeclass<T> where Typeclass is registered.`
      );
    }

    // Register the function
    registerImplicitsFunction({
      functionName,
      sourceFile: ctx.sourceFile.fileName,
      implicitParams,
      totalParams: target.parameters.length,
      typeParams,
      explicitParamNames: explicitParamNames.length > 0 ? explicitParamNames : undefined,
    });

    // Remove the @implicits decorator from output
    return target;
  },
});

// ============================================================================
// Call Site Transformation
// ============================================================================

/**
 * Transform a call to an @implicits function by filling in missing parameters.
 *
 * This handles:
 * 1. Resolving implicits from the global registry
 * 2. Propagating implicits from enclosing @implicits functions
 *
 * @param ctx - Macro context
 * @param callExpr - The call expression to transform
 * @param enclosingScope - Implicits available from enclosing function (for propagation)
 */
export function transformImplicitsCall(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  enclosingScope?: ImplicitScope
): ts.Expression | undefined {
  // Get function name
  const callee = callExpr.expression;
  let functionName: string | undefined;

  if (ts.isIdentifier(callee)) {
    functionName = callee.text;
  } else if (ts.isPropertyAccessExpression(callee)) {
    functionName = callee.name.text;
  }

  if (!functionName) {
    return undefined;
  }

  // Check if this is an @implicits function
  const funcInfo = getImplicitsFunction(functionName);
  if (!funcInfo) {
    return undefined;
  }

  // If all args provided, nothing to do
  const providedArgs = callExpr.arguments.length;
  if (providedArgs >= funcInfo.totalParams) {
    return undefined;
  }

  const factory = ctx.factory;
  const newArgs: ts.Expression[] = [...callExpr.arguments];

  // Infer type parameter mappings from provided args.
  // Strategy:
  //   1. Explicit type arguments: use them directly
  //   2. Resolved signature: let TypeScript infer type params from arguments
  //   3. Per-implicit fallback: extract concrete type from the resolved param type
  const typeParamMap = new Map<string, string>();

  if (callExpr.typeArguments) {
    for (let i = 0; i < callExpr.typeArguments.length; i++) {
      if (i < funcInfo.typeParams.length) {
        typeParamMap.set(funcInfo.typeParams[i], callExpr.typeArguments[i].getText());
      }
    }
  } else {
    // Use getResolvedSignature to let TypeScript infer type params correctly.
    // This handles cases like T[] matching number[] → T = number.
    try {
      const resolvedSig = ctx.typeChecker.getResolvedSignature(callExpr);
      if (resolvedSig) {
        const resolvedParams = resolvedSig.getParameters();
        for (const implicitParam of funcInfo.implicitParams) {
          if (implicitParam.paramIndex < resolvedParams.length) {
            const paramSymbol = resolvedParams[implicitParam.paramIndex];
            const paramType = ctx.typeChecker.getTypeOfSymbolAtLocation(paramSymbol, callExpr);
            const paramTypeString = ctx.typeChecker.typeToString(paramType);

            // Extract the type argument from "Typeclass<ConcreteType>"
            const match = paramTypeString.match(/^\w+<(.+)>$/);
            if (match) {
              typeParamMap.set(implicitParam.typeParamName, match[1]);
            }
          }
        }
      }
    } catch {
      // Fall back to naive inference if getResolvedSignature fails
      if (callExpr.arguments.length > 0 && funcInfo.typeParams.length > 0) {
        const firstArg = callExpr.arguments[0];
        const argType = ctx.typeChecker.getTypeAtLocation(firstArg);
        const argTypeString = ctx.typeChecker.typeToString(argType);
        typeParamMap.set(funcInfo.typeParams[0], argTypeString);
      }
    }
  }

  // Fill in missing implicit parameters
  for (const implicitParam of funcInfo.implicitParams) {
    // Skip if already provided
    if (implicitParam.paramIndex < providedArgs) {
      continue;
    }

    // Resolve concrete type
    let concreteType = implicitParam.typeParamName;
    if (typeParamMap.has(concreteType)) {
      concreteType = typeParamMap.get(concreteType)!;
    }

    // Key for scope lookup
    const scopeKey = `${implicitParam.typeclassName}<${concreteType}>`;

    // 1. First check enclosing scope (propagation)
    if (enclosingScope?.available.has(scopeKey)) {
      const varName = enclosingScope.available.get(scopeKey)!;

      // Pad with undefined if needed
      while (newArgs.length < implicitParam.paramIndex) {
        newArgs.push(factory.createIdentifier("undefined"));
      }
      newArgs.push(factory.createIdentifier(varName));
      continue;
    }

    // 2. Fall back to global registry
    const resolved = resolveImplicit(implicitParam.typeclassName, concreteType);

    if (resolved) {
      // Generate: TC.summon<Type>("Type")
      const summonExpr = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier(implicitParam.typeclassName),
          "summon"
        ),
        [factory.createTypeReferenceNode(concreteType, undefined)],
        [factory.createStringLiteral(concreteType)]
      );

      while (newArgs.length < implicitParam.paramIndex) {
        newArgs.push(factory.createIdentifier("undefined"));
      }
      newArgs.push(summonExpr);
    } else {
      // Build resolution trace for detailed error
      const tcName = implicitParam.typeclassName;
      const attempts: ResolutionAttempt[] = [
        {
          step: "enclosing-scope",
          target: scopeKey,
          result: "not-found",
          reason: "not available in current implicit scope",
        },
        {
          step: "explicit-instance",
          target: `${tcName}<${concreteType}>`,
          result: "not-found",
          reason: "no @instance or @deriving registered",
        },
      ];

      const trace: ResolutionTrace = {
        sought: `${tcName}<${concreteType}>`,
        attempts,
        finalResult: "failed",
      };

      const traceNotes = formatResolutionTrace(trace);
      const helpMessage = generateHelpFromTrace(trace, tcName, concreteType);

      // Build a rich error message with the trace
      const errorLines = [
        `No instance found for \`${tcName}<${concreteType}>\``,
        "",
        ...traceNotes.map((note) => `  = note: ${note}`),
        `  = note: implicit parameter: ${implicitParam.paramName}`,
        `  = help: ${helpMessage}`,
      ];

      ctx.reportError(callExpr, errorLines.join("\n"));
      return undefined;
    }
  }

  return factory.updateCallExpression(
    callExpr,
    callExpr.expression,
    callExpr.typeArguments,
    newArgs
  );
}

/**
 * Build an implicit scope from a function's parameters.
 * Used for propagation - the implicit params become available to nested calls.
 */
export function buildImplicitScope(
  funcInfo: ImplicitsFunctionInfo,
  typeParamMap: Map<string, string>
): ImplicitScope {
  const available = new Map<string, string>();

  for (const param of funcInfo.implicitParams) {
    let concreteType = param.typeParamName;
    if (typeParamMap.has(concreteType)) {
      concreteType = typeParamMap.get(concreteType)!;
    }

    const key = `${param.typeclassName}<${concreteType}>`;
    available.set(key, param.paramName);
  }

  return { available };
}

// ============================================================================
// Process @implicits function body for nested call transformation
// ============================================================================

/**
 * Process a function body, transforming nested @implicits calls with propagation.
 * This is called by the transformer when visiting an @implicits function.
 */
export function processImplicitsFunctionBody(
  ctx: MacroContext,
  func: ts.FunctionDeclaration,
  funcInfo: ImplicitsFunctionInfo
): ts.FunctionDeclaration {
  // For now, we'll handle propagation at the transformer level
  // The transformer needs to track the current scope as it visits
  return func;
}

// ============================================================================
// Convenience: summonAll - Summon multiple instances at once
// ============================================================================

export const summonAllMacro = defineExpressionMacro({
  name: "summonAll",
  module: "typemacro",
  description: "Summon multiple typeclass instances as a tuple",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length === 0) {
      ctx.reportError(
        callExpr,
        "summonAll requires type arguments, e.g., summonAll<Show<Point>, Eq<Point>>()"
      );
      return callExpr;
    }

    const factory = ctx.factory;
    const summonedExprs: ts.Expression[] = [];

    for (const typeArg of typeArgs) {
      if (!ts.isTypeReferenceNode(typeArg)) {
        ctx.reportError(
          typeArg,
          "summonAll type arguments must be type references like Show<Point>"
        );
        continue;
      }

      const tcName = typeArg.typeName.getText();
      const innerTypeArgs = typeArg.typeArguments;

      if (!innerTypeArgs || innerTypeArgs.length === 0) {
        ctx.reportError(typeArg, `Type ${tcName} requires a type argument`);
        continue;
      }

      const forType = innerTypeArgs[0].getText();

      summonedExprs.push(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier(tcName), "summon"),
          [factory.createTypeReferenceNode(forType, undefined)],
          [factory.createStringLiteral(forType)]
        )
      );
    }

    return factory.createArrayLiteralExpression(summonedExprs);
  },
});

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(implicitsAttribute);
globalRegistry.register(summonAllMacro);

// ============================================================================
// Exports
// ============================================================================

export type { ImplicitParamInfo, ImplicitsFunctionInfo, ImplicitScope };
export { implicitsFunctions };
