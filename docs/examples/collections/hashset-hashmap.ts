//! HashSet & HashMap
//! Hash-based collections with custom equality

import { HashSet, HashMap } from "@typesugar/collections";
import { eqString, hashString, eqNumber, hashNumber, makeEq, makeHash } from "@typesugar/std";

// HashSet with string keys
const tags = new HashSet(eqString, hashString);
tags.add("typescript").add("macros").add("fp").add("typescript"); // deduped
console.log("Tags:", tags.toArray());
console.log("Size:", tags.size);
console.log("Has 'fp':", tags.has("fp"));

// HashMap<string, number>
const scores = new HashMap(eqString, hashString);
scores.set("Alice", 95).set("Bob", 87).set("Charlie", 92);
console.log("\nScores:", [...scores.entries()]);
console.log("Alice:", scores.get("Alice"));
console.log("Unknown:", scores.getOrElse("Zara", 0));

// Custom equality: points equal if same (x, y)
const ptEq = makeEq((a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y
);
const ptHash = makeHash((p: { x: number; y: number }) => p.x * 31 + p.y);

const visited = new HashSet(ptEq, ptHash);
visited.add({ x: 0, y: 0 }).add({ x: 1, y: 2 }).add({ x: 0, y: 0 }); // deduped!
console.log("\nVisited points:", visited.toArray());
console.log("Size (deduped):", visited.size);
