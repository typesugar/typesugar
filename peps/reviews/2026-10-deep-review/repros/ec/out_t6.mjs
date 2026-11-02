import { Schema } from "/Users/deapovey/src/personal/typesugar/packages/effect/node_modules/effect/dist/esm/index.js";
export const decUser = (input) => typeof input === "object" && input !== null ? {
    id: typeof input.id === "number" ? input.id : (() => { throw new Error(`Parse error at input.id: Expected number, got ${typeof input.id}`); })(),
    kind: Schema.decodeUnknownSync(Schema.Struct({
        id: Schema.Number,
        kind: Schema.Union(Schema.Literal("a"), Schema.Literal("b")),
    }))(input.kind)
} : (() => { throw new Error(`Parse error at input: Expected object, got ${typeof input}`); })();
export const decBig = (input) => typeof input === "object" && input !== null ? {
    n: typeof input.n === "bigint" ? input.n : (() => { throw new Error(`Parse error at input.n: Expected bigint, got ${typeof input.n}`); })()
} : (() => { throw new Error(`Parse error at input: Expected object, got ${typeof input}`); })();
export const decLit = (input) => input === "x" ? input : (() => { throw new Error(`Parse error at input: Expected literal "x", got ${typeof input}`); })();
export const decOpt = (input) => typeof input === "object" && input !== null ? {
    nick: "nick" in input ? typeof input.nick === "string" ? input.nick : (() => { throw new Error(`Parse error at input.nick: Expected string, got ${typeof input.nick}`); })() : undefined
} : (() => { throw new Error(`Parse error at input: Expected object, got ${typeof input}`); })();
