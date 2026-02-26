/**
 * @typesugar/named-args Showcase
 *
 * Self-documenting examples of named function arguments with compile-time
 * validation, builder pattern, and error handling.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()   - A and B are the same type
 *   typeAssert<Extends<A, B>>() - A is assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends } from "@typesugar/testing";

import {
  namedArgs,
  callWithNamedArgs,
  registerNamedArgs,
  getNamedArgsMeta,
  createBuilder,
  NamedArgsError,
  type ParamMeta,
  type NamedArgsFunctionMeta,
  type WithNamedArgs,
  type Builder,
  type RequiredKeys,
  type OptionalKeys,
} from "../src/index.js";

// All types are demonstrated below - NamedArgsFunctionMeta, WithNamedArgs, and Builder
// are used in type assertions to verify the API contracts.

// ============================================================================
// 1. NAMED ARGS BASICS - Object-Style Function Calling
// ============================================================================

function greet(name: string, greeting: string, exclaim: boolean): string {
  return `${greeting}, ${name}${exclaim ? "!" : "."}`;
}

const greetNamed = namedArgs(greet, [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "greeting", type: "string", required: true, position: 1 },
  { name: "exclaim", type: "boolean", required: true, position: 2 },
]);

// Positional calling still works
assert(greetNamed("Alice", "Hello", true) === "Hello, Alice!", "positional calling preserved");

// Named calling via .namedCall()
const result = greetNamed.namedCall({
  name: "Bob",
  greeting: "Hi",
  exclaim: false,
});
assert(result === "Hi, Bob.", "named calling via .namedCall()");

// Order doesn't matter with named args
const reordered = greetNamed.namedCall({
  exclaim: true,
  name: "Carol",
  greeting: "Hey",
});
assert(reordered === "Hey, Carol!", "parameter order doesn't matter");

// ============================================================================
// 2. OPTIONAL PARAMETERS WITH DEFAULTS
// ============================================================================

function createUser(name: string, role: string, active: boolean): { name: string; role: string; active: boolean } {
  return { name, role, active };
}

const createUserNamed = namedArgs(createUser, [
  { name: "name", type: "string", required: true, position: 0 },
  { name: "role", type: "string", required: false, defaultValue: "user", position: 1 },
  { name: "active", type: "boolean", required: false, defaultValue: true, position: 2 },
]);

// Only required params needed
const user1 = createUserNamed.namedCall({ name: "Alice" });
assert(user1.name === "Alice", "required param provided");
assert(user1.role === "user", "optional param gets default");
assert(user1.active === true, "boolean default applied");

// Override defaults selectively
const user2 = createUserNamed.namedCall({ name: "Bob", role: "admin" });
assert(user2.role === "admin", "overridden optional param");
assert(user2.active === true, "non-overridden default preserved");

// ============================================================================
// 3. ERROR HANDLING - Missing Required Parameters
// ============================================================================

let caughtError: NamedArgsError | null = null;

try {
  createUserNamed.namedCall({} as any);
} catch (e) {
  caughtError = e as NamedArgsError;
}

assert(caughtError !== null, "missing required param throws");
assert(caughtError!.reason === "missing_required", "error reason is missing_required");
assert(caughtError!.paramName === "name", "error identifies the missing param");
assert(caughtError!.functionName === "createUser", "error includes function name");
assert(caughtError!.name === "NamedArgsError", "error is NamedArgsError");
typeAssert<Extends<typeof caughtError, NamedArgsError | null>>();

// ============================================================================
// 4. ERROR HANDLING - Unknown Parameters
// ============================================================================

let unknownError: NamedArgsError | null = null;

try {
  createUserNamed.namedCall({ name: "Alice", typo: "oops" } as any);
} catch (e) {
  unknownError = e as NamedArgsError;
}

assert(unknownError !== null, "unknown param throws");
assert(unknownError!.reason === "unknown_param", "error reason is unknown_param");
assert(unknownError!.paramName === "typo", "error identifies the unknown param");

// ============================================================================
// 5. CALL WITH NAMED ARGS - Low-Level API
// ============================================================================

// callWithNamedArgs works without wrapping the function
const params: ParamMeta[] = [
  { name: "a", type: "number", required: true, position: 0 },
  { name: "b", type: "number", required: true, position: 1 },
];

function add(a: number, b: number): number {
  return a + b;
}

const sum = callWithNamedArgs(add, params, { a: 10, b: 20 });
assert(sum === 30, "callWithNamedArgs resolves positional order");

// Reversed order still works
const sum2 = callWithNamedArgs(add, params, { b: 5, a: 3 });
assert(sum2 === 8, "callWithNamedArgs handles reversed order");

// ============================================================================
// 6. METADATA REGISTRY
// ============================================================================

// namedArgs auto-registers metadata
const meta = getNamedArgsMeta("greet");
assert(meta !== undefined, "metadata registered for greet");
assert(meta!.functionName === "greet", "meta has function name");
assert(meta!.params.length === 3, "meta has 3 params");
assert(meta!.requiredParams.length === 3, "all params are required");
assert(meta!.optionalParams.length === 0, "no optional params");

const userMeta = getNamedArgsMeta("createUser");
assert(userMeta !== undefined, "metadata registered for createUser");
assert(userMeta!.requiredParams.length === 1, "1 required param");
assert(userMeta!.optionalParams.length === 2, "2 optional params");
assert(userMeta!.requiredParams[0] === "name", "required param is 'name'");

// Manual registration
registerNamedArgs({
  functionName: "manualFn",
  params: [{ name: "x", type: "number", required: true, position: 0 }],
  requiredParams: ["x"],
  optionalParams: [],
});
assert(getNamedArgsMeta("manualFn") !== undefined, "manual registration works");

// Unknown function returns undefined
assert(getNamedArgsMeta("nonexistent") === undefined, "unknown function returns undefined");

// ============================================================================
// 7. BUILDER PATTERN - Incremental Parameter Accumulation
// ============================================================================

function sendEmail(to: string, subject: string, body: string, cc?: string): string {
  return `To: ${to}\nSubject: ${subject}\nBody: ${body}${cc ? `\nCC: ${cc}` : ""}`;
}

const emailParams: ParamMeta[] = [
  { name: "to", type: "string", required: true, position: 0 },
  { name: "subject", type: "string", required: true, position: 1 },
  { name: "body", type: "string", required: true, position: 2 },
  { name: "cc", type: "string", required: false, position: 3 },
];

const builder = createBuilder(sendEmail, emailParams);

// Builders are immutable — each .set() returns a new builder
const b1 = builder.set("to", "alice@example.com");
const b2 = b1.set("subject", "Hello");
const b3 = b2.set("body", "How are you?");

// Original builder is unchanged
assert(Object.keys(builder.values()).length === 0, "original builder unchanged");
assert(Object.keys(b1.values()).length === 1, "b1 has 1 value");
assert(Object.keys(b2.values()).length === 2, "b2 has 2 values");
assert(Object.keys(b3.values()).length === 3, "b3 has 3 values");

// Build when all required params are set
const email = b3.build();
assert(email.includes("To: alice@example.com"), "email has recipient");
assert(email.includes("Subject: Hello"), "email has subject");
assert(email.includes("Body: How are you?"), "email has body");
assert(!email.includes("CC:"), "no CC when not set");

// Add optional param
const emailWithCc = b3.set("cc", "bob@example.com").build();
assert(emailWithCc.includes("CC: bob@example.com"), "CC included when set");

// ============================================================================
// 8. BUILDER ERROR HANDLING
// ============================================================================

// Building without all required params throws
let buildError: NamedArgsError | null = null;
try {
  builder.set("to", "alice@example.com").build();
} catch (e) {
  buildError = e as NamedArgsError;
}
assert(buildError !== null, "build without required params throws");
assert(buildError!.reason === "missing_required", "build error is missing_required");

// Setting unknown param throws
let builderUnknownError: NamedArgsError | null = null;
try {
  builder.set("bcc", "charlie@example.com");
} catch (e) {
  builderUnknownError = e as NamedArgsError;
}
assert(builderUnknownError !== null, "builder rejects unknown params");
assert(builderUnknownError!.reason === "unknown_param", "builder unknown_param error");

// ============================================================================
// 9. TYPE UTILITIES - RequiredKeys, OptionalKeys, and WithNamedArgs
// ============================================================================

interface UserConfig {
  name: string;
  age: number;
  nickname: string | undefined;
  bio: string | undefined;
}

typeAssert<Equal<RequiredKeys<UserConfig>, "name" | "age">>();
typeAssert<Equal<OptionalKeys<UserConfig>, "nickname" | "bio">>();

// WithNamedArgs type extends the original function with .namedCall()
type GreetFn = typeof greet;
typeAssert<Extends<typeof greetNamed, WithNamedArgs<GreetFn>>>();
typeAssert<Extends<typeof greetNamed, (...args: any[]) => any>>();

// NamedArgsFunctionMeta describes the metadata structure
const metaForGreet = getNamedArgsMeta("greet");
typeAssert<Extends<NonNullable<typeof metaForGreet>, NamedArgsFunctionMeta>>();

// Builder type describes the builder interface
type EmailBuilder = Builder<typeof sendEmail>;
const typedBuilder: EmailBuilder = createBuilder(sendEmail, emailParams);
assert(typeof typedBuilder.set === "function", "Builder has .set() method");
assert(typeof typedBuilder.build === "function", "Builder has .build() method");
assert(typeof typedBuilder.values === "function", "Builder has .values() method");

// ============================================================================
// 10. REAL-WORLD EXAMPLE - API Client Configuration
// ============================================================================

function fetchData(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeout: number,
  retries: number,
): { url: string; method: string; timeout: number } {
  return { url, method, timeout };
}

const fetchNamed = namedArgs(fetchData, [
  { name: "url", type: "string", required: true, position: 0 },
  { name: "method", type: "string", required: false, defaultValue: "GET", position: 1 },
  { name: "headers", type: "object", required: false, defaultValue: {}, position: 2 },
  { name: "body", type: "string", required: false, defaultValue: undefined, position: 3 },
  { name: "timeout", type: "number", required: false, defaultValue: 5000, position: 4 },
  { name: "retries", type: "number", required: false, defaultValue: 3, position: 5 },
]);

// Only specify what you need — everything else gets sensible defaults
const response = fetchNamed.namedCall({ url: "/api/users" });
assert(response.url === "/api/users", "url set");
assert(response.method === "GET", "method defaults to GET");
assert(response.timeout === 5000, "timeout defaults to 5000");

// Override specific defaults
const postResponse = fetchNamed.namedCall({
  url: "/api/users",
  method: "POST",
  body: '{"name": "Alice"}',
  timeout: 10000,
});
assert(postResponse.method === "POST", "method overridden");
assert(postResponse.timeout === 10000, "timeout overridden");

// Builder pattern for complex requests
const fetchBuilder = createBuilder(fetchData, [
  { name: "url", type: "string", required: true, position: 0 },
  { name: "method", type: "string", required: false, defaultValue: "GET", position: 1 },
  { name: "headers", type: "object", required: false, defaultValue: {}, position: 2 },
  { name: "body", type: "string", required: false, defaultValue: undefined, position: 3 },
  { name: "timeout", type: "number", required: false, defaultValue: 5000, position: 4 },
  { name: "retries", type: "number", required: false, defaultValue: 3, position: 5 },
]);

const builderResult = fetchBuilder
  .set("url", "/api/posts")
  .set("method", "PUT")
  .set("timeout", 15000)
  .build();

assert(builderResult.url === "/api/posts", "builder url");
assert(builderResult.method === "PUT", "builder method");
assert(builderResult.timeout === 15000, "builder timeout");
