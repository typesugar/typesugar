/**
 * Phantom Types Example
 *
 * Demonstrates type-safe state machines — the type system enforces
 * valid state transitions at compile time. Invalid transitions are
 * type errors, not runtime errors.
 */

import { createStateMachine, Phantom } from "@ttfx/type-system";

// --- Door State Machine ---

type DoorState = "open" | "closed" | "locked";

const Door = createStateMachine<DoorState>()
  .state("closed", { open: "open", lock: "locked" })
  .state("open", { close: "closed" })
  .state("locked", { unlock: "closed" })
  .build();

console.log("=== Phantom Types State Machine ===\n");

// Start with a closed door
const closed = Door.initial("closed");
console.log("Initial state:", Door.getState(closed));

// Valid transitions
const opened = Door.transition(closed, "open");
console.log("After open:", Door.getState(opened));

const closedAgain = Door.transition(opened, "close");
console.log("After close:", Door.getState(closedAgain));

const locked = Door.transition(closedAgain, "lock");
console.log("After lock:", Door.getState(locked));

const unlocked = Door.transition(locked, "unlock");
console.log("After unlock:", Door.getState(unlocked));

// These would be compile-time errors:
// Door.transition(opened, "lock");    // Can't lock an open door
// Door.transition(locked, "open");    // Must unlock first
// Door.transition(closed, "unlock");  // Can't unlock what's not locked

// --- File Handle State Machine ---

type FileState = "unopened" | "reading" | "writing" | "closed";

const FileHandle = createStateMachine<FileState>()
  .state("unopened", { openRead: "reading", openWrite: "writing" })
  .state("reading", { close: "closed" })
  .state("writing", { close: "closed" })
  .state("closed", {})
  .build();

console.log("\n--- File Handle Example ---");

const handle = FileHandle.initial("unopened");
const reading = FileHandle.transition(handle, "openRead");
const finished = FileHandle.transition(reading, "close");

console.log("File states:", [
  FileHandle.getState(handle),
  FileHandle.getState(reading),
  FileHandle.getState(finished),
]);

// Can't read from a closed file — compile error:
// FileHandle.transition(finished, "close");
