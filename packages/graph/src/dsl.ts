import type { Graph, StateMachineDefinition } from "./types.js";
import { createDigraph } from "./graph.js";
import { defineStateMachine } from "./state-machine.js";

/**
 * Parse a digraph from a compact DSL.
 *
 * Syntax — one rule per line:
 *   `nodeId -> target1, target2, ...`
 *
 * Edges can optionally carry a label in brackets:
 *   `a -> b [label], c`
 *
 * Blank lines and lines starting with `#` are ignored.
 *
 * @example
 * ```ts
 * const g = parseDigraph(`
 *   a -> b, c
 *   b -> d
 *   c -> d
 * `);
 * ```
 */
export function parseDigraph(source: string): Graph {
  const nodes = new Set<string>();
  const edges: [string, string, string?][] = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const arrowIdx = line.indexOf("->");
    if (arrowIdx === -1) {
      nodes.add(line);
      continue;
    }

    const from = line.slice(0, arrowIdx).trim();
    if (!from) throw new SyntaxError(`Missing source node in: "${rawLine}"`);
    nodes.add(from);

    const targetsPart = line.slice(arrowIdx + 2).trim();
    if (!targetsPart) {
      throw new SyntaxError(`Missing targets in: "${rawLine}"`);
    }

    for (const segment of targetsPart.split(",")) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      const bracketMatch = trimmed.match(/^(\S+)\s*\[(.+?)\]$/);
      if (bracketMatch) {
        const to = bracketMatch[1];
        const label = bracketMatch[2];
        nodes.add(to);
        edges.push([from, to, label]);
      } else {
        nodes.add(trimmed);
        edges.push([from, trimmed]);
      }
    }
  }

  return createDigraph([...nodes], edges);
}

/**
 * Parse a state machine from a transition DSL.
 *
 * Syntax — one transition per line:
 *   `FromState --event--> ToState`
 *
 * Options can be specified with special directives:
 *   `@initial StateName`
 *   `@terminal State1, State2`
 *
 * Blank lines and lines starting with `#` are ignored.
 *
 * @example
 * ```ts
 * const sm = parseStateMachine(`
 *   @initial Idle
 *   @terminal Done
 *   Idle --start--> Running
 *   Running --pause--> Paused
 *   Running --finish--> Done
 *   Paused --resume--> Running
 * `);
 * ```
 */
export function parseStateMachine(source: string): StateMachineDefinition {
  const transitions: Array<{ from: string; event: string; to: string }> = [];
  let initial: string | undefined;
  let terminal: string[] | undefined;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("@initial")) {
      initial = line.slice("@initial".length).trim();
      continue;
    }
    if (line.startsWith("@terminal")) {
      terminal = line
        .slice("@terminal".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    const match = line.match(/^(\S+)\s+--(\S+)-->\s+(\S+)$/);
    if (!match) {
      throw new SyntaxError(
        `Invalid state machine transition: "${rawLine}". Expected: "State --event--> State"`
      );
    }
    transitions.push({ from: match[1], event: match[2], to: match[3] });
  }

  if (transitions.length === 0) {
    throw new SyntaxError("State machine definition has no transitions");
  }

  return defineStateMachine(transitions, { initial, terminal });
}
