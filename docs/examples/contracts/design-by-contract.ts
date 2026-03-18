//! Design by Contract
//! @contract transforms requires:/ensures: blocks into runtime checks

import "@typesugar/contracts";
import { requires, PreconditionError } from "@typesugar/contracts";
import { comptime } from "typesugar";

const MAX_BALANCE = comptime(() => 1_000_000);

// @contract parses requires:/ensures: labeled blocks and generates checks
// 👀 Check JS Output: label blocks become if-throw statements
/** @contract */
function transfer(from: number, to: number, amount: number): [number, number] {
  requires: { amount > 0; amount <= from; }
  ensures: { from - amount >= 0; }
  return [from - amount, to + amount];
}

// Happy path
const [fromBal, toBal] = transfer(1000, 500, 200);
console.log("Transfer:", fromBal, "→", toBal);

// Contract violations throw PreconditionError
try {
  transfer(100, 500, -50);
} catch (e: any) {
  console.log("\nNegative amount:", e.message);
}

try {
  transfer(100, 500, 200);
} catch (e: any) {
  console.log("Insufficient:", e.message);
}

// Inline contracts for quick validation
function createPort(port: number) {
  requires(port >= 1 && port <= 65535, `Invalid port: ${port}`);
  return port;
}

console.log("\nPort:", createPort(8080));
console.log("Max:", MAX_BALANCE);

// In production: contracts.mode = "none" strips ALL checks
// Try: swap the requires: conditions and see which fires first
