/**
 * IO interpreter regression tests (deep-review findings #1, #2, #7, #13, #18, #22).
 */
import { describe, it, expect } from "vitest";
import { IO, runIO, runIOSync } from "./io.js";
import { isLeft, isRight } from "../data/either.js";
import { isSome, isNone } from "../data/option.js";

describe("IO interpreter: throws after an async step (#1)", () => {
  it("a throw in a continuation after an async step rejects runIO", async () => {
    const io = IO.flatMap(IO.sleep(1), () => {
      throw new Error("after-async");
    });
    await expect(runIO(io)).rejects.toThrow("after-async");
  });

  it("a throw in a continuation after fromPromise rejects runIO", async () => {
    const io = IO.flatMap(
      IO.fromPromise(() => Promise.resolve(1)),
      () => {
        throw new Error("after-promise");
      }
    );
    await expect(runIO(io)).rejects.toThrow("after-promise");
  });

  it("a throw after an async step is catchable by an enclosing handleError", async () => {
    const io = IO.handleError(
      IO.flatMap(IO.sleep(1), (): IO<number> => {
        throw new Error("x");
      }),
      () => IO.pure(7)
    );
    expect(await runIO(io)).toBe(7);
  });

  it("an async callback invoked twice only resumes the fiber once", async () => {
    let runs = 0;
    const io = IO.flatMap(
      IO.async<number>((cb) => {
        cb({ right: 1 } as never);
        cb({ right: 2 } as never);
      }),
      (n) =>
        IO.delay(() => {
          runs++;
          return n;
        })
    );
    expect(await runIO(io)).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(runs).toBe(1);
  });
});

describe("IO interpreter: continuation errors are not caught by an inner handler (#2)", () => {
  it("sync: handleError's handler does not run for a throw in a later continuation", () => {
    let hcalls = 0;
    const io = IO.flatMap(
      IO.handleError(IO.pure(1), () => {
        hcalls++;
        return IO.pure(99);
      }),
      (x): IO<number> => {
        if (x === 1) throw new Error("cont");
        return IO.pure(x);
      }
    );
    expect(() => runIOSync(io)).toThrow("cont");
    expect(hcalls).toBe(0);
  });

  it("async: handleError's handler does not run for a throw in a later continuation", async () => {
    let hcalls = 0;
    const io = IO.flatMap(
      IO.handleError(IO.sleep(1), () => {
        hcalls++;
        return IO.unit;
      }),
      (): IO<void> => {
        throw new Error("cont");
      }
    );
    await expect(runIO(io)).rejects.toThrow("cont");
    expect(hcalls).toBe(0);
  });

  it("sync and async: a throw in the continuation after attempt fails the IO", async () => {
    const log: unknown[] = [];
    const io = IO.flatMap(
      IO.flatMap(IO.attempt(IO.pure(1)), (): IO<number> => {
        throw new Error("boom");
      }),
      (y) => IO.delay(() => log.push(y))
    );
    expect(() => runIOSync(io)).toThrow("boom");
    await expect(runIO(io)).rejects.toThrow("boom");
    expect(log).toEqual([]);
  });

  it("guarantee: finalizer runs once and a continuation error propagates", () => {
    let fin = 0;
    const io = IO.flatMap(
      IO.guarantee(
        IO.pure(1),
        IO.delay(() => {
          fin++;
        })
      ),
      (): IO<number> => {
        throw new Error("later");
      }
    );
    expect(() => runIOSync(io)).toThrow("later");
    expect(fin).toBe(1);
  });

  it("a handler that throws propagates its own error (async)", async () => {
    let calls = 0;
    const io = IO.handleError(IO.raiseError<string>(new Error("orig")), (e) => {
      calls++;
      throw new Error("handler-" + e.message);
    });
    await expect(runIO(io)).rejects.toThrow("handler-orig");
    expect(calls).toBe(1);
  });
});

