/**
 * Phantom Type State Machine Macro
 *
 * Encode state machines in the type system using phantom types. Each state
 * is a type parameter, and transitions are methods that change the phantom
 * type — making invalid state transitions a compile-time error.
 *
 * Inspired by:
 * - Rust's typestate pattern
 * - Session types
 * - Haskell's phantom types
 * - The Builder pattern with type-safe steps
 *
 * ## The Problem
 *
 * ```typescript
 * // A connection that must be opened before use:
 * class Connection {
 *   open(): void { ... }
 *   send(data: string): void { ... }  // Must be opened first!
 *   close(): void { ... }             // Must be opened first!
 * }
 *
 * const conn = new Connection();
 * conn.send("hello");  // Runtime error! Not opened yet.
 *                       // TypeScript can't prevent this.
 * ```
 *
 * ## The Solution
 *
 * ```typescript
 * // Define states as string literal types:
 * type Closed = "closed";
 * type Open = "open";
 *
 * // Create a state machine:
 * const Connection = stateMachine<{
 *   closed: { open: "open" };
 *   open: { send: "open"; close: "closed" };
 * }>()({
 *   initial: "closed" as const,
 *   transitions: {
 *     open: (state) => ({ ...state }),
 *     send: (state, data: string) => ({ ...state, lastSent: data }),
 *     close: (state) => ({ ...state }),
 *   },
 * });
 *
 * const conn = Connection.create();           // State<"closed">
 * const opened = Connection.open(conn);       // State<"open">
 * const sent = Connection.send(opened, "hi"); // State<"open">
 * const closed = Connection.close(sent);      // State<"closed">
 *
 * // Compile-time errors:
 * Connection.send(conn, "hi");   // Error: send not available in "closed" state
 * Connection.close(conn);        // Error: close not available in "closed" state
 * Connection.open(opened);       // Error: open not available in "open" state
 * ```
 *
 * The `@phantom` / `stateMachine` macro definitions live in the package's
 * `./macros` entry (loaded by the transformer at build time). This module is
 * runtime-only and does NOT import `typescript`.
 */

// ============================================================================
// Type-Level API
// ============================================================================

/** Brand symbol for phantom state */
declare const __phantom_state__: unique symbol;

/**
 * A value tagged with a phantom state type.
 * The state exists only in the type system — at runtime it's just Data.
 */
export type Phantom<Data, State extends string> = Data & {
  readonly [__phantom_state__]: State;
};

/**
 * Extract the state from a phantom-typed value.
 */
export type StateOf<T> = T extends Phantom<unknown, infer S> ? S : never;

/**
 * Extract the data from a phantom-typed value.
 */
export type DataOf<T> = T extends Phantom<infer D, string> ? D : T;

/**
 * A state machine definition — maps states to their allowed transitions.
 * Each transition maps to the target state.
 */
export type StateMachineDef = Record<string, Record<string, string>>;

/**
 * Extract all states from a state machine definition.
 */
export type StatesOf<Def extends StateMachineDef> = keyof Def & string;

/**
 * Extract transitions available in a given state.
 */
export type TransitionsIn<Def extends StateMachineDef, S extends keyof Def> = keyof Def[S] & string;

/**
 * Get the target state of a transition from a given state.
 */
export type TargetState<
  Def extends StateMachineDef,
  S extends keyof Def,
  T extends keyof Def[S],
> = Def[S][T] & string;

// ============================================================================
// State Machine Builder
// ============================================================================

/**
 * A transition function — takes the current state data and returns new data.
 */
export type TransitionFn<Data> = (data: Data, ...args: any[]) => Data;

/**
 * Configuration for creating a state machine.
 */
export interface StateMachineConfig<Def extends StateMachineDef, Data> {
  /** The initial state */
  readonly initial: StatesOf<Def>;

  /** Initial data */
  readonly initialData: Data;

  /**
   * The state table at runtime — the same shape as `Def`
   * (`{ [state]: { [transition]: targetState } }`). Required: `Def` is a
   * type-only parameter, so without this the runtime cannot know a
   * transition's target state or which states allow it.
   */
  readonly states: Def;

  /** Transition implementations */
  readonly transitions: {
    [K in AllTransitions<Def>]: TransitionFn<Data>;
  };
}

