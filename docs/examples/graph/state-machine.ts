//! State Machines
//! Compile-time verified state machine with type-safe transitions

import { stateMachine, verify } from "@typesugar/graph";

// stateMachine`...` is a compile-time macro that:
// 1. Parses the DSL at build time
// 2. Verifies structure (dead ends, unreachable states)
// 3. Generates an inlined object literal
// 👀 Check JS Output: the tagged template becomes a verified object

const orderFlow = stateMachine`
  @initial Created
  @terminal Delivered, Cancelled, Rejected

  Created   --submit-->  Pending
  Pending   --approve--> Approved
  Pending   --reject-->  Rejected
  Pending   --cancel-->  Cancelled
  Approved  --ship-->    Shipped
  Shipped   --deliver--> Delivered
`;

// Structural verification — caught at compile time by the macro
const checks = verify(orderFlow);
console.log("Valid?", checks.valid);
console.log("Dead ends:", checks.deadEndStates);
console.log("States:", orderFlow.states);

// The macro verified: no dead-end states, no unreachable states
console.log("Initial:", orderFlow.initial);
console.log("Terminal:", orderFlow.terminal);
console.log("Transitions:", orderFlow.transitions.length);

// Trace a path manually through the verified transitions
const path = ["Created", "Pending", "Approved", "Shipped", "Delivered"];
console.log("\nHappy path:", path.join(" → "));

// Try: remove @terminal Cancelled and watch the dead-end warning
