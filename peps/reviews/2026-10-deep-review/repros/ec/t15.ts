import { Effect } from "effect";
import { service } from "@typesugar/effect";

@service
export interface UserRepo {
  find(id?: string, ...rest: number[]): Effect.Effect<string>;
}