/**
 * All transition names across all states.
 */
type AllTransitions<Def extends StateMachineDef> = {
  [S in keyof Def]: keyof Def[S] & string;
}[keyof Def];

/**
 * A state machine instance — carries data and phantom state.
 */
export interface StateMachineInstance<Data, State extends string> {
  readonly data: Data;
  readonly state: State;
}

/**
 * Create a state machine with type-safe transitions.
 *
 * @example
 * ```typescript
 * type TrafficLightDef = {
 *   red: { toGreen: "green" };
 *   green: { toYellow: "yellow" };
 *   yellow: { toRed: "red" };
 * };
 *
 * const TrafficLight = createStateMachine<TrafficLightDef, { timer: number }>({
 *   initial: "red",
 *   initialData: { timer: 0 },
 *   states: {
 *     red: { toGreen: "green" },
 *     green: { toYellow: "yellow" },
 *     yellow: { toRed: "red" },
 *   },
 *   transitions: {
 *     toGreen: (data) => ({ timer: data.timer + 1 }),
 *     toYellow: (data) => ({ timer: data.timer + 1 }),
 *     toRed: (data) => ({ timer: data.timer + 1 }),
 *   },
 * });
 *
 * let light = TrafficLight.create();        // { state: "red", data: { timer: 0 } }
 * light = TrafficLight.toGreen(light);      // { state: "green", data: { timer: 1 } }
 * light = TrafficLight.toYellow(light);     // { state: "yellow", data: { timer: 2 } }
 * light = TrafficLight.toRed(light);        // { state: "red", data: { timer: 3 } }
 *
 * // Runtime error: a transition not listed for the current state throws.
 * // TrafficLight.toYellow(TrafficLight.create()); // Error: not valid in state "red"
 * ```
 */
export function createStateMachine<Def extends StateMachineDef, Data>(
  config: StateMachineConfig<Def, Data>
): StateMachineModule<Def, Data> {
  const { initial, initialData, transitions, states } = config;

  // TSP-2: the target state comes from the runtime state table. (It used to
  // be looked up by scanning `Object.entries(config)`, which found
  // `config.transitions` first and set `state` to the transition FUNCTION.)
  if (!states || typeof states !== "object") {
    throw new Error(
      "createStateMachine: `states` (the runtime state table, same shape as the Def type) is required"
    );
  }

  // Build the valid transitions map
  const module: Record<string, Function> = {
    create: () => ({
      state: initial,
      data: initialData,
    }),

    getState: (instance: StateMachineInstance<Data, string>) => instance.state,
    getData: (instance: StateMachineInstance<Data, string>) => instance.data,

    is: (instance: StateMachineInstance<Data, string>, state: string) => instance.state === state,
  };

  // Add transition functions
  for (const [name, transitionFn] of Object.entries(transitions)) {
    if (Object.prototype.hasOwnProperty.call(module, name)) {
      throw new Error(
        `createStateMachine: transition name "${name}" is reserved (it would overwrite the module's own "${name}" method)`
      );
    }
    const fn = transitionFn as (data: Data, ...args: unknown[]) => Data;
    module[name] = (instance: StateMachineInstance<Data, string>, ...args: unknown[]) => {
      const row = (states as Record<string, Record<string, unknown> | undefined>)[instance.state];
      const targetState =
        row && Object.prototype.hasOwnProperty.call(row, name) ? row[name] : undefined;
      if (typeof targetState !== "string") {
        throw new Error(
          `State machine transition "${name}" is not valid in state "${instance.state}"`
        );
      }

      // Apply the transition
      const newData = fn(instance.data, ...args);
      return {
        state: targetState,
        data: newData,
      };
    };
  }

  return module as any;
}

/**
 * The module type for a state machine.
 */
export type StateMachineModule<Def extends StateMachineDef, Data> = {
  /** Create a new instance in the initial state */
  readonly create: () => StateMachineInstance<Data, StatesOf<Def>>;

  /** Get the current state */
  readonly getState: (instance: StateMachineInstance<Data, string>) => StatesOf<Def>;

  /** Get the current data */
  readonly getData: (instance: StateMachineInstance<Data, string>) => Data;

  /** Check if the instance is in a specific state */
  readonly is: <S extends StatesOf<Def>>(
    instance: StateMachineInstance<Data, string>,
    state: S
  ) => instance is StateMachineInstance<Data, S>;
} & {
  /**
   * Transition functions. Calling a transition that is not listed for the
   * instance's current state throws at runtime.
   */
  readonly [K in AllTransitions<Def>]: (
    instance: StateMachineInstance<Data, string>,
    ...args: any[]
  ) => StateMachineInstance<Data, TargetsOf<Def, K>>;
};

