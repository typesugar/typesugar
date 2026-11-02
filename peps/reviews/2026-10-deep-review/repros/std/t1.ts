import { match } from "@typesugar/std";
type Shape = { kind: "circle"; radius: number } | { kind: "ring"; radius: number } | { kind: "sq"; side: number };
declare const s: Shape;
const a = match(s)
  .case({ kind: "circle", radius: r }).if(r > 10).then("big")
  .case({ kind: "ring", radius: r }).then("ring")
  .else("other");
declare const t: Shape | null;
const b = match(t)
  .case({ kind: "circle" }).then(1)
  .case({ kind: "ring" }).then(2)
  .case(x).if(x !== null).then(3)
  .else(4);
