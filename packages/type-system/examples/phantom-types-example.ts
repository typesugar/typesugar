/**
 * Phantom Types Example
 *
 * State machines with createStateMachine: the definition type lists each
 * state's transitions and their targets, every instance carries its state, and
 * a transition that is not listed for the instance's current state throws.
 *
 * Run: typesugar run examples/phantom-types-example.ts
 */

import { createStateMachine } from "@typesugar/type-system";

// --- Door State Machine ---

type DoorDef = {
  closed: { open: "open"; lock: "locked" };
  open: { close: "closed" };
  locked: { unlock: "closed" };
};

const same = <D>(data: D): D => data;

const Door = createStateMachine<DoorDef, null>({
  initial: "closed",
  initialData: null,
  // The runtime state table: the same shape as DoorDef.
  states: {
    closed: { open: "open", lock: "locked" },
    open: { close: "closed" },
    locked: { unlock: "closed" },
  },
  transitions: { open: same, close: same, lock: same, unlock: same },
});

console.log("=== Phantom Types State Machine ===\n");

// Start with a closed door
const closed = Door.create();
console.log("Initial state:", Door.getState(closed));

// Valid transitions
const opened = Door.open(closed);
console.log("After open:", Door.getState(opened));

const closedAgain = Door.close(opened);
console.log("After close:", Door.getState(closedAgain));

const locked = Door.lock(closedAgain);
console.log("After lock:", Door.getState(locked));

const unlocked = Door.unlock(locked);
console.log("After unlock:", Door.getState(unlocked));

// A transition not listed for the current state throws:
try {
  Door.lock(opened); // can't lock an open door
} catch (e) {
  console.log("Door.lock(opened):", (e as Error).message);
}

// --- File Handle State Machine (with data) ---

type FileDef = {
  unopened: { openRead: "reading"; openWrite: "writing" };
  reading: { close: "closed" };
  writing: { close: "closed" };
  closed: {};
};

const FileHandle = createStateMachine<FileDef, { opens: number }>({
  initial: "unopened",
  initialData: { opens: 0 },
  states: {
    unopened: { openRead: "reading", openWrite: "writing" },
    reading: { close: "closed" },
    writing: { close: "closed" },
    closed: {},
  },
  transitions: {
    openRead: (d) => ({ opens: d.opens + 1 }),
    openWrite: (d) => ({ opens: d.opens + 1 }),
    close: (d) => d,
  },
});

console.log("\n--- File Handle Example ---");

const handle = FileHandle.create();
const reading = FileHandle.openRead(handle);
const finished = FileHandle.close(reading);

console.log("File states:", [
  FileHandle.getState(handle),
  FileHandle.getState(reading),
  FileHandle.getState(finished),
]);
console.log("Opens:", FileHandle.getData(finished).opens);

// is() narrows the instance's state.
if (FileHandle.is(finished, "closed")) {
  const state: "closed" = finished.state;
  console.log("Closed:", state);
}

// Can't close a closed file:
try {
  FileHandle.close(finished);
} catch (e) {
  console.log("FileHandle.close(finished):", (e as Error).message);
}
