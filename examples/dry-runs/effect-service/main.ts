// Service-oriented application using Effect-TS + TypeSugar
// Tests: comptime, pipe, @derive, erased, typeInfo, Effect service layers

import { comptime, pipe, derive, Eq, Clone, Debug, typeInfo } from "typesugar";
import { Effect, Context, Layer } from "effect";
import { showable, show } from "@typesugar/erased";

// ============================================================================
// 1. comptime — compile-time evaluation
// ============================================================================

const BUILD_TIME = comptime(new Date().toISOString());
const APP_VERSION = comptime("1.0.0");

console.log(`App v${APP_VERSION} built at ${BUILD_TIME}`);

// ============================================================================
// 2. @derive — Auto-generate Eq, Clone, Debug
// ============================================================================

@derive(Eq, Clone, Debug)
class UserId {
  constructor(public value: string) {}
}

@derive(Eq, Clone, Debug)
class Email {
  constructor(public value: string) {}
}

@derive(Eq, Debug)
class User {
  constructor(
    public id: UserId,
    public name: string,
    public email: Email,
    public role: "admin" | "user" | "guest"
  ) {}
}

// Test derived equality (operator rewriting: === -> Eq.equals)
const id1 = new UserId("u-001");
const id2 = new UserId("u-001");
const id3 = new UserId("u-002");
console.log("UserId eq (same):", id1 === id2); // true (structural)
console.log("UserId eq (diff):", id1 === id3); // false

// ============================================================================
// 3. pipe — zero-cost function composition
// ============================================================================

const processName = pipe(
  "  Alice  ",
  (s: string) => s.trim(),
  (s: string) => s.toLowerCase(),
  (s: string) => `user:${s}`
);
console.log("Processed:", processName);

// Real-world data pipeline
const users = [
  { name: "Alice", age: 30 },
  { name: "Bob", age: 25 },
  { name: "Charlie", age: 35 },
];

const adultNames = pipe(
  users,
  (arr: typeof users) => arr.filter(u => u.age >= 30),
  (arr: typeof users) => arr.map(u => u.name),
  (names: string[]) => names.join(", ")
);
console.log("Adults:", adultNames);

// ============================================================================
// 4. typeInfo — compile-time type reflection
// ============================================================================

interface CreateUserInput {
  name: string;
  email: string;
  age: number;
}

const userSchema = typeInfo<CreateUserInput>();
console.log("Schema:", userSchema.name, "—", userSchema.fields?.length, "fields");

// Build runtime validator from compile-time schema
function makeValidator(schema: { fields?: Array<{ name: string; type: string }> }) {
  return (obj: unknown): boolean => {
    if (typeof obj !== "object" || obj === null) return false;
    for (const f of schema.fields ?? []) {
      if (f.type === "number" && typeof (obj as any)[f.name] !== "number") return false;
      if (f.type === "string" && typeof (obj as any)[f.name] !== "string") return false;
    }
    return true;
  };
}

const isCreateUserInput = makeValidator(userSchema);
console.log("Valid:", isCreateUserInput({ name: "Bob", email: "bob@co.com", age: 30 }));
console.log("Invalid:", isCreateUserInput({ name: 42, email: null }));

// ============================================================================
// 5. Erased types (type erasure / dyn Trait)
// ============================================================================

const showableItems = [
  showable("hello", (v) => `String(${v})`),
  showable(42, (v) => `Number(${v})`),
  showable(true, (v) => `Bool(${v})`),
];

for (const item of showableItems) {
  console.log("Erased show:", show(item));
}

// ============================================================================
// 6. Effect-TS service layer (manual tags — @service macro doesn't expand)
// ============================================================================

const alice = new User(
  new UserId("u-001"),
  "Alice",
  new Email("alice@example.com"),
  "admin"
);

interface Logger {
  info(msg: string): Effect.Effect<void>;
  error(msg: string): Effect.Effect<void>;
}
const LoggerTag = Context.GenericTag<Logger>("Logger");

interface UserRepository {
  findById(id: string): Effect.Effect<User | null>;
}
const UserRepositoryTag = Context.GenericTag<UserRepository>("UserRepository");

interface AuthService {
  authenticate(email: string, password: string): Effect.Effect<string>;
}
const AuthServiceTag = Context.GenericTag<AuthService>("AuthService");

// Provide implementations via layers
const LoggerLive = Layer.succeed(LoggerTag, {
  info: (msg: string) => Effect.sync(() => console.log(`[INFO] ${msg}`)),
  error: (msg: string) => Effect.sync(() => console.error(`[ERROR] ${msg}`)),
});

const UserRepositoryLive = Layer.succeed(UserRepositoryTag, {
  findById: (id: string) =>
    Effect.succeed(id === "u-001" ? alice : null),
});

const AuthServiceLive = Layer.succeed(AuthServiceTag, {
  authenticate: (email: string, _password: string) =>
    Effect.succeed(email === "alice@example.com" ? "authenticated" : "denied"),
});

// Build program using Effect.gen
const program = Effect.gen(function* () {
  const logger = yield* LoggerTag;
  const auth = yield* AuthServiceTag;
  const repo = yield* UserRepositoryTag;

  yield* logger.info("Starting authentication...");
  const authResult = yield* auth.authenticate("alice@example.com", "secret");
  yield* logger.info(`Auth result: ${authResult}`);
  const user = yield* repo.findById("u-001");

  return {
    authResult,
    userName: user?.name ?? "unknown",
  };
});

// Provide layers and run
const layers = Layer.mergeAll(LoggerLive, UserRepositoryLive, AuthServiceLive);
const runnable = Effect.provide(program, layers);

const main = async () => {
  const result = await Effect.runPromise(runnable);
  console.log("Program result:", result);
};

main().catch(console.error);
