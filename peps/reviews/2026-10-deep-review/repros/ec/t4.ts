import { Effect } from "effect";
import { compileGen } from "@typesugar/effect";

declare const getUser: (id: string) => Effect.Effect<{ name: string; age: number }>;
declare function audit(msg: string): void;

export const prog = (id: string) => compileGen(Effect.gen(function* () {
  const user = yield* getUser(id);
  const doubled = user.age * 2;
  audit("loaded " + user.name);
  for (const x of [1, 2]) { yield* Effect.log(String(x)); }
  return { name: user.name, doubled };
}));
