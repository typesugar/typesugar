/**
 * Regression tests for deep-review findings #21 (For.from), #23 (memoize),
 * #24 (IOApp exit codes).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as syntax from "./index.js";
import { memoize } from "./pipe.js";
import { IO } from "../io/io.js";
import { IOApp, AppError, fail, ioApp } from "../io/io-app.js";

describe("For.from placeholder is not public (#21)", () => {
  it("syntax barrel does not export For", () => {
    expect("For" in syntax).toBe(false);
  });
});

describe("memoize keys (#23)", () => {
  it("distinguishes NaN / null / undefined / -0 / '1' vs 1", () => {
    let calls = 0;
    const f = memoize((x: unknown) => {
      calls++;
      return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : String(x);
    });
    expect(f(NaN)).toBe("NaN");
    expect(f(null)).toBe("null");
    expect(f(undefined)).toBe("undefined");
    expect(f(Infinity)).toBe("Infinity");
    expect(f(0)).toBe("0");
    expect(f(-0)).toBe("-0");
    expect(f(1)).toBe("1");
    expect(f("1")).toBe("1");
    expect(calls).toBe(8);
    f(NaN);
    f({ a: 1 });
    f({ a: 1 });
    expect(calls).toBe(9);
  });

  it("maxSize bounds the cache", () => {
    let calls = 0;
    const f = memoize(
      (x: number) => {
        calls++;
        return x;
      },
      { maxSize: 2 }
    );
    f(1);
    f(2);
    f(3); // evicts 1
    f(1);
    expect(calls).toBe(4);
    f(3);
    expect(calls).toBe(4);
  });
});

describe("IOApp honours AppError.exitCode (#24)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("main exits with the AppError's code", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    class App extends IOApp {
      run() {
        return fail("nope", 3);
      }
    }
    await new App().main([]);
    expect(exit).toHaveBeenCalledWith(3);
  });

  it("main exits 1 for other errors", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    class App extends IOApp {
      run() {
        return IO.raiseError<number>(new Error("x"));
      }
    }
    await new App().main([]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("ioApp builder's error path uses the AppError's code", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    ioApp().run(IO.raiseError(new AppError("bad", 7)));
    await new Promise((r) => setTimeout(r, 10));
    expect(exit).toHaveBeenCalledWith(7);
  });
});
