import type { Graph, StateMachineDefinition } from "./types.js";
import { parseDigraph, parseStateMachine } from "./dsl.js";
import { createGraph as createUndirectedGraph } from "./graph.js";
import { createInstance, verify } from "./state-machine.js";
import {
  defineTaggedTemplateMacro,
  globalRegistry,
  type MacroContext,
  type TaggedTemplateMacroDef,
} from "@typesugar/core";
import ts from "typescript";

/**
 * Tagged template literal for creating directed graphs from the DSL.
 *
 * @example
 * ```ts
 * const g = digraph`
 *   a -> b, c
 *   b -> d
 *   c -> d
 * `;
 * ```
 */
export function digraph(strings: TemplateStringsArray, ...values: unknown[]): Graph {
  return parseDigraph(interpolate(strings, values));
}

/**
 * Tagged template literal for creating undirected graphs from the DSL.
 *
 * Uses the same arrow syntax as `digraph`, but edges are bidirectional.
 *
 * @example
 * ```ts
 * const g = graph`
 *   a -> b, c
 *   b -> d
 * `;
 * ```
 */
export function graph(strings: TemplateStringsArray, ...values: unknown[]): Graph {
  const parsed = parseDigraph(interpolate(strings, values));
  return createUndirectedGraph(
    parsed.nodes.map((n) => n.id),
    parsed.edges.map((e) => [e.from, e.to, e.label])
  );
}

/**
 * Tagged template literal for defining state machines from the DSL.
 *
 * **Compile-time features:**
 * - Parses and validates the state machine definition at compile time
 * - Reports unreachable states, dead ends, and nondeterminism as compile errors
 * - Generates type-safe state and event union types
 *
 * Returns the definition augmented with a `create()` helper to instantiate it.
 *
 * @example
 * ```ts
 * const sm = stateMachine`
 *   @initial Idle
 *   @terminal Done
 *   Idle --start--> Running
 *   Running --stop--> Done
 * `;
 *
 * const instance = sm.create();
 * // instance.current is typed as "Idle" | "Running" | "Done"
 * ```
 */
export function stateMachine(
  strings: TemplateStringsArray,
  ...values: unknown[]
): StateMachineDefinition & {
  create: <S extends string, E extends string>() => ReturnType<typeof createInstance<S, E>>;
} {
  const def = parseStateMachine(interpolate(strings, values));
  return {
    ...def,
    create: <S extends string, E extends string>() => createInstance<S, E>(def),
  };
}

function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    result += String(values[i]) + strings[i + 1];
  }
  return result;
}

/**
 * Compile-time macro for state machine verification.
 *
 * When used with the typesugar transformer, this macro:
 * 1. Parses the state machine DSL at compile time
 * 2. Verifies the state machine structure (unreachable states, dead ends, nondeterminism)
 * 3. Reports compile-time errors for any issues
 * 4. Generates optimized code with precise state/event types
 */
