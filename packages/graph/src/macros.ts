/**
 * @typesugar/graph — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime tagged-template helpers + the
 * `__typesugar_createStateMachineInstance` helper live in the package's `.`
 * entry (see `./templates.ts`). See PEP-050.
 */

import type { StateMachineDefinition } from "./types.js";
import { parseStateMachine } from "./dsl.js";
import { verify } from "./state-machine.js";
import {
  defineTaggedTemplateMacro,
  globalRegistry,
  type MacroContext,
  type TaggedTemplateMacroDef,
} from "@typesugar/core";
import ts from "typescript";

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
 * Register all graph macros with the global registry.
 */
export function register(): void {
  globalRegistry.register(stateMachineMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
