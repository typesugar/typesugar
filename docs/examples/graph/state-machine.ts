//! State Machines
//! Define, verify, and run typed state machines

import { defineStateMachine, verify, createInstance } from "@typesugar/graph";

// Define an order fulfillment workflow
const orderFlow = defineStateMachine([
  { from: "created",  event: "submit",  to: "pending" },
  { from: "pending",  event: "approve", to: "approved" },
  { from: "pending",  event: "reject",  to: "rejected" },
  { from: "pending",  event: "cancel",  to: "cancelled" },
  { from: "approved", event: "ship",    to: "shipped" },
  { from: "shipped",  event: "deliver", to: "delivered" },
], { initial: "created", terminal: ["delivered", "cancelled"] });

// Structural verification catches design issues
const checks = verify(orderFlow);
console.log("Valid?", checks.valid);
if (checks.deadEndStates.length > 0) {
  console.log("Dead-end states:", checks.deadEndStates);
}

// Run an instance through the happy path
const order = createInstance(orderFlow);
console.log("\nState:", order.current);

const step1 = order.transition("submit");
console.log("→ submit:", step1.current);

const step2 = step1.transition("approve");
console.log("→ approve:", step2.current);

const step3 = step2.transition("ship");
console.log("→ ship:", step3.current);

const step4 = step3.transition("deliver");
console.log("→ deliver:", step4.current, "(terminal)");
