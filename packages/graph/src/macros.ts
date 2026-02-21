import type { Graph, StateMachineDefinition } from "./types.js";
import { parseDigraph, parseStateMachine } from "./dsl.js";
import { createGraph as createUndirectedGraph } from "./graph.js";
import { createInstance } from "./state-machine.js";

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