/** Every state that transition `K` can lead to. */
type TargetsOf<Def extends StateMachineDef, K extends string> = {
  [S in keyof Def]: K extends keyof Def[S] ? Def[S][K] & string : never;
}[keyof Def];

// ============================================================================
// Type-Safe Builder Pattern (common use of phantom types)
// ============================================================================

/**
 * A type-safe builder that tracks which fields have been set.
 *
 * @example
 * ```typescript
 * type UserFields = {
 *   name: string;
 *   email: string;
 *   age: number;
 * };
 *
 * const builder = createBuilder<UserFields>()
 *   .set("name", "Alice")     // Builder<{ name: true }>
 *   .set("email", "a@b.com")  // Builder<{ name: true, email: true }>
 *   .set("age", 30)           // Builder<{ name: true, email: true, age: true }>
 *   .build();                  // UserFields (only available when all fields set)
 * ```
 */
export interface TypedBuilder<
  Fields extends Record<string, unknown>,
  Set extends Partial<Record<keyof Fields, true>> = {},
> {
  /** Set a field value */
  set<K extends keyof Fields>(
    key: K,
    value: Fields[K]
  ): TypedBuilder<Fields, Set & Record<K, true>>;

  /** Build the final object (only available when all required fields are set) */
  build: Set extends Record<keyof Fields, true> ? () => Fields : never;

  /** Get the current partial state */
  partial(): Partial<Fields>;
}

/**
 * Create a type-safe builder for a record type.
 */
export function createBuilder<Fields extends Record<string, unknown>>(): TypedBuilder<Fields> {
  return makeBuilder<Fields>({});
}

/**
 * TSP-14: each `set` returns a NEW builder over a copy of the data, so
 * branching (`b1 = B.set("a", 1); b2 = B.set("a", 2)`) does not share state —
 * matching the type API, which presents every `set` as a new typed builder.
 */
function makeBuilder<Fields extends Record<string, unknown>>(
  data: Partial<Fields>
): TypedBuilder<Fields> {
  const builder: any = {
    set(key: string, value: unknown) {
      return makeBuilder<Fields>({ ...data, [key]: value } as Partial<Fields>);
    },
    build() {
      return { ...data };
    },
    partial() {
      return { ...data };
    },
  };

  return builder;
}

// ============================================================================
// Protocol / Session Types (simplified)
// ============================================================================

/**
 * A protocol step — represents one step in a communication protocol.
 */
export interface ProtocolStep<Direction extends "send" | "receive", Payload, Next> {
  readonly direction: Direction;
  readonly __payload__: Payload;
  readonly __next__: Next;
}

/** Send a message of type T, then continue with Next */
export type Send<T, Next> = ProtocolStep<"send", T, Next>;

/** Receive a message of type T, then continue with Next */
export type Recv<T, Next> = ProtocolStep<"receive", T, Next>;

/** Protocol is done */
export type Done = { readonly __done__: true };

/**
 * Example protocol: a simple request-response
 *
 * Client side: Send<Request, Recv<Response, Done>>
 * Server side: Recv<Request, Send<Response, Done>>  (dual)
 */
export type Dual<P> =
  P extends Send<infer T, infer Next>
    ? Recv<T, Dual<Next>>
    : P extends Recv<infer T, infer Next>
      ? Send<T, Dual<Next>>
      : P extends Done
        ? Done
        : never;

/**
 * @transition decorator placeholder — marks a method as a state transition.
 * Processed by the `@phantom` macro (see the package's `./macros` entry).
 */
export function transition(_from: string, _to: string): MethodDecorator {
  return () => {};
}

/**
 * `@phantom` decorator placeholder — processed by the `@phantom` macro (see
 * the package's `./macros` entry). Import it from `@typesugar/type-system` so
 * the macro resolves to this package.
 */
export function phantom(..._args: unknown[]): void {}
