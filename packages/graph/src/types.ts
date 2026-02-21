/** A node in a graph. */
export interface GraphNode {
  readonly id: string;
  readonly metadata?: Record<string, unknown>;
}

/** A directed or undirected edge between two nodes. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly weight?: number;
}

/** An immutable graph structure supporting both directed and undirected semantics. */
export interface Graph {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly directed: boolean;
}

/** A single state machine transition: "in state `from`, on `event`, go to `to`". */
export interface Transition {
  readonly from: string;
  readonly event: string;
  readonly to: string;
}

/** Complete state machine definition. */
export interface StateMachineDefinition {
  readonly states: ReadonlyArray<string>;
  readonly transitions: ReadonlyArray<Transition>;
  readonly initial: string;
  readonly terminal?: ReadonlyArray<string>;
}

/** Result of verifying a state machine definition for structural issues. */
export interface VerificationResult {
  readonly valid: boolean;
  readonly unreachableStates: ReadonlyArray<string>;
  readonly deadEndStates: ReadonlyArray<string>;
  readonly nondeterministic: ReadonlyArray<{
    state: string;
    event: string;
    targets: string[];
  }>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
}

/** A state machine instance that tracks current state immutably. */
export interface StateMachineInstance<States extends string, Events extends string> {
  readonly current: States;
  /** Transition to the next state given an event. Throws if no valid transition exists. */
  transition(event: Events): StateMachineInstance<States, Events>;
  /** Check whether a transition exists for the given event in the current state. */
  canTransition(event: Events): boolean;
  /** List all events that have valid transitions from the current state. */
  availableEvents(): Events[];
}
