/**
 * SQL Typeclasses with Auto-Derivation
 *
 * This example demonstrates the Doobie-style typeclasses with:
 *
 * 1. Get/Put/Meta — Single-column type mapping
 * 2. Read/Write/Codec — Row-level type mapping
 * 3. @deriving(Read, Write) — Auto-derivation from type structure
 * 4. Compositional combinators — nullable, optional, array, imap, contramap
 * 5. Zero-cost specialization — Inline operations at compile time
 */

import {
  // Core typeclasses
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,
  SqlRow,

  // Derivation helpers
  deriveRead,
  deriveWrite,
  deriveCodec,
  toSnakeCase,

  // ConnectionIO
  ConnectionIO,
  Transactor,

  // Fragment system
  TypedFragment,
  TypedQuery,
} from "../src/index.js";

// ============================================================================
// 1. Primitive Instances
// ============================================================================

// Get, Put, and Meta come with pre-defined instances for primitives:
//
// Get.string, Get.number, Get.boolean, Get.bigint, Get.date, Get.uuid, etc.
// Put.string, Put.number, Put.boolean, Put.bigint, Put.date, Put.uuid, etc.
// Meta.string, Meta.number, Meta.boolean, Meta.bigint, Meta.date, Meta.uuid, etc.

console.log("=== Primitive Instances ===");

// Read a string from a SQL value
const strValue = Get.string.get("hello");
console.log("Get.string:", strValue); // "hello"

// Read a number
const numValue = Get.number.get(42);
console.log("Get.number:", numValue); // 42

// Read a boolean (handles various SQL representations)
console.log("Get.boolean('t'):", Get.boolean.get("t")); // true
console.log("Get.boolean(1):", Get.boolean.get(1)); // true
console.log("Get.boolean(false):", Get.boolean.get(false)); // false

// Read a Date
const dateValue = Get.date.get("2024-01-15T10:30:00Z");
console.log("Get.date:", dateValue); // Date object

// Write values back
console.log("Put.string:", Put.string.put("hello")); // "hello"
console.log("Put.date:", Put.date.put(new Date())); // ISO string

// ============================================================================
// 2. Nullable and Optional
// ============================================================================

console.log("\n=== Nullable and Optional ===");

// Nullable — handle SQL NULL
const nullableString = Get.nullable(Get.string);
console.log("nullable null:", nullableString.get(null)); // null
console.log("nullable value:", nullableString.get("hello")); // "hello"

// Optional — map NULL to undefined
const optionalNumber = Get.optional(Get.number);
console.log("optional null:", optionalNumber.get(null)); // undefined
console.log("optional value:", optionalNumber.get(42)); // 42

// Arrays
const arrayOfStrings = Get.array(Get.string);
console.log("array:", arrayOfStrings.get(["a", "b", "c"])); // ["a", "b", "c"]

// ============================================================================
// 3. Newtype Derivation with imap/contramap
// ============================================================================

console.log("\n=== Newtype Derivation ===");

// Define a branded/newtype for UserId
type UserId = string & { readonly __brand: "UserId" };
const UserId = (s: string): UserId => s as UserId;

// Derive Get instance via map (functor)
const getUserId: Get<UserId> = Get.map(Get.string, UserId);
console.log("getUserId:", getUserId.get("user_123")); // "user_123" as UserId

// Derive Put instance via contramap (contravariant functor)
const putUserId: Put<UserId> = Put.contramap(Put.string, (id: UserId) => id);
console.log("putUserId:", putUserId.put(UserId("user_123"))); // "user_123"

// Derive Meta instance via imap (invariant functor)
const userIdMeta: Meta<UserId> = Meta.imap(
  Meta.string,
  UserId, // string -> UserId
  (id: UserId) => id, // UserId -> string
);
console.log("userIdMeta.get:", userIdMeta.get("user_456")); // UserId
console.log("userIdMeta.put:", userIdMeta.put(UserId("user_456"))); // "user_456"

// ============================================================================
// 4. Manual Row-Level Derivation
// ============================================================================

console.log("\n=== Manual Row Derivation ===");

// Define a User type
interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date | null;
}

// Manually derive Read using the helper
const ReadUser = deriveRead<User>({
  id: { meta: Meta.number },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },
  updatedAt: {
    meta: Meta.nullable(Meta.date),
    column: "updated_at",
    nullable: true,
  },
});

// Test reading a row
const row: SqlRow = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  created_at: "2024-01-15T10:30:00Z",
  updated_at: null,
};

const user = ReadUser.read(row);
console.log("ReadUser.read:", user);
// { id: 1, name: "Alice", email: "alice@example.com", createdAt: Date, updatedAt: null }

