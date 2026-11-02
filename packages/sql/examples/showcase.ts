/**
 * @typesugar/sql Showcase
 *
 * Self-documenting examples of the Doobie-like type-safe SQL DSL:
 * composable fragments, typed queries, Meta/Get/Put typeclasses,
 * ConnectionIO free monad, typed fragments, and macro utilities.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Core types
  Fragment,
  Query,
  Update,
  type SqlParam,

  // SQL typeclasses (Get, Put, Meta, Read, Write, Codec are available but not
  // demonstrated directly - they're used internally by deriveRead/Write/Codec)
  toSnakeCase,
  deriveRead,
  deriveWrite,
  deriveCodec,

  // Primitive Meta instances
  stringMeta,
  numberMeta,
  intMeta,
  booleanMeta,
  nullable,
  optional,
  arrayMeta,

  // Typed fragments (TypedQuery, TypedUpdate, and combinators like andTyped,
  // orTyped, commasTyped, etc. are available for advanced composition)
  TypedFragment,
  emptyTyped,

  // ConnectionIO
  ConnectionIO,
  Transactor,
  Left,
  Right,
  sequence,
  traverse,
  when,
  whenA,
  type Either,
  type DbConnection,

  // Macros
  sql,
} from "@typesugar/sql";

// ============================================================================
// 1. FRAGMENT BASICS — Composable SQL Building Blocks
// ============================================================================

// Fragment is the core primitive: SQL text + bound parameters.
// Fragments are immutable — every operation returns a new Fragment.

const frag1 = new Fragment(["SELECT * FROM users WHERE id = ", ""], [42]);
assert(frag1.text === "SELECT * FROM users WHERE id = $1");
assert(frag1.values[0] === 42);

// Fragment.raw() creates SQL without parameters
const selectAll = Fragment.raw("SELECT * FROM users");
assert(selectAll.text === "SELECT * FROM users");
assert(selectAll.values.length === 0);

// Fragment.param() creates a single parameter placeholder
const paramFrag = Fragment.param("Alice");
assert(paramFrag.text === "$1");
assert(paramFrag.values[0] === "Alice");

// Fragment.empty is the identity element for composition
assert(Fragment.empty.text === "");
assert(Fragment.empty.values.length === 0);

// ============================================================================
// 2. FRAGMENT COMPOSITION — Building Complex Queries
// ============================================================================

// append() concatenates with a space
const base = Fragment.raw("SELECT * FROM users");
const where = new Fragment(["WHERE name = ", ""], ["Alice"]);
const combined = base.append(where);
assert(combined.text === "SELECT * FROM users WHERE name = $1");

// appendNoSpace() concatenates without a space
const open = Fragment.raw("(");
const inner = Fragment.raw("1, 2, 3");
const close = Fragment.raw(")");
const list = open.appendNoSpace(inner).appendNoSpace(close);
assert(list.text === "(1, 2, 3)");

// parens() wraps in parentheses
const wrapped = Fragment.raw("a = 1").parens();
assert(wrapped.text === "(a = 1)");

// ============================================================================
// 3. SQL COMBINATORS — AND, OR, IN, VALUES, SET, WHERE
// ============================================================================

// Fragment.and() joins with AND
const cond1 = new Fragment(["name = ", ""], ["Alice"]);
const cond2 = new Fragment(["age > ", ""], [30]);
const andFrag = Fragment.and([cond1, cond2]);
assert(andFrag.text === "name = $1 AND age > $2");
assert(andFrag.values.length === 2);

// Fragment.or() joins with OR and wraps in parens
const orFrag = Fragment.or([cond1, cond2]);
assert(orFrag.text === "(name = $1 OR age > $2)");

// Fragment.commas() for comma-separated lists
const cols = Fragment.commas([Fragment.raw("id"), Fragment.raw("name"), Fragment.raw("email")]);
assert(cols.text === "id, name, email");

// Fragment.inList() generates IN ($1, $2, ...)
const inFrag = Fragment.inList("status", ["active", "pending"]);
assert(inFrag.text === "status IN ($1, $2)");
assert(inFrag.values[0] === "active");

// Empty IN list becomes FALSE (SQL standard)
const emptyIn = Fragment.inList("id", []);
assert(emptyIn.text === "FALSE");

// Fragment.values() for INSERT VALUES clauses
const valuesFrag = Fragment.values([
  ["Alice", 30],
  ["Bob", 25],
]);
assert(valuesFrag.text === "VALUES ($1, $2), ($3, $4)");
assert(valuesFrag.values.length === 4);

// Fragment.set() for UPDATE SET clauses
const setFrag = Fragment.set({ name: "Alice", age: 31 });
assert(setFrag.text.startsWith("SET "));
assert(setFrag.values.length === 2);

// Fragment.when() for conditional fragments
const includeAge = true;
const conditionalFrag = Fragment.when(includeAge, () => new Fragment(["AND age > ", ""], [18]));
assert(conditionalFrag.text.includes("age > $1"));

const excludedFrag = Fragment.when(false, () => Fragment.raw("NEVER"));
assert(excludedFrag.text === "");

// Fragment.whereAnd() builds a WHERE clause from optional conditions
const whereFrag = Fragment.whereAnd([
  new Fragment(["name = ", ""], ["Alice"]),
  Fragment.empty,
  new Fragment(["active = ", ""], [true]),
]);
assert(whereFrag.text.startsWith("WHERE "));
assert(whereFrag.values.length === 2);

// ============================================================================
// 4. QUERY & UPDATE — Typed Wrappers
// ============================================================================

// Query<R> carries the expected result row type
interface User {
  id: number;
  name: string;
  email: string;
}

const userQuery = new Query<User>(
  new Fragment(["SELECT id, name, email FROM users WHERE id = ", ""], [1])
);
assert(userQuery._tag === "Query");
assert(userQuery.text.includes("SELECT"));
typeAssert<Extends<typeof userQuery, Query<User>>>();

// Query.map() transforms the result type (compile-time only)
const nameQuery = userQuery.map((u) => u.name);
typeAssert<Extends<typeof nameQuery, Query<string>>>();

// Update for INSERT/UPDATE/DELETE
const insertUpdate = new Update(
  new Fragment(["INSERT INTO users (name, email) VALUES (", ", ", ")"], ["Alice", "alice@example.com"])
);
assert(insertUpdate._tag === "Update");
assert(insertUpdate.text.includes("INSERT"));

// ============================================================================
// 5. SQL TAGGED TEMPLATE — Runtime Fallback
// ============================================================================

// The sql`` tagged template is the primary user-facing API.
// At compile time, the macro validates SQL syntax and optimizes.
// At runtime, the fallback builds fragments normally.

const name = "Alice";
const age = 30;
const query = sql`SELECT * FROM users WHERE name = ${name} AND age > ${age}`;
assert(query instanceof Fragment);
assert(query.text === "SELECT * FROM users WHERE name = $1 AND age > $2");
assert(query.values[0] === "Alice");
assert(query.values[1] === 30);

// Composing fragments via sql``
const baseQuery = sql`SELECT * FROM users`;
const whereClause = sql`WHERE active = ${true}`;
const fullQuery = baseQuery.append(whereClause);
assert(fullQuery.text === "SELECT * FROM users WHERE active = $1");

// Convert to typed Query or Update via prototype extensions
const typedQuery = sql`SELECT id, name FROM users`.toQuery<User>();
typeAssert<Extends<typeof typedQuery, Query<User>>>();

const typedUpdate = sql`DELETE FROM users WHERE id = ${1}`.toUpdate();
typeAssert<Extends<typeof typedUpdate, Update>>();

// ============================================================================
// 6. META TYPECLASSES — SQL ↔ TypeScript Type Mapping
// ============================================================================

// Meta combines Get (read from SQL) and Put (write to SQL) for a single column.
// Primitive instances are provided for common types.

// stringMeta: string ↔ TEXT
assert(stringMeta.get("hello") === "hello");
assert(stringMeta.put("world") === "world");

// numberMeta: number ↔ NUMERIC
assert(numberMeta.get(42) === 42);
assert(numberMeta.put(3.14) === 3.14);

// intMeta: rounds to integer
assert(intMeta.get(42) === 42);

// booleanMeta: boolean ↔ BOOLEAN
assert(booleanMeta.get(true) === true);
assert(booleanMeta.put(false) === false);

// nullable() wraps a Meta to handle NULL
const nullableMeta = nullable(stringMeta);
assert(nullableMeta.get(null) === null);
assert(nullableMeta.get("hello") === "hello");
assert(nullableMeta.put(null) === null);

// optional() wraps to handle undefined
const optionalMeta = optional(numberMeta);
assert(optionalMeta.get(undefined) === undefined);
assert(optionalMeta.get(42) === 42);

// arrayMeta() for array columns
const arrayOfStrings = arrayMeta(stringMeta);
const arr = arrayOfStrings.get(["a", "b", "c"]);
assert(Array.isArray(arr) && arr.length === 3);

// ============================================================================
// 7. DERIVE TYPECLASSES — Auto-Generate Read/Write/Codec
// ============================================================================

// deriveRead() generates a Read instance from each field's column config: its
// Meta, and optionally the column name (default: the field in snake_case)
const userColumns = {
  id: { meta: numberMeta },
  name: { meta: stringMeta },
  email: { meta: stringMeta, column: "email_address" },
};
const userRead = deriveRead<User>(userColumns);
const userRow = { id: 1, name: "Alice", email_address: "alice@example.com" };
const user = userRead.read(userRow)!; // null when a required column is missing
assert(user.id === 1);
assert(user.name === "Alice");
assert(user.email === "alice@example.com");

// deriveWrite() generates a Write instance: the SQL parameters in column order
const userWrite = deriveWrite<User>(userColumns);
const written = userWrite.write({ id: 1, name: "Bob", email: "bob@example.com" });
assert(written.length === 3);
assert(written[0] === 1);
assert(written[1] === "Bob");
assert(userWrite.columns.join(",") === "id,name,email_address");

// deriveCodec() combines Read + Write
const userCodec = deriveCodec<User>(userColumns);
assert(typeof userCodec.read === "function");
assert(typeof userCodec.write === "function");

// toSnakeCase() for column name mapping
assert(toSnakeCase("firstName") === "first_name");
assert(toSnakeCase("HTMLParser") === "html_parser");
assert(toSnakeCase("id") === "id");

// ============================================================================
// 8. CONNECTIONIO — Pure Database Operations (Free Monad)
// ============================================================================

// ConnectionIO describes database operations without executing them.
// Programs are pure and composable — execution happens via Transactor.

// ConnectionIO.pure() lifts a value; a program is an operation, not a result
const pureProgram = ConnectionIO.pure(42);
assert(pureProgram.op._tag === "Pure");

// .map() transforms results, .flatMap() sequences programs
const mappedProgram = ConnectionIO.pure(10).map((x) => x * 2);
assert(mappedProgram.op._tag === "FlatMap");

const sequencedProgram = ConnectionIO.pure("Alice").flatMap((name) =>
  ConnectionIO.pure(`Hello, ${name}!`)
);
assert(sequencedProgram.op._tag === "FlatMap");

// ConnectionIO.queryMany() runs a query and decodes every row with a Read
const readUser = { read: (row: Record<string, unknown>) => row as unknown as User };
const queryProgram = ConnectionIO.queryMany(
  new Query<User>(Fragment.raw("SELECT * FROM users")),
  readUser
);
assert(queryProgram.op._tag === "QueryMany");

// ConnectionIO.execute() runs an update, giving the affected row count
const updateProgram = ConnectionIO.execute(
  new Update(sql`INSERT INTO logs (message) VALUES (${"test"})`)
);
assert(updateProgram.op._tag === "Execute");

// ============================================================================
// 9. EITHER — Error Handling in ConnectionIO
// ============================================================================

// Left and Right for error handling in pure database programs
const success: Either<string, number> = Right(42);
const failure: Either<string, number> = Left("not found");

assert(success._tag === "Right" && success.right === 42);
assert(failure._tag === "Left" && failure.left === "not found");

// ============================================================================
// 10. TYPED FRAGMENTS — Type-Tracked SQL Composition
// ============================================================================

// TypedFragment carries type information through composition.
// TypedQuery and TypedUpdate are typed wrappers.

// (the sql$ macro builds these from a template, with the parameter types
// inferred; the constructor takes the text segments and the parameters)
const tf1 = new TypedFragment(["SELECT * FROM users"], []);
assert(tf1.toFragment() instanceof Fragment);

const tf2 = new TypedFragment(["active = ", ""], [true]);
assert(tf2.toFragment().values[0] === true);

// emptyTyped is the identity
const emptyTf = emptyTyped;
assert(emptyTf.toFragment().text === "");

// ============================================================================
// 11. TRANSACTOR — Execute ConnectionIO Against a Database
// ============================================================================

// Transactor interprets ConnectionIO programs against a real connection.
// Here we test with a mock connection.

const mockConn: DbConnection = {
  query: async (text: string, params: readonly unknown[]) => [
    { id: 1, name: "Alice", email: "alice@example.com" },
  ],
  execute: async () => 1,
  begin: async () => {},
  commit: async () => {},
  rollback: async () => {},
};

const transactor = Transactor.fromConnection(mockConn);

// Run a pure program
const pureResult = await transactor.run(ConnectionIO.pure("hello"));
assert(pureResult === "hello", "Transactor should handle Pure");

// Run a query program
const queryResult = await transactor.run(queryProgram);
assert(Array.isArray(queryResult), "Query result should be an array");
assert(queryResult[0].name === "Alice");

// Run a flatMap chain
const chainResult = await transactor.run(
  ConnectionIO.pure(1).flatMap((id) => ConnectionIO.pure(`User ${id}`))
);
assert(chainResult === "User 1");

// ============================================================================
// 12. COMBINATORS — Sequence, Traverse, When
// ============================================================================

// sequence() runs multiple programs and collects results
const seqResult = await transactor.run(
  sequence([ConnectionIO.pure(1), ConnectionIO.pure(2), ConnectionIO.pure(3)])
);
assert(seqResult.join(",") === "1,2,3");

// traverse() maps over a list and sequences the results
const travResult = await transactor.run(traverse([1, 2, 3], (n) => ConnectionIO.pure(n * 10)));
assert(travResult.join(",") === "10,20,30");

// when() runs a program only if the condition holds
let ran = 0;
const effect = ConnectionIO.delay(() => {
  ran++;
});
await transactor.run(when(true, effect));
await transactor.run(when(false, effect));
assert(ran === 1);

// whenA() gives the result, or null when skipped
const kept = await transactor.run(whenA(true, ConnectionIO.pure("effect")));
const skipped = await transactor.run(whenA(false, ConnectionIO.pure("effect")));
assert(kept === "effect" && skipped === null);

// ============================================================================
// 13. REAL-WORLD PATTERN — Repository with ConnectionIO
// ============================================================================

// In a real application:
//
// /** @derive(Read, Write) */
// interface User { id: number; name: string; email: string }
//
// const findById = (id: number) =>
//   ConnectionIO.query(
//     sql`SELECT id, name, email FROM users WHERE id = ${id}`.toQuery<User>(),
//     summon<Read<User>>()
//   );
//
// const updateEmail = (id: number, email: string) =>
//   ConnectionIO.execute(
//     sql`UPDATE users SET email = ${email} WHERE id = ${id}`.toUpdate()
//   );
//
// const transferEmail = (fromId: number, toId: number) =>
//   findById(fromId).flatMap((user) =>
//     user === null ? ConnectionIO.pure(0) : updateEmail(toId, user.email)
//   );
//
// // Execute within a transaction
// await transactor.transact(transferEmail(1, 2));

console.log("@typesugar/sql showcase: all assertions passed!");
