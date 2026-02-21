/**
 * Macro Composition Pipeline
 *
 * Provides a way to compose multiple macros into a single transformation
 * pipeline, where the output of one macro feeds into the next.
 *
 * Inspired by: Unix pipes, Elixir |>, Scala andThen, Rust Iterator adapters
 *
 * @example
 * ```typescript
 * import { pipeline, defineExpressionMacro } from "typesugar";
 *
 * // Compose macros: first validate, then transform, then optimize
 * const myMacro = pipeline("myMacro")
 *   .pipe(validateInputMacro)
 *   .pipe(transformMacro)
 *   .pipe(optimizeMacro)
 *   .build();
 *
 * // Or compose at the expression level:
 * const result = pipe(
 *   inputExpr,
 *   macro1,
 *   macro2,
 *   macro3,
 * );
 * ```
 */

import * as ts from "typescript";
import { ExpressionMacro, MacroContext, MacroDefinitionBase } from "./types.js";
import { defineExpressionMacro, globalRegistry } from "./registry.js";

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * A transformation step in a pipeline.
 * Takes an expression and returns a transformed expression.
 */
export type PipelineStep = (ctx: MacroContext, expr: ts.Expression) => ts.Expression;

/**
 * A pipeline builder for composing macro transformations.
 */
export class MacroPipeline {
  private steps: PipelineStep[] = [];
  private macroName: string;
  private macroModule?: string;

  constructor(name: string, module?: string) {
    this.macroName = name;
    this.macroModule = module;
  }

  /**
   * Add a transformation step to the pipeline.
   * Steps are executed in order, each receiving the output of the previous.
   */
  pipe(step: PipelineStep | ExpressionMacro): MacroPipeline {
    if ("expand" in step && "kind" in step) {
      // It's an ExpressionMacro — wrap it as a PipelineStep
      const macro = step as ExpressionMacro;
      this.steps.push((ctx, expr) => {
        // Create a synthetic call expression for the macro
        const callExpr = ctx.factory.createCallExpression(
          ctx.factory.createIdentifier(macro.name),
          undefined,
          [expr]
        );
        return macro.expand(ctx, callExpr, [expr]);
      });
    } else {
      this.steps.push(step as PipelineStep);
    }
    return this;
  }

  /**
   * Add a conditional step that only runs when the predicate is true.
   */
  pipeIf(
    predicate: (ctx: MacroContext, expr: ts.Expression) => boolean,
    step: PipelineStep | ExpressionMacro
  ): MacroPipeline {
    const wrappedStep =
      "expand" in step && "kind" in step
        ? (ctx: MacroContext, expr: ts.Expression) => {
            const macro = step as ExpressionMacro;
            const callExpr = ctx.factory.createCallExpression(
              ctx.factory.createIdentifier(macro.name),
              undefined,
              [expr]
            );
            return macro.expand(ctx, callExpr, [expr]);
          }
        : (step as PipelineStep);

    this.steps.push((ctx, expr) => {
      if (predicate(ctx, expr)) {
        return wrappedStep(ctx, expr);
      }
      return expr;
    });
    return this;
  }

  /**
   * Add a step that maps over array elements (if the expression is an array literal).
   */
  mapElements(step: PipelineStep): MacroPipeline {
    this.steps.push((ctx, expr) => {
      if (ts.isArrayLiteralExpression(expr)) {
        const newElements = expr.elements.map((el) => (ts.isExpression(el) ? step(ctx, el) : el));
        // multiLine is not in the public TS API, check if it exists on the node
        const multiLine = (expr as unknown as { multiLine?: boolean }).multiLine ?? false;
        return ctx.factory.createArrayLiteralExpression(newElements, multiLine);
      }
      return step(ctx, expr);
    });
    return this;
  }

  /**
   * Build the pipeline into a registered ExpressionMacro.
   */
  build(options?: { register?: boolean; description?: string }): ExpressionMacro {
    const steps = [...this.steps];
    const macro = defineExpressionMacro({
      name: this.macroName,
      module: this.macroModule,
      description:
        options?.description ?? `Pipeline macro: ${this.macroName} (${steps.length} steps)`,

      expand(
        ctx: MacroContext,
        callExpr: ts.CallExpression,
        args: readonly ts.Expression[]
      ): ts.Expression {
        if (args.length !== 1) {
          ctx.reportError(callExpr, `Pipeline macro '${macro.name}' expects exactly one argument`);
          return callExpr;
        }

        let current: ts.Expression = args[0];

        for (let i = 0; i < steps.length; i++) {
          try {
            current = steps[i](ctx, current);
          } catch (error) {
            ctx.reportError(
              callExpr,
              `Pipeline macro '${macro.name}' failed at step ${i + 1}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return callExpr;
          }
        }

        return current;
      },
    });

    if (options?.register !== false) {
      globalRegistry.register(macro);
    }

    return macro;
  }

  /**
   * Execute the pipeline directly (without registering as a macro).
   */
  execute(ctx: MacroContext, input: ts.Expression): ts.Expression {
    let current = input;
    for (const step of this.steps) {
      current = step(ctx, current);
    }
    return current;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new macro pipeline.
 *
 * @param name - The name for the composed macro
 * @param module - Optional module specifier for import-scoped activation
 * @returns A pipeline builder
 */
export function pipeline(name: string, module?: string): MacroPipeline {
  return new MacroPipeline(name, module);
}

// =============================================================================
// Utility Steps
// =============================================================================

/**
 * A pipeline step that wraps an expression in parentheses.
 */
export function parenthesize(_ctx: MacroContext, expr: ts.Expression): ts.Expression {
  return ts.factory.createParenthesizedExpression(expr);
}

/**
 * A pipeline step that wraps an expression in a type assertion.
 */
export function assertType(typeName: string): PipelineStep {
  return (ctx, expr) => {
    const typeNode = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(typeName));
    return ctx.factory.createAsExpression(expr, typeNode);
  };
}

/**
 * A pipeline step that wraps an expression in a void operator.
 */
export function voidify(_ctx: MacroContext, expr: ts.Expression): ts.Expression {
  return ts.factory.createVoidExpression(expr);
}

/**
 * A pipeline step that wraps an expression in an await.
 */
export function awaitify(_ctx: MacroContext, expr: ts.Expression): ts.Expression {
  return ts.factory.createAwaitExpression(expr);
}

/**
 * A pipeline step that logs the expression (for debugging pipelines).
 */
export function debugStep(label: string): PipelineStep {
  return (ctx, expr) => {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const text = printer.printNode(ts.EmitHint.Expression, expr, ctx.sourceFile);
    console.log(`[pipeline:${label}] ${text}`);
    return expr;
  };
}