console.log("ReadUser.columns:", ReadUser.columns);
// ["id", "name", "email", "created_at", "updated_at"]

// Manually derive Write
const WriteUser = deriveWrite<User>({
  id: { meta: Meta.number },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },
  updatedAt: { meta: Meta.nullable(Meta.date), column: "updated_at" },
});

const params = WriteUser.write(user!);
console.log("WriteUser.write:", params);
// [1, "Alice", "alice@example.com", "2024-01-15T...", null]

// ============================================================================
// 5. Auto-Derivation with @deriving (Compile-Time)
// ============================================================================

/**
 * With the macro transformer, you can use @deriving decorator:
 *
 * @deriving(Read, Write)
 * interface Post {
 *   id: number;
 *   title: string;
 *   content: string;
 *   authorId: number;
 *   publishedAt: Date | null;
 * }
 *
 * // This generates:
 * // export const ReadPost: Read<Post> = Read.make([...], (fields) => fields as Post);
 * // export const WritePost: Write<Post> = Write.make([...], [...]);
 *
 * // With column mappings:
 * // - authorId -> author_id
 * // - publishedAt -> published_at
 */

// Simulated generated code:
interface Post {
  id: number;
  title: string;
  content: string;
  /** @column("author_id") */
  authorId: number;
  /** @column("published_at") */
  publishedAt: Date | null;
}

const ReadPost = deriveRead<Post>({
  id: { meta: Meta.number },
  title: { meta: Meta.string },
  content: { meta: Meta.string },
  authorId: { meta: Meta.number, column: "author_id" },
  publishedAt: {
    meta: Meta.nullable(Meta.date),
    column: "published_at",
    nullable: true,
  },
});

const WritePost = deriveWrite<Post>({
  id: { meta: Meta.number },
  title: { meta: Meta.string },
  content: { meta: Meta.string },
  authorId: { meta: Meta.number, column: "author_id" },
  publishedAt: { meta: Meta.nullable(Meta.date), column: "published_at" },
});

console.log("\n=== Auto-Derived Post ===");
console.log("ReadPost.columns:", ReadPost.columns);

// ============================================================================
// 6. Codec — Bidirectional Row Mapping
// ============================================================================

console.log("\n=== Codec (Read + Write) ===");

// Derive both Read and Write in one call
const CodecUser = deriveCodec<User>({
  id: { meta: Meta.number },
  name: { meta: Meta.string },
  email: { meta: Meta.string },
  createdAt: { meta: Meta.date, column: "created_at" },
  updatedAt: {
    meta: Meta.nullable(Meta.date),
    column: "updated_at",
    nullable: true,
  },
});

// Use both directions
const readUser2 = CodecUser.read(row);
const writeParams = CodecUser.write(readUser2!);
console.log("CodecUser.read:", readUser2);
console.log("CodecUser.write:", writeParams);

// ============================================================================
// 7. Compositional Read/Write
// ============================================================================

console.log("\n=== Compositional Read/Write ===");

// Read a single column
const readId = Read.column("id", Get.number);
const readName = Read.column("name", Get.string);

// Combine with product
const readIdAndName = Read.product(readId, readName);
const [id, name] = readIdAndName.unsafeRead({ id: 1, name: "Bob" });
console.log("product:", { id, name }); // { id: 1, name: "Bob" }

// Combine multiple with tuple
const readTuple = Read.tuple(
  Read.column("a", Get.number),
  Read.column("b", Get.string),
  Read.column("c", Get.boolean),
);
const tuple = readTuple.unsafeRead({ a: 1, b: "hello", c: true });
console.log("tuple:", tuple); // [1, "hello", true]

// Map over Read
const readUserName = Read.map(readName, (n) => n.toUpperCase());
console.log("mapped:", readUserName.unsafeRead({ name: "alice" })); // "ALICE"

// ============================================================================
// 8. Integration with ConnectionIO
// ============================================================================

console.log("\n=== ConnectionIO Integration ===");

// Define a typed query
function findUserById(id: number): ConnectionIO<User | null> {
  const query = {
    _tag: "Query" as const,
    columns: ReadUser.columns,
    toSql: () => ({
      sql: `SELECT ${ReadUser.columns.join(", ")} FROM users WHERE id = $1`,
      params: [id],
    }),
  } as unknown as TypedQuery<[number], User>;

  return ConnectionIO.query(query, ReadUser);
}

// Compose pure database operations
const program = findUserById(1);
console.log("ConnectionIO program created");

// ============================================================================
// 9. Zero-Cost Specialization
// ============================================================================

