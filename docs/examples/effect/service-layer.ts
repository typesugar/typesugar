//! Service & Layer
//! @service generates Context.Tag + namespace accessors from an interface

import { Effect, Context, Layer, pipe } from "effect";
import { service } from "@typesugar/effect";

// --- @service turns an interface into a Context.Tag + namespace accessors ---

@service
interface Logger {
  info(msg: string): Effect.Effect<void>;
}

@service
interface Greeter {
  greet(name: string): Effect.Effect<string>;
}
// 👀 Check JS Output — generates LoggerTag, GreeterTag, and accessor namespaces

// --- Provide implementations ---

const LoggerLive = Layer.succeed(LoggerTag, {
  info: (msg: string) => Effect.sync(() => console.log(`[INFO] ${msg}`)),
});

const GreeterLive = Layer.succeed(GreeterTag, {
  greet: (name: string) => Effect.succeed(`Hello, ${name}!`),
});

// --- Build a program using do-notation with service accessors ---
// 👀 Check JS Output — let:/yield: compiles to Effect.flatMap/map chains

const program =
let: {
  msg  << Greeter.greet("typesugar");
  _    << Logger.info(msg);
  msg2 << Greeter.greet("Effect");
  _2   << Logger.info(msg2);
}
yield: { `${msg} & ${msg2}` }

// Provide layers and run
const runnable = pipe(program, Effect.provide(Layer.mergeAll(LoggerLive, GreeterLive)));
console.log("Service & Layer example compiled successfully");

Effect.runPromise(runnable).then(
  (result) => console.log("Result:", result),
  (err) => console.error("Failed:", err),
);