describe("IO race/timeout cancel the loser (#7)", () => {
  it("timeout of a fast IO cancels the sleep timer", async () => {
    const timers = () =>
      (process as unknown as { getActiveResourcesInfo(): string[] })
        .getActiveResourcesInfo()
        .filter((x) => x === "Timeout").length;
    const before = timers();
    // An async winner, so the 60s sleep really starts before the race settles.
    const r = await runIO(
      IO.timeout(
        IO.fromPromise(() => Promise.resolve(1)),
        60_000
      )
    );
    expect(isSome(r)).toBe(true);
    // The sleep's clearTimeout was called: no extra live timer is held.
    expect(timers()).toBe(before);
  });

  it("timeout of a slow IO returns None and does not run the loser's continuation", async () => {
    let continued = false;
    const slow = IO.flatMap(IO.sleep(200), () =>
      IO.delay(() => {
        continued = true;
        return 1;
      })
    );
    const r = await runIO(IO.timeout(slow, 5));
    expect(isNone(r)).toBe(true);
    await new Promise((res) => setTimeout(res, 250));
    expect(continued).toBe(false);
  });

  it("a cancelled loser still runs its guarantee finalizer", async () => {
    let fin = 0;
    const loser = IO.guarantee(
      IO.sleep(200),
      IO.delay(() => {
        fin++;
      })
    );
    const r = await runIO(IO.race(IO.sleep(1), loser));
    expect(isLeft(r)).toBe(true);
    await new Promise((res) => setTimeout(res, 10));
    expect(fin).toBe(1);
  });

  it("a synchronous winner means the loser is never started", async () => {
    let started = false;
    const r = await runIO(
      IO.race(
        IO.pure(1),
        IO.delay(() => (started = true))
      )
    );
    expect(isLeft(r)).toBe(true);
    expect(started).toBe(false);
  });

  it("race returns the winner from the right side", async () => {
    const r = await runIO(IO.race(IO.sleep(100), IO.pure("b")));
    expect(isRight(r)).toBe(true);
  });
});

describe("IO stack safety for handler frames (#13)", () => {
  const loop = (k: number): IO<void> =>
    k === 0
      ? IO.unit
      : IO.guarantee(
          IO.flatMap(IO.unit, () => loop(k - 1)),
          IO.unit
        );

  it("20k nested guarantee runs synchronously", () => {
    expect(() => runIOSync(loop(20000))).not.toThrow();
  });

  it("20k nested guarantee runs asynchronously", async () => {
    await expect(runIO(loop(20000))).resolves.toBeUndefined();
  });

  it("20k nested handleError runs", async () => {
    let io: IO<number> = IO.pure(0);
    for (let i = 0; i < 20000; i++)
      io = IO.handleError(
        IO.map(io, (n) => n + 1),
        () => IO.pure(-1)
      );
    expect(runIOSync(io)).toBe(20000);
    expect(await runIO(io)).toBe(20000);
  });
});

describe("IO async boundary overhead (#18)", () => {
  it("200 fromPromise steps complete well under one setTimeout tick each", async () => {
    const t = Date.now();
    const xs = Array.from({ length: 2000 }, (_, i) => i);
    const out = await runIO(IO.traverse(xs, (i) => IO.fromPromise(() => Promise.resolve(i))));
    expect(out.length).toBe(2000);
    // setTimeout(0) per step costs >= ~1ms each => >= 2s. Microtask resumption is far faster.
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("attempt does not introduce an async boundary", async () => {
    const t = Date.now();
    const xs = Array.from({ length: 2000 }, (_, i) => i);
    await runIO(IO.traverse(xs, (i) => IO.attempt(IO.pure(i))));
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("IO.traverse is linear (#22)", () => {
  it("traverses 50k elements quickly and in order", () => {
    const xs = Array.from({ length: 50000 }, (_, i) => i);
    const t = Date.now();
    const out = runIOSync(IO.traverse(xs, (i) => IO.pure(i * 2)));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(out.length).toBe(50000);
    expect(out[49999]).toBe(99998);
  });

  it("re-running a traverse IO yields a fresh array", () => {
    const io = IO.traverse([1, 2], (i) => IO.pure(i));
    const a = runIOSync(io);
    const b = runIOSync(io);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]);
    expect(a).not.toBe(b);
  });

  it("replicateA is linear", () => {
    expect(runIOSync(IO.replicateA(20000, IO.pure(1))).length).toBe(20000);
  });
});