/**
 * When used with the `specialize` macro, Read/Write operations are inlined:
 *
 * ```typescript
 * // Generic code:
 * const readUser = <A>(read: Read<A>, row: SqlRow) => read.read(row);
 *
 * // Specialized for User:
 * const readUserSpecialized = specialize(readUser, ReadUser);
 *
 * // Compiles to (no dictionary lookups!):
 * const readUserSpecialized = (row: SqlRow) => ({
 *   id: row.id as number,
 *   name: row.name as string,
 *   email: row.email as string,
 *   createdAt: new Date(row.created_at as string),
 *   updatedAt: row.updated_at ? new Date(row.updated_at as string) : null,
 * });
 * ```
 *
 * This is the "zero-cost" part — typeclass abstraction with no runtime overhead.
 */

// ============================================================================
// 10. Implicit Resolution with summon
// ============================================================================

console.log("\n=== Implicit Resolution ===");

/**
 * Doobie-style implicit resolution allows you to summon instances by type name.
 *
 * There are two approaches:
 *
 * ## 1. Runtime Registry (for dynamically registered instances)
 *
 * Each typeclass companion has `summon` and `registerInstance` methods:
 *
 * ```typescript
 * // Register an instance
 * Read.registerInstance<User>("User", ReadUser);
 *
 * // Summon it back
 * const reader = Read.summon<User>("User");
 * ```
 *
 * ## 2. Compile-Time Summon (with auto-derivation)
 *
 * The `summon<Read<User>>()` expression macro will:
 * 1. First check the registry for an explicit instance
 * 2. If not found and all fields have Get instances, auto-derive
 *
 * ```typescript
 * // With @deriving, instance is registered automatically
 * @deriving(Read, Write)
 * interface User { id: number; name: string; }
 *
 * // Later, summon works:
 * const reader = summon<Read<User>>();
 * ```
 */

// Register our manually derived instances
Read.registerInstance<User>("User", ReadUser);
Write.registerInstance<User>("User", WriteUser);
Codec.registerInstance<User>("User", CodecUser);

Read.registerInstance<Post>("Post", ReadPost);
Write.registerInstance<Post>("Post", WritePost);

// Now we can summon them by type name
const summonedReader = Read.summon<User>("User");
console.log("Summoned Read<User>:", summonedReader ? "Found!" : "Not found");
console.log("Summoned Read<User>.columns:", summonedReader?.columns);

const summonedWriter = Write.summon<User>("User");
console.log("Summoned Write<User>:", summonedWriter ? "Found!" : "Not found");
console.log("Summoned Write<User>.columns:", summonedWriter?.columns);

// Primitive instances are pre-registered
const stringGet = Get.summon<string>("string");
console.log("Get.summon('string'):", stringGet ? "Found!" : "Not found");

const numberMeta = Meta.summon<number>("number");
console.log("Meta.summon('number'):", numberMeta ? "Found!" : "Not found");

/**
 * ## Auto-Derivation Flow
 *
 * When you use @deriving(Read), the macro:
 *
 * 1. Inspects all field types
 * 2. Resolves Get instances for each field (using Get.summon)
 * 3. Generates the Read instance
 * 4. Registers it with Read.registerInstance
 *
 * This means after compilation, `Read.summon<MyType>("MyType")` will
 * return the derived instance.
 *
 * ## Benefits
 *
 * - Generic code can work with any type that has instances:
 *
 *   ```typescript
 *   function queryFirst<T>(sql: string, typeName: string): T | null {
 *     const reader = Read.summon<T>(typeName);
 *     if (!reader) throw new Error(`No Read instance for ${typeName}`);
 *     // ... execute query and read result
 *   }
 *   ```
 *
 * - Library code can be written generically:
 *
 *   ```typescript
 *   @implicits
 *   function insert<T>(table: string, value: T, W: Write<T>): Update {
 *     // W is resolved via Write.summon at compile time
 *   }
 *   ```
 */

// ============================================================================
// 11. Scala 3-Style Auto-Derivation via Mirror
// ============================================================================

console.log("\n=== Scala 3-Style Auto-Derivation ===");

