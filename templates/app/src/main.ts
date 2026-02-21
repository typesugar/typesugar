/**
 * typesugar App Template
 *
 * This template demonstrates common typesugar features for applications.
 */

import { comptime } from "@typesugar/comptime";
import { derive, Eq, Clone, Debug, Json } from "@typesugar/derive";
import { sql } from "@typesugar/sql";

// Compile-time evaluation
const BUILD_INFO = comptime({
  version: "1.0.0",
  buildTime: new Date().toISOString(),
  environment: process.env.NODE_ENV ?? "development",
});

console.log("Build info:", BUILD_INFO);

// Auto-derived implementations
@derive(Eq, Clone, Debug, Json)
class User {
  constructor(
    public id: number,
    public name: string,
    public email: string
  ) {}
}

const user = new User(1, "Alice", "alice@example.com");
console.log("User:", user.debug());

// Clone and compare
const userCopy = user.clone();
console.log("Equal:", user.equals(userCopy));

// JSON serialization
const json = user.toJson();
console.log("JSON:", json);

const parsed = User.fromJson(json);
console.log("Parsed:", parsed.debug());

// Type-safe SQL
const userId = 42;
const status = "active";

const query = sql`
  SELECT * FROM users
  WHERE id = ${userId} AND status = ${status}
`;

console.log("Query:", query.text);
console.log("Params:", query.params);
