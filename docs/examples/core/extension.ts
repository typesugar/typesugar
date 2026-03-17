//! @extension
//! Extension methods for existing types

import { extension } from "typesugar";

// @extension adds methods to existing types at compile time
// Click "JS Output" to see how the extension is compiled!

@extension
function first<A>(arr: readonly A[]): A | undefined {
  return arr[0];
}

@extension
function last<A>(arr: readonly A[]): A | undefined {
  return arr[arr.length - 1];
}

@extension
function isEmpty<A>(arr: readonly A[]): boolean {
  return arr.length === 0;
}

const arr = [1, 2, 3];
console.log("first:", arr.first());
console.log("last:", arr.last());
console.log("isEmpty:", arr.isEmpty());
console.log("[] isEmpty:", [].isEmpty());
