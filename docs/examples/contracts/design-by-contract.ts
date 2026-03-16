//! Design by Contract
//! Preconditions, postconditions, and invariants

import { requires, ensures, ContractError, PreconditionError } from "@typesugar/contracts";

// requires() throws PreconditionError if condition is false
function withdraw(balance: number, amount: number): number {
  requires(amount > 0, "Amount must be positive");
  requires(amount <= balance, `Insufficient funds: need ${amount}, have ${balance}`);
  const newBalance = balance - amount;
  ensures(newBalance >= 0, "Balance must not go negative");
  return newBalance;
}

// Happy path
console.log("Withdraw 30 from 100:", withdraw(100, 30));
console.log("Withdraw 50 from 70:", withdraw(70, 50));

// Contract violations
const tests = [
  { balance: 100, amount: -5, desc: "negative amount" },
  { balance: 50, amount: 75, desc: "insufficient funds" },
];

for (const { balance, amount, desc } of tests) {
  try {
    withdraw(balance, amount);
  } catch (e) {
    if (e instanceof PreconditionError) {
      console.log(`\n✗ Precondition failed (${desc}):`);
      console.log(`  ${e.message}`);
    }
  }
}

// Real-world: validated configuration
function createServer(port: number, maxConns: number) {
  requires(port >= 1 && port <= 65535, `Invalid port: ${port}`);
  requires(maxConns > 0, "Max connections must be positive");
  requires(maxConns <= 10000, `Too many connections: ${maxConns}`);

  console.log(`\n✓ Server config: port=${port}, maxConns=${maxConns}`);
  return { port, maxConns };
}

createServer(8080, 100);

try { createServer(0, 100); }
catch (e: any) { console.log(`✗ ${e.message}`); }

try { createServer(8080, -1); }
catch (e: any) { console.log(`✗ ${e.message}`); }
