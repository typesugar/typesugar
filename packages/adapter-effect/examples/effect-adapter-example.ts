/**
 * Effect-TS Adapter Example
 *
 * Demonstrates cleaner syntax for Effect-TS operations using ttfx macros.
 * The macros compile to standard Effect API calls.
 */

import { Effect, pipe } from "effect";
import { gen$, map$, flatMap$, pipe$ } from "@ttfx/adapter-effect";

console.log("=== Effect-TS Adapter Example ===\n");

// --- gen$ — Effect.gen Shorthand ---

console.log("--- gen$ ---");

const program1 = gen$(function* () {
  const x = yield* Effect.succeed(10);
  const y = yield* Effect.succeed(20);
  return x + y;
});

// Equivalent to:
// Effect.gen(function* () { ... });

console.log("gen$ result:", Effect.runSync(program1));

// --- map$ — Effect.map Shorthand ---

console.log("\n--- map$ ---");

const doubled = map$(Effect.succeed(21), (x) => x * 2);

// Equivalent to:
// Effect.map(Effect.succeed(21), x => x * 2);

console.log("map$ result:", Effect.runSync(doubled));

// --- flatMap$ — Effect.flatMap Shorthand ---

console.log("\n--- flatMap$ ---");

const chained = flatMap$(Effect.succeed(5), (x) => Effect.succeed(x * 10));

// Equivalent to:
// Effect.flatMap(Effect.succeed(5), x => Effect.succeed(x * 10));

console.log("flatMap$ result:", Effect.runSync(chained));

// --- pipe$ — Effect.pipe Shorthand ---

console.log("\n--- pipe$ ---");

const piped = pipe$(
  Effect.succeed(5),
  Effect.map((x) => x * 2),
  Effect.flatMap((x) => Effect.succeed(x + 10)),
  Effect.map((x) => `Result: ${x}`),
);

// Equivalent to:
// Effect.pipe(
//   Effect.succeed(5),
//   Effect.map(x => x * 2),
//   ...
// );

console.log("pipe$ result:", Effect.runSync(piped));

// --- Labeled Block Syntax ---

console.log("\n--- Labeled Block Syntax ---");

// Using let: / yield: blocks for do-notation
// (This syntax is transformed at compile time)

/*
let: {
  user << getUserById(id)
  posts << getPostsForUser(user.id)
}
yield: {
  { user, posts }
}
*/

// Compiles to:
const getUserById = (id: number) => Effect.succeed({ id, name: `User${id}` });
const getPostsForUser = (userId: number) =>
  Effect.succeed([`Post1 by ${userId}`, `Post2 by ${userId}`]);

const programWithBlocks = Effect.flatMap(getUserById(1), (user) =>
  Effect.flatMap(getPostsForUser(user.id), (posts) =>
    Effect.succeed({ user, posts }),
  ),
);

console.log("Labeled block result:", Effect.runSync(programWithBlocks));

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

const fetchUserWithPosts = gen$(function* () {
  const user = yield* getUser(1);
  const posts = yield* getPosts(user.id);
  return {
    user,
    postCount: posts.length,
    titles: posts.map((p) => p.title),
  };
});

console.log("User with posts:", Effect.runSync(fetchUserWithPosts));
