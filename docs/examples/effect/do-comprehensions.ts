//! Do-Comprehensions (Effect)
//! let:/yield: desugars to Effect.flatMap/map chains — zero generator overhead

import { Effect } from "effect";

// ============================================================================
// Sequential: let:/yield: — desugars to Effect.flatMap chains
// ============================================================================

// Fetch user profile and their posts sequentially
let: {
  user << Effect.succeed({ id: "u1", name: "Alice" });
  _    << Effect.log(`Found user: ${user.name}`);
  posts << Effect.succeed([
    { id: "p1", title: "Hello World", authorId: "u1" },
    { id: "p2", title: "Effect is great", authorId: "u1" },
  ]);
}
yield: { ({ user, posts }) }
// 👀 Check JS Output — compiles to:
//   Effect.flatMap(Effect.succeed({...}), (user) =>
//     Effect.flatMap(Effect.log(...), (_) =>
//       Effect.map(Effect.succeed([...]), (posts) => ({ user, posts }))
//     )
//   )

// Pure map steps — intermediate computation without a bind
let: {
  x << Effect.succeed(10);
  doubled = x * 2;
  y << Effect.succeed(5);
}
yield: { doubled + y }
// 👀 doubled is inlined as an IIFE — no extra flatMap

// ============================================================================
// Expression-level: const x = let: { ... } yield: { ... }
// ============================================================================

// Do-comprehensions work as expressions too!
const config =
let: {
  host << Effect.succeed("localhost");
  port << Effect.succeed(3000);
}
yield: { `${host}:${port}` }
// 👀 Check JS Output — compiles to:
//   const config = Effect.flatMap(Effect.succeed("localhost"), host =>
//     Effect.map(Effect.succeed(3000), port => `${host}:${port}`)
//   );

// Run the last one to show it works
const result = await Effect.runPromise(config);
console.log("Config:", result);

// 👀 Check JS Output:
//   - let:/yield: → Effect.flatMap/map chains (sequential)
//   - Pure = steps inline without extra binds
//   - Works as expressions with const x = let: { ... }
//   - Also works with Array, Promise, Option, or any registered FlatMap type
