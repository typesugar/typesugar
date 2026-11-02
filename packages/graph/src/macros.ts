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

    // Extract the template content. Only literal interpolations are inlined
    // as DSL text (FMG-5): an identifier (or any other expression) must be
    // evaluated, so such templates are left to the runtime tag. Note
    // `"text" in expr` is NOT a literal test — ts.Identifier has `text` too.
    const isStaticSpan = (e: ts.Expression): e is ts.StringLiteral | ts.NumericLiteral =>
      ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e);
    let templateText: string;
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      templateText = template.text;
    } else if (ts.isTemplateExpression(template)) {
      if (!template.templateSpans.every((span) => isStaticSpan(span.expression))) {
        // Fall back to the runtime tag for dynamic interpolations. The user's
        // `stateMachine` import specifier is removed by import cleanup (it
        // resolved to this macro), and ensureImport("stateMachine") would reuse
        // that doomed binding, so import the runtime tag under its own name.
        return factory.createTaggedTemplateExpression(
          ctx.ensureImport("__typesugar_stateMachineRuntime", "@typesugar/graph"),
          undefined,
          template
        );
      }
      templateText = template.head.text;
      for (const span of template.templateSpans) {
        templateText += (span.expression as ts.StringLiteral | ts.NumericLiteral).text;
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
            // FMG-1: the helper must be imported into the user's file — the
            // user only imported `stateMachine`, and that specifier is removed
            // by import cleanup once it resolves to this macro.
            ctx.ensureImport("__typesugar_createStateMachineInstance", "@typesugar/graph"),
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