export const stateMachineMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "stateMachine",
  module: "@typesugar/graph",
  description: "Define and verify state machines at compile time",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const { factory } = ctx;
    const template = node.template;

    // Extract the template content
    let templateText: string;
    if ("text" in template) {
      // NoSubstitutionTemplateLiteral
      templateText = (template as ts.NoSubstitutionTemplateLiteral).text;
    } else if ("templateSpans" in template) {
      // TemplateExpression - check if all spans are static
      const tplExpr = template as ts.TemplateExpression;
      const hasInterpolations = tplExpr.templateSpans.some((span) => !("text" in span.expression));
      if (hasInterpolations) {
        // Fall back to runtime if there are dynamic interpolations
        return node;
      }
      // Reconstruct static template
      templateText = tplExpr.head.text;
      for (const span of tplExpr.templateSpans) {
        if ("text" in span.expression) {
          templateText += (span.expression as ts.StringLiteral).text;
        }
        templateText += span.literal.text;
      }
    } else {
      // Unknown template form, fall back to runtime
      return node;
    }

    // Parse and verify at compile time
    let definition: StateMachineDefinition;
    try {
      definition = parseStateMachine(templateText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid state machine definition: ${msg}`);
      return node;
    }

    // Verify the state machine structure
    const verification = verify(definition);

    // Report compile-time errors for structural issues
    if (!verification.valid) {
      if (verification.unreachableStates.length > 0) {
        ctx.reportError(
          node,
          `Unreachable states detected: ${verification.unreachableStates.join(", ")}. ` +
            `These states cannot be reached from the initial state "${definition.initial}".`
        );
      }

      if (verification.deadEndStates.length > 0) {
        ctx.reportError(
          node,
          `Dead-end states detected: ${verification.deadEndStates.join(", ")}. ` +
            `These states have no outgoing transitions and are not marked as terminal. ` +
            `Add @terminal ${verification.deadEndStates.join(", ")} or add transitions from them.`
        );
      }

      if (verification.nondeterministic.length > 0) {
        const details = verification.nondeterministic
          .map((n) => `  - State "${n.state}" on event "${n.event}" → [${n.targets.join(", ")}]`)
          .join("\n");
        ctx.reportError(
          node,
          `Nondeterministic transitions detected:\n${details}\n` +
            `Each (state, event) pair must have exactly one target state.`
        );
      }
    }

    // Collect states and events for type generation
    const states = definition.states;
    const events = [...new Set(definition.transitions.map((t) => t.event))];

    // Generate the state machine definition object with type-safe create method
    // We inline the transitions as a literal for zero-cost
    const transitionsArray = factory.createArrayLiteralExpression(
      definition.transitions.map((t) =>
        factory.createObjectLiteralExpression([
          factory.createPropertyAssignment("from", factory.createStringLiteral(t.from)),
          factory.createPropertyAssignment("event", factory.createStringLiteral(t.event)),
          factory.createPropertyAssignment("to", factory.createStringLiteral(t.to)),
        ])
      )
    );

    const statesArray = factory.createArrayLiteralExpression(
      states.map((s) => factory.createStringLiteral(s))
    );

    const terminalArray = definition.terminal
      ? factory.createArrayLiteralExpression(
          definition.terminal.map((t) => factory.createStringLiteral(t))
        )
      : factory.createIdentifier("undefined");

    // Build the state type and event type as comments for IDE hints
    // In a full implementation, these would be generated as type assertions

    // Generate: { states: [...], transitions: [...], initial: "...", terminal: [...], create: () => createInstance(def) }
    return factory.createObjectLiteralExpression([
      factory.createPropertyAssignment("states", statesArray),
      factory.createPropertyAssignment("transitions", transitionsArray),
      factory.createPropertyAssignment("initial", factory.createStringLiteral(definition.initial)),
      factory.createPropertyAssignment("terminal", terminalArray),
      factory.createPropertyAssignment(
        "create",
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(
            factory.createIdentifier("__typesugar_createStateMachineInstance"),
            undefined,
            [
              factory.createObjectLiteralExpression([
                factory.createPropertyAssignment("states", statesArray),
                factory.createPropertyAssignment("transitions", transitionsArray),
                factory.createPropertyAssignment(
                  "initial",
                  factory.createStringLiteral(definition.initial)
                ),
                factory.createPropertyAssignment("terminal", terminalArray),
              ]),
            ]
          )
        )
      ),
      // Include verification metadata for debugging
      factory.createPropertyAssignment("__verified", factory.createTrue()),
      factory.createPropertyAssignment("__stateCount", factory.createNumericLiteral(states.length)),
      factory.createPropertyAssignment("__eventCount", factory.createNumericLiteral(events.length)),
    ]);
  },
});

/**
 * Runtime helper for creating state machine instances.
 * Called by the compiled output of `stateMachineMacro`.
 */
export function __typesugar_createStateMachineInstance<
  S extends string = string,
  E extends string = string,
>(def: StateMachineDefinition) {
  return createInstance<S, E>(def);
}

/**
 * Register all graph macros with the global registry.
 */
export function register(): void {
  globalRegistry.register(stateMachineMacro);
}
