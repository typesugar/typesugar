//! HashSet & HashMap
//! Derived Eq for custom keys + hash-based collections

import { derive, Eq } from "typesugar";
import { HashSet, HashMap } from "@typesugar/collections";
import { eqNumber, hashNumber, makeEq, makeHash } from "@typesugar/std";

// @derive(Eq) generates structural equality for custom types
// 👀 Check JS Output: @derive creates field-by-field comparison
@derive(Eq)
class Coord {
  constructor(public x: number, public y: number) {}
}

const a = new Coord(3, 4);
const b = new Coord(3, 4);
const c = new Coord(1, 2);
console.log("a === b?", a === b);  // true  (structural equality!)
console.log("a === c?", a === c);  // false

// HashSet with custom equality — deduplicates by structure
const ptEq = makeEq((p: Coord, q: Coord) => p.x === q.x && p.y === q.y);
const ptHash = makeHash((p: Coord) => p.x * 31 + p.y);

const visited = new HashSet<Coord>(ptEq, ptHash);
visited.add(new Coord(0, 0)).add(new Coord(1, 2)).add(new Coord(0, 0));
console.log("\nVisited:", visited.size, "points (deduped from 3)");
console.log("Has (1,2)?", visited.has(new Coord(1, 2)));

// HashMap — typed key-value store
const scores = new HashMap<number, string>(eqNumber, hashNumber);
scores.set(1, "Alice").set(2, "Bob").set(3, "Charlie");
console.log("\nPlayer 2:", scores.get(2));
console.log("Unknown:", scores.getOrElse(99, "N/A"));

// Try: change a Coord field and watch === adapt in JS Output
