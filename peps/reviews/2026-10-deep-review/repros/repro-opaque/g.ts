import { Some, type Option } from "@typesugar/fp";
const o: Option<number> = Some(1);
export const m = o.map((x: number) => x + 1);
