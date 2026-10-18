import { Schema } from "effect";
import { specializeSchema } from "@typesugar/effect";
export const decUser = specializeSchema(Schema.Struct({
  id: Schema.Number,
  kind: Schema.Union(Schema.Literal("a"), Schema.Literal("b")),
}));
export const decBig = specializeSchema(Schema.Struct({ n: Schema.BigInt }));
export const decLit = specializeSchema(Schema.Literal("x", "y"));
export const decOpt = specializeSchema(Schema.Struct({ nick: Schema.optional(Schema.String) }));
