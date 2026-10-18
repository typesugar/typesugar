import { match } from "@typesugar/std";
type Shape = { kind: "circle"; radius: number } | { kind: "ring"; radius: number } | { kind: "sq"; side: number };
const s = { kind: "circle", radius: 5 } as Shape;
const a = match(s)
  .case({ kind: "circle", radius: r }).if(r > 10).then("big")
  .case({ kind: "sq" }).then("sq")
  .else("other");
console.log("a =", a);
const b = match(s).case({ kind: "circle", radius: r }).then(r).case({ kind: "ring", radius: r }).then(-r).else(0);
