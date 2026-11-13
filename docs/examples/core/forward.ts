//! forward<S>() — Interceptors Without a Proxy
//! A typed forwarding object for an interface, with around-advice inlined per method

import { forward } from "typesugar";

interface Counter {
  add(n: number): number;
  reset(): void;
  readonly label: string;
}

class MemCounter implements Counter {
  readonly label = "mem";
  #total = 0;
  add(n: number): number {
    this.#total += n;
    return this.#total;
  }
  reset(): void {
    this.#total = 0;
  }
}

const log: string[] = [];

// The advice runs around each listed method. `method`, `args` and `next()` are
// typed per member, and `only` must name real methods: rename `add` and this
// stops compiling.
const counter = forward<Counter>(new MemCounter(), {
  around: (method, args, next) => {
    log.push(`${method}(${args.join(", ")})`);
    return next();
  },
  only: ["add"],
});

counter.add(2);
counter.add(3);
counter.reset();
console.log("total:", counter.add(1), "label:", counter.label);
console.log("calls seen by the advice:", log);

// 👀 Check JS Output: no Proxy and no reflection. `add` has the advice inlined,
//    with "add" in place of `method` and `inner.add(n)` in place of `next()`;
//    `reset` and `label` forward directly. Calls the object makes on itself
//    (`this.add()` inside MemCounter) would bypass the advice.
