/**
 * Effect-TS Adapter Example
 *
 * Demonstrates cleaner syntax for Effect-TS operations using typesugar macros.
 * The macros compile to standard Effect API calls.
 */

import { Effect, pipe } from "effect";
// Extension methods on Effect values: eff.map(f) -> EffectExt.map(eff, f).
import { EffectExt } from "@typesugar/effect";
// do-notation (let:/yield:, par:) over Effect, with its FlatMap/ParCombine
// instances in scope.
import "@typesugar/effect/syntax/do";

console.log("=== Effect-TS Adapter Example ===\n");

// --- Effect.gen — unchanged Effect-TS ---

console.log("--- Effect.gen ---");

const program1 = Effect.gen(function* () {
  const x = yield* Effect.succeed(10);
  const y = yield* Effect.succeed(20);
  return x + y;
});

console.log("gen result:", Effect.runSync(program1));

// --- Extension methods — eff.map(f), eff.flatMap(f) ---

console.log("\n--- extension methods ---");

const doubled = Effect.succeed(21).map((x) => x * 2);

// Compiles to:
// EffectExt.map(Effect.succeed(21), x => x * 2);

console.log("map result:", Effect.runSync(doubled));

const chained = Effect.succeed(5).flatMap((x) => Effect.succeed(x * 10));

// Compiles to:
// EffectExt.flatMap(Effect.succeed(5), x => Effect.succeed(x * 10));

console.log("flatMap result:", Effect.runSync(chained));

// --- pipe — unchanged Effect-TS ---

console.log("\n--- pipe ---");

const piped = pipe(
  Effect.succeed(5),
  Effect.map((x) => x * 2),
  Effect.flatMap((x) => Effect.succeed(x + 10)),
  Effect.map((x) => `Result: ${x}`),
);

console.log("pipe result:", Effect.runSync(piped));

// --- Labeled Block Syntax ---

console.log("\n--- Labeled Block Syntax ---");

const getUserById = (id: number) => Effect.succeed({ id, name: `User${id}` });
const getPostsForUser = (userId: number) =>
  Effect.succeed([`Post1 by ${userId}`, `Post2 by ${userId}`]);

// A comprehension is an expression: return it from an arrow function, with
// let: on the line after the `=>`.
const userWithPosts = (id: number) =>
  let: {
    user << getUserById(id);
    posts << getPostsForUser(user.id);
  }
  yield: ({ user, posts });

// Compiles to:
// Effect.flatMap(getUserById(id), (user) =>
//   Effect.map(getPostsForUser(user.id), (posts) => ({ user, posts })));

console.log("Labeled block result:", Effect.runSync(userWithPosts(1)));

// --- Real-World Example ---

console.log("\n--- Real-World Example ---");

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  id: number;
  title: string;
  authorId: number;
}

const getUser = (id: number): Effect.Effect<User> =>
  Effect.succeed({ id, name: "Alice", email: "alice@example.com" });

const getPosts = (userId: number): Effect.Effect<Post[]> =>
  Effect.succeed([
    { id: 1, title: "First Post", authorId: userId },
    { id: 2, title: "Second Post", authorId: userId },
  ]);

const fetchUserWithPosts = Effect.gen(function* () {
  const user = yield* getUser(1);
  const posts = yield* getPosts(user.id);
  return {
    user,
    postCount: posts.length,
    titles: posts.map((p) => p.title),
  };
});

console.log("User with posts:", Effect.runSync(fetchUserWithPosts));
