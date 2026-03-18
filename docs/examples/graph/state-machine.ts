//! State Machines
//! Compile-time verified state machine with type-safe transitions

import { stateMachine, verify, deadEndStates } from "@typesugar/graph";

// stateMachine`...` is a compile-time macro that:
// 1. Parses the DSL at build time
// 2. Verifies structure (dead ends, unreachable states)
// 3. Generates an inlined object literal
// 👀 Check JS Output: the tagged template becomes a verified object

const orderFlow = stateMachine`
  @initial Created
  @terminal Delivered, Cancelled

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

// Run the happy path with type-safe transitions
const order = orderFlow.create();
console.log("\nState:", order.current);

const s1 = order.transition("submit");
console.log("→ submit:", s1.current);

const s2 = s1.transition("approve");
console.log("→ approve:", s2.current);

const s3 = s2.transition("ship");
console.log("→ ship:", s3.current);

const s4 = s3.transition("deliver");
console.log("→ deliver:", s4.current, "(terminal)");

// Try: remove @terminal Cancelled and watch the dead-end warning
