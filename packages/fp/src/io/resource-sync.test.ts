/**
 * Resource / ResourcePool / Deferred / MVar / Console regression tests
 * (deep-review findings #3, #5, #6, #11, #12, #25).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { IO, runIO, runIOSync } from "./io.js";
import { Resource, ResourcePool } from "./resource.js";
import { Deferred, TryableDeferred, MVar } from "./deferred.js";
import { Console } from "./console.js";
import { isSome } from "../data/option.js";

function tracked(name: string, log: string[]) {
  return Resource.make(
    IO.delay(() => {
      log.push(`acquire ${name}`);
      return name;
    }),
    (a) =>
      IO.delay(() => {
        log.push(`release ${a}`);
      })
  );
}

describe("Resource combinators (#3)", () => {
  it("map does not recurse forever", () => {
    expect(
      runIOSync(
        Resource.pure(1)
          .map((x) => x + 1)
          .use((x) => IO.pure(x))
      )
    ).toBe(2);
  });

  it("map acquires once and releases once", () => {
    const log: string[] = [];
    const r = tracked("a", log).map((s) => s.toUpperCase());
    expect(runIOSync(r.use((s) => IO.pure(s)))).toBe("A");
    expect(log).toEqual(["acquire a", "release a"]);
  });

  it("flatMap releases inner then outer, without re-running f", () => {
    const log: string[] = [];
    let fCalls = 0;
    const r = tracked("outer", log).flatMap((o) => {
      fCalls++;
      return tracked(`inner-of-${o}`, log);
    });
    expect(runIOSync(r.use((s) => IO.pure(s)))).toBe("inner-of-outer");
    expect(fCalls).toBe(1);
    expect(log).toEqual([
      "acquire outer",
      "acquire inner-of-outer",
      "release inner-of-outer",
      "release outer",
    ]);
  });

  it("flatMap releases the outer resource if the inner acquire fails", () => {
    const log: string[] = [];
    const r = tracked("outer", log).flatMap(() =>
      Resource.make(IO.raiseError<string>(new Error("inner failed")), () => IO.unit)
    );
    expect(() => runIOSync(r.use((s) => IO.pure(s)))).toThrow("inner failed");
    expect(log).toEqual(["acquire outer", "release outer"]);
  });

  it("product / traverse release in reverse order", () => {
    const log: string[] = [];
    const r = Resource.traverse(["x", "y", "z"], (n) => tracked(n, log));
    expect(runIOSync(r.use((xs) => IO.pure(xs)))).toEqual(["x", "y", "z"]);
    expect(log).toEqual([
      "acquire x",
      "acquire y",
      "acquire z",
      "release z",
      "release y",
      "release x",
    ]);
  });
});

describe("ResourcePool (#12)", () => {
  it("never creates more than maxSize resources while all are borrowed", async () => {
    let created = 0;
    const pool = new ResourcePool(
      IO.delay(() => ++created),
      () => IO.unit,
      2
    );
    const hold = (ms: number) => pool.borrow().use(() => IO.sleep(ms));
    await runIO(IO.parSequence([hold(20), hold(20), hold(20), hold(20)]));
    expect(created).toBe(2);
  });

  it("drain destroys each idle resource once and empties the pool", async () => {
    const destroyed: number[] = [];
    let created = 0;
    const pool = new ResourcePool(
      IO.delay(() => ++created),
      (a) => IO.delay(() => void destroyed.push(a)),
      2
    );
    await runIO(pool.borrow().use(() => IO.unit));
    await runIO(pool.drain());
    await runIO(pool.drain());
    expect(destroyed).toEqual([1]);
  });
});

describe("Deferred / MVar (#11, #25)", () => {
  it("Deferred.complete(null) wakes waiters and a second complete fails", async () => {
    const d = Deferred.unsafe<null>();
    const waiter = runIO(d.get());
    expect(runIOSync(d.complete(null))).toBe(true);
    expect(runIOSync(d.complete(null))).toBe(false);
    await expect(waiter).resolves.toBeNull();
    expect(runIOSync(d.isCompleted())).toBe(true);
  });

  it("a throwing waiter does not break the completer or other waiters", async () => {
    const d = Deferred.unsafe<number>();
    const bad = runIO(
      IO.flatMap(d.get(), (): IO<number> => {
        throw new Error("waiter boom");
      })
    );
    const good = runIO(d.get());
    await expect(runIO(d.complete(5))).resolves.toBe(true);
    await expect(bad).rejects.toThrow("waiter boom");
    await expect(good).resolves.toBe(5);
  });

  it("TryableDeferred holds a null success value", async () => {
    const d = runIOSync(TryableDeferred.make<null>());
    runIOSync(d.complete(null));
    await expect(runIO(d.get())).resolves.toBeNull();
  });

  it("MVar.read waiting on empty does not swallow a put", async () => {
    const mv = runIOSync(MVar.empty<number>());
    const r = runIO(mv.read());
    await runIO(mv.put(1));
    await expect(r).resolves.toBe(1);
    // The value is still there for a taker.
    await expect(runIO(mv.take())).resolves.toBe(1);
  });

  it("MVar: queued read and take are both served by one put", async () => {
    const mv = runIOSync(MVar.empty<number>());
    const r = runIO(mv.read());
    const t = runIO(mv.take());
    await runIO(mv.put(7));
    await expect(r).resolves.toBe(7);
    await expect(t).resolves.toBe(7);
    expect(runIOSync(mv.isEmpty())).toBe(true);
  });
});

describe("Console (#5, #6)", () => {
  it("readValidated retries on invalid input (Either is {left}/{right}, not _tag)", async () => {
    const inputs = ["abc", "42"];
    const orig = Console.prompt;
    const origErr = Console.putErrLn;
    const errs: string[] = [];
    Console.prompt = () => IO.delay(() => inputs.shift()!);
    Console.putErrLn = (m: string) => IO.delay(() => void errs.push(m));
    try {
      expect(await runIO(Console.readRequiredNumber("n? "))).toBe(42);
      expect(errs).toEqual(["Invalid input: Please enter a valid number"]);
    } finally {
      Console.prompt = orig;
      Console.putErrLn = origErr;
    }
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/io");

  it.runIf(existsSync(path.join(dist, "console.js")))(
    "readLine works from the built ESM and CJS dist (no bare require)",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "fp-console-"));
      const esmFile = path.join(dir, "esm.mjs");
      writeFileSync(
        esmFile,
        `const { Console } = await import(${JSON.stringify(path.join(dist, "console.js"))});
         const { runIO } = await import(${JSON.stringify(path.join(dist, "io.js"))});
         const s = await runIO(Console.readLine()); process.stdout.write("[" + s + "]");`
      );
      const cjsFile = path.join(dir, "cjs.cjs");
      writeFileSync(
        cjsFile,
        `const { Console } = require(${JSON.stringify(path.join(dist, "console.cjs"))});
         const { runIO } = require(${JSON.stringify(path.join(dist, "io.cjs"))});
         runIO(Console.readLine()).then((s) => process.stdout.write("[" + s + "]"));`
      );
      try {
        const esm = execFileSync(process.execPath, [esmFile], {
          input: "hello\n",
          encoding: "utf8",
        });
        expect(esm).toContain("[hello]");
        const cjs = execFileSync(process.execPath, [cjsFile], {
          input: "world\n",
          encoding: "utf8",
        });
        expect(cjs).toContain("[world]");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});

// keep isSome referenced for Option-shape sanity in this file
void isSome;
