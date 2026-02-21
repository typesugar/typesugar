import type {
  Graph,
  StateMachineDefinition,
  StateMachineInstance,
  Transition,
  VerificationResult,
} from "./types.js";
import { createDigraph } from "./graph.js";
import { reachable as graphReachable, detectCycles } from "./algorithms.js";

/**
 * Build a state machine definition from a list of transitions.
 * States are inferred from the transitions unless explicitly provided.
 */
export function defineStateMachine(
  transitions: Array<{ from: string; event: string; to: string }>,
  options?: { initial?: string; terminal?: string[] }
): StateMachineDefinition {
  const stateSet = new Set<string>();
  for (const t of transitions) {
    stateSet.add(t.from);
    stateSet.add(t.to);
  }
  const states = [...stateSet];
  const initial = options?.initial ?? transitions[0]?.from ?? states[0];
  if (!initial) {
    throw new Error("Cannot define a state machine with no states");
  }
  return {
    states,
    transitions: transitions.map((t) => ({
      from: t.from,
      event: t.event,
      to: t.to,
    })),
    initial,
    terminal: options?.terminal,
  };
}

/** Verify a state machine definition for structural issues. */
export function verify(sm: StateMachineDefinition): VerificationResult {
  const unreachable = unreachableStatesInternal(sm);
  const deadEnds = deadEndStatesInternal(sm);
  const nondet = isNondeterministicInternal(sm);
  const graph = toGraph(sm);
  const cycles = detectCycles(graph);

  return {
    valid: unreachable.length === 0 && deadEnds.length === 0 && nondet.length === 0,
    unreachableStates: unreachable,
    deadEndStates: deadEnds,
    nondeterministic: nondet,
    cycles,
  };
}

/** Create an immutable state machine instance. */
export function createInstance<S extends string, E extends string>(
  sm: StateMachineDefinition,
  initialState?: S
): StateMachineInstance<S, E> {
  const current = (initialState ?? sm.initial) as S;

  const transitionMap = new Map<string, Transition[]>();
  for (const t of sm.transitions) {
    if (!transitionMap.has(t.from)) transitionMap.set(t.from, []);
    transitionMap.get(t.from)!.push(t);
  }

  function buildInstance(state: S): StateMachineInstance<S, E> {
    return {
      current: state,
      transition(event: E): StateMachineInstance<S, E> {
        const ts = transitionMap.get(state) ?? [];
        const match = ts.find((t) => t.event === (event as string));
        if (!match) {
          throw new Error(`No transition from state "${state}" on event "${event as string}"`);
        }
        return buildInstance(match.to as S);
      },
      canTransition(event: E): boolean {
        const ts = transitionMap.get(state) ?? [];
        return ts.some((t) => t.event === (event as string));
      },
      availableEvents(): E[] {
        const ts = transitionMap.get(state) ?? [];
        return [...new Set(ts.map((t) => t.event))] as E[];
      },
    };
  }

  return buildInstance(current);
}

/** Convert a state machine to its underlying directed graph. */
export function toGraph(sm: StateMachineDefinition): Graph {
  return createDigraph(
    [...sm.states],
    sm.transitions.map((t) => [t.from, t.to, t.event])
  );
}

/** Find all states reachable from the initial state. */
export function reachableStates(sm: StateMachineDefinition): Set<string> {
  const graph = toGraph(sm);
  return graphReachable(graph, sm.initial);
}

/** Find states with no outgoing transitions that aren't terminal. */
export function deadEndStates(sm: StateMachineDefinition): string[] {
  return deadEndStatesInternal(sm);
}

/** Check for nondeterminism: same state + same event leading to different targets. */
export function isNondeterministic(
  sm: StateMachineDefinition
): Array<{ state: string; event: string; targets: string[] }> {
  return isNondeterministicInternal(sm);
}

function unreachableStatesInternal(sm: StateMachineDefinition): string[] {
  const reached = reachableStates(sm);
  return sm.states.filter((s) => !reached.has(s));
}

function deadEndStatesInternal(sm: StateMachineDefinition): string[] {
  const terminal = new Set(sm.terminal ?? []);
  const hasOutgoing = new Set(sm.transitions.map((t) => t.from));
  return sm.states.filter((s) => !hasOutgoing.has(s) && !terminal.has(s));
}

function isNondeterministicInternal(
  sm: StateMachineDefinition
): Array<{ state: string; event: string; targets: string[] }> {
  const grouped = new Map<string, Map<string, Set<string>>>();
  for (const t of sm.transitions) {
    if (!grouped.has(t.from)) grouped.set(t.from, new Map());
    const eventMap = grouped.get(t.from)!;
    if (!eventMap.has(t.event)) eventMap.set(t.event, new Set());
    eventMap.get(t.event)!.add(t.to);
  }

  const results: Array<{ state: string; event: string; targets: string[] }> = [];
  for (const [state, eventMap] of grouped) {
    for (const [event, targets] of eventMap) {
      if (targets.size > 1) {
        results.push({ state, event, targets: [...targets] });
      }
    }
  }
  return results;
}
