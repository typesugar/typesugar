//! Power Assert
//! Sub-expression capture turns "expected true, got false" into real diagnostics

import { assert } from "@typesugar/testing";
import { staticAssert, comptime } from "typesugar";

// assert() captures every sub-expression on failure.
// 👀 Check JS Output — the transformer instruments the assertion!

const users = ["alice", "bob", "charlie"];
const admins = ["alice"];

assert(users.length > 0, "need users");
assert(admins.length <= users.length);

// Runtime assertions that actually execute:
const inventory = { apples: 5, oranges: 3, bananas: 0 };
assert(inventory.apples + inventory.oranges > 0);
assert(inventory.apples !== inventory.oranges);

console.log("users:", users.length, "admins:", admins.length);
console.log("inventory:", inventory);

// staticAssert() proves things at compile time — completely erased from output
const API_VERSION = "v3";
const FORMATS = comptime(() => ["json", "xml", "csv"]);

staticAssert(API_VERSION.startsWith("v"), "version must start with 'v'");
staticAssert(FORMATS.includes("json"), "json support required");

console.log("api:", API_VERSION, "formats:", FORMATS.join(", "));
console.log("all assertions passed!");

// Uncomment to see power-assert diagnostics:
// assert(users.length === admins.length);
//   Power Assert Output:
//   assert(users.length === admins.length)
//          |     |      |   |       |
//          |     3      |   |       1
//          |            |   ["alice"]
//          |          false
//          ["alice","bob","charlie"]

// Try: change admins to have more entries than users and watch it fail
