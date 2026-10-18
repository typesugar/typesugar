const { Effect, Layer, Context } = require("/Users/deapovey/src/personal/typesugar/packages/effect/node_modules/effect");
class C extends Context.Tag("C")() {}
class B extends Context.Tag("B")() {}
class A extends Context.Tag("A")() {}
const CLive = Layer.succeed(C, { c: 1 });
const BLive = Layer.effect(B, Effect.map(C, (c) => ({ b: c.c + 1 })));
const ALive = Layer.effect(A, Effect.map(B, (b) => ({ a: b.b + 1 })));
// What generateLayerComposition emits for sorted [C, B, A], A requires [B], B requires [C]:
const composed = Layer.merge(CLive, BLive.pipe(Layer.provide(CLive)), ALive.pipe(Layer.provide(BLive)));
const prog = Effect.map(A, (a) => a.a);
try { console.log("result", Effect.runSync(Effect.provide(prog, composed))); } catch (e) { console.log("FAIL:", String(e).split("\n")[0]); }
// mergeAll variant isolates the transitive-wiring question
const composed2 = Layer.mergeAll(CLive, BLive.pipe(Layer.provide(CLive)), ALive.pipe(Layer.provide(BLive)));
try { console.log("mergeAll result", Effect.runSync(Effect.provide(prog, composed2))); } catch (e) { console.log("mergeAll FAIL:", String(e).split("\n")[0]); }
console.log("Layer.merge.length", Layer.merge.length);