/**
 * ## Scala 3-Style Typeclass Derivation
 *
 * ttfx follows the Scala 3 `derives` model for automatic typeclass derivation.
 *
 * ### Scala 3 recap
 *
 * ```scala
 * case class User(id: Int, name: String, email: String) derives Show, Eq
 *
 * // The compiler provides Mirror.ProductOf[User]:
 * //   MirroredElemTypes  = (Int, String, String)
 * //   MirroredElemLabels = ("id", "name", "email")
 * //
 * // Show companion defines:
 * //   given derived[T](using m: Mirror.ProductOf[T], ...): Show[T]
 * //
 * // summon[Show[User]] resolves via `derived` + Mirror
 * ```
 *
 * ### ttfx equivalent
 *
 * ```typescript
 * // Just define the type — no annotations needed:
 * interface User { id: number; name: string; email: string; }
 *
 * // summon synthesizes the Mirror automatically via the TypeChecker:
 * //   GenericMeta("User") = {
 * //     kind: "product",
 * //     fieldNames: ["id", "name", "email"],    // ≈ MirroredElemLabels
 * //     fieldTypes: ["number", "string", "string"] // ≈ MirroredElemTypes
 * //   }
 *
 * // Read.derived (registered via registerGenericDerivation) uses:
 * //   Mirror + Get instances per element type → Read<User>
 *
 * const reader = summon<Read<User>>(); // auto-derived at compile time!
 * ```
 *
 * ### Key difference from @deriving
 *
 * - `@deriving(Read)` is explicit — you annotate each type with each typeclass
 * - Scala 3-style is implicit — summon inspects the type and derives automatically
 * - Both are compile-time, zero-cost
 * - Scala 3-style is more general: any typeclass that defines `derived`
 *   (via registerGenericDerivation) gets auto-derivation for free
 * - No `@derive(Generic)` needed — the TypeChecker is the Mirror
 *
 * ### How to add `derived` for a new typeclass:
 *
 * ```typescript
 * import { registerGenericDerivation, makePrimitiveChecker } from "ttfx/macros";
 *
 * // ≈ object MyTC { given derived[T](using Mirror.ProductOf[T], ...): MyTC[T] }
 * registerGenericDerivation("MyTC", {
 *   typeclassName: "MyTC",
 *   fieldTypeclass: "MyFieldTC",  // required given for each element type
 *   hasFieldInstance: makePrimitiveChecker(new Set(["number", "string"])),
 *   deriveProduct(ctx, typeName, meta) {
 *     return `{ ... }`;
 *   },
 * });
 *
 * // Now summon<MyTC<AnyType>>() auto-derives!
 * ```
 *
 * ### Built-in `derived` strategies:
 *
 * Core (auto-derive.ts): Show, Eq, Ord, Hash, Clone
 * SQL (auto-derive-strategies.ts): Read (via Get), Write (via Put), Codec (via Read+Write)
 */

// ============================================================================
// Summary
// ============================================================================

console.log("\n=== Summary ===");
console.log(`
SQL Typeclasses provide:

1. Get<A> — Read single column values
   - Primitive instances: Get.string, Get.number, Get.boolean, Get.date, etc.
   - Combinators: Get.nullable, Get.optional, Get.array, Get.map
   - Implicit resolution: Get.summon<A>(typeName)

2. Put<A> — Write single column values  
   - Primitive instances: Put.string, Put.number, Put.boolean, Put.date, etc.
   - Combinators: Put.nullable, Put.optional, Put.array, Put.contramap
   - Implicit resolution: Put.summon<A>(typeName)

3. Meta<A> — Bidirectional single-column (Get + Put)
   - Invariant functor: Meta.imap for newtype derivation
   - Implicit resolution: Meta.summon<A>(typeName)

4. Read<A> — Read entire rows
   - deriveRead() for manual derivation
   - @deriving(Read) for explicit derivation
   - Scala 3-style: summon<Read<T>>() auto-derives via Mirror + Get instances
   - Combinators: Read.product, Read.tuple, Read.map

5. Write<A> — Write as multiple parameters
   - deriveWrite() for manual derivation
   - @deriving(Write) for explicit derivation
   - Scala 3-style: summon<Write<T>>() auto-derives via Mirror + Put instances
   - Combinators: Write.product, Write.tuple, Write.contramap

6. Codec<A> — Bidirectional row-level (Read + Write)
   - deriveCodec() for manual derivation
   - @deriving(Codec) for explicit derivation
   - Scala 3-style: summon<Codec<T>>() auto-derives via Mirror + Read + Write

Key features:
- Scala 3-style derives: summon() auto-derives via TypeChecker inspection
- No annotations needed: summon synthesizes the Mirror from the type definition
- Mirror ≈ GenericMeta: fieldNames (MirroredElemLabels) + fieldTypes (MirroredElemTypes)
- Zero-cost: specialize() inlines all typeclass operations at compile time
- General: any typeclass can register a derived strategy via registerGenericDerivation()
- Compile error on failure: summon never silently falls back to runtime
`);
