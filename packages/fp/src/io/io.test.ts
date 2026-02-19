/**
 * IO Monad Tests
 */
import { describe, it, expect, vi } from "vitest";
import { IO, runIO, runIOSync, IODo, io, IOFluent } from "./io.js";
import { Right, Left } from "../data/either.js";
import { Some, None } from "../data/option.js";

describe("IO", () => {
  // ============================================================================
  // Constructors
  // ============================================================================

  describe("constructors", () => {
    it("pure should lift a value", async () => {
      const result = await runIO(IO.pure(42));
      expect(result).toBe(42);
    });

    it("of should be an alias for pure", async () => {
      const result = await runIO(IO.of("hello"));
      expect(result).toBe("hello");
    });

    it("unit should return undefined", async () => {
      const result = await runIO(IO.unit);
      expect(result).toBe(undefined);
    });

    it("delay should defer computation", async () => {
      let called = false;
      const io = IO.delay(() => {
        called = true;
        return 42;
      });

      expect(called).toBe(false);
      const result = await runIO(io);
      expect(called).toBe(true);
      expect(result).toBe(42);
    });

    it("suspend should defer IO creation", async () => {
      let called = false;
      const io = IO.suspend(() => {
        called = true;
        return IO.pure(42);
      });

      expect(called).toBe(false);
      const result = await runIO(io);
      expect(called).toBe(true);
      expect(result).toBe(42);
    });

    it("fromPromise should lift a Promise-returning function", async () => {
      const io = IO.fromPromise(() => Promise.resolve(42));
      const result = await runIO(io);
      expect(result).toBe(42);
    });

    it("raiseError should create a failing IO", async () => {
      const io = IO.raiseError<number>(new Error("test error"));
      await expect(runIO(io)).rejects.toThrow("test error");
    });

    it("async should create an IO from a callback", async () => {
      const io = IO.async<number>((cb) => {
        setTimeout(() => cb(Right(42)), 10);
      });
      const result = await runIO(io);
      expect(result).toBe(42);
    });

    it("sleep should delay execution", async () => {
      const start = Date.now();
      await runIO(IO.sleep(50));
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
    });
  });

  // ============================================================================
  // Functor Laws
  // ============================================================================

  describe("functor", () => {
    it("map should transform the value", async () => {
      const result = await runIO(IO.map(IO.pure(21), (x) => x * 2));
      expect(result).toBe(42);
    });

    it("should satisfy identity law: map(fa, x => x) === fa", async () => {
      const fa = IO.pure(42);
      const mapped = IO.map(fa, (x) => x);
      expect(await runIO(mapped)).toBe(await runIO(fa));
    });

    it("should satisfy composition law: map(map(fa, f), g) === map(fa, x => g(f(x)))", async () => {
      const fa = IO.pure(5);
      const f = (x: number) => x * 2;
      const g = (x: number) => x + 1;

      const left = IO.map(IO.map(fa, f), g);
      const right = IO.map(fa, (x) => g(f(x)));

      expect(await runIO(left)).toBe(await runIO(right));
    });

    it("as should replace value with a constant", async () => {
      const result = await runIO(IO.as(IO.pure(42), "hello"));
      expect(result).toBe("hello");
    });

    it("void_ should discard the value", async () => {
      const result = await runIO(IO.void_(IO.pure(42)));
      expect(result).toBe(undefined);
    });
  });

  // ============================================================================
  // Monad Laws
  // ============================================================================

  describe("monad", () => {
    it("flatMap should sequence computations", async () => {
      const result = await runIO(
        IO.flatMap(IO.pure(21), (x) => IO.pure(x * 2)),
      );
      expect(result).toBe(42);
    });

    it("should satisfy left identity: flatMap(pure(a), f) === f(a)", async () => {
      const a = 5;
      const f = (x: number) => IO.pure(x * 2);

      const left = IO.flatMap(IO.pure(a), f);
      const right = f(a);

      expect(await runIO(left)).toBe(await runIO(right));
    });

    it("should satisfy right identity: flatMap(fa, pure) === fa", async () => {
      const fa = IO.pure(42);

      const left = IO.flatMap(fa, IO.pure);

      expect(await runIO(left)).toBe(await runIO(fa));
    });

    it("should satisfy associativity: flatMap(flatMap(fa, f), g) === flatMap(fa, a => flatMap(f(a), g))", async () => {
      const fa = IO.pure(5);
      const f = (x: number) => IO.pure(x * 2);
      const g = (x: number) => IO.pure(x + 1);

      const left = IO.flatMap(IO.flatMap(fa, f), g);
      const right = IO.flatMap(fa, (a) => IO.flatMap(f(a), g));

      expect(await runIO(left)).toBe(await runIO(right));
    });

    it("flatten should unwrap nested IO", async () => {
      const nested = IO.pure(IO.pure(42));
      const result = await runIO(IO.flatten(nested));
      expect(result).toBe(42);
    });
  });

  // ============================================================================
  // Applicative
  // ============================================================================

  describe("applicative", () => {
    it("ap should apply function in IO to value in IO", async () => {
      const ff = IO.pure((x: number) => x * 2);
      const fa = IO.pure(21);
      const result = await runIO(IO.ap(ff, fa));
      expect(result).toBe(42);
    });

    it("map2 should combine two IOs", async () => {
      const result = await runIO(
        IO.map2(IO.pure(20), IO.pure(22), (a, b) => a + b),
      );
      expect(result).toBe(42);
    });

    it("map3 should combine three IOs", async () => {
      const result = await runIO(
        IO.map3(IO.pure(10), IO.pure(20), IO.pure(12), (a, b, c) => a + b + c),
      );
      expect(result).toBe(42);
    });

    it("product should combine into tuple", async () => {
      const result = await runIO(IO.product(IO.pure(1), IO.pure("a")));
      expect(result).toEqual([1, "a"]);
    });

    it("productL should keep first value", async () => {
      const log: string[] = [];
      const result = await runIO(
        IO.productL(
          IO.delay(() => {
            log.push("first");
            return 42;
          }),
          IO.delay(() => {
            log.push("second");
            return "ignored";
          }),
        ),
      );
      expect(result).toBe(42);
      expect(log).toEqual(["first", "second"]);
    });

    it("productR should keep second value", async () => {
      const result = await runIO(IO.productR(IO.pure("ignored"), IO.pure(42)));
      expect(result).toBe(42);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe("error handling", () => {
    it("attempt should convert error to Left", async () => {
      const io = IO.attempt(IO.raiseError<number>(new Error("oops")));
      const result = await runIO(io);
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toBe("oops");
      }
    });

    it("attempt should convert success to Right", async () => {
      const io = IO.attempt(IO.pure(42));
      const result = await runIO(io);
      expect(result).toEqual(Right(42));
    });

    it("handleError should recover from errors", async () => {
      const io = IO.handleError(IO.raiseError<number>(new Error("oops")), () =>
        IO.pure(42),
      );
      const result = await runIO(io);
      expect(result).toBe(42);
    });

    it("handleErrorWith should recover with pure function", async () => {
      const io = IO.handleErrorWith(
        IO.raiseError<number>(new Error("oops")),
        () => 42,
      );
      const result = await runIO(io);
      expect(result).toBe(42);
    });

    it("redeem should handle both success and failure", async () => {
      const success = await runIO(
        IO.redeem(
          IO.pure(21),
          () => 0,
          (x) => x * 2,
        ),
      );
      expect(success).toBe(42);

      const failure = await runIO(
        IO.redeem(
          IO.raiseError<number>(new Error("oops")),
          () => -1,
          (x) => x * 2,
        ),
      );
      expect(failure).toBe(-1);
    });

    it("guarantee should always run finalizer", async () => {
      let finalizerRan = false;

      // Success case
      await runIO(
        IO.guarantee(
          IO.pure(42),
          IO.delay(() => {
            finalizerRan = true;
          }),
        ),
      );
      expect(finalizerRan).toBe(true);

      // Error case
      finalizerRan = false;
      try {
        await runIO(
          IO.guarantee(
            IO.raiseError(new Error("oops")),
            IO.delay(() => {
              finalizerRan = true;
            }),
          ),
        );
      } catch {}
      expect(finalizerRan).toBe(true);
    });

    it("onError should run handler on error only", async () => {
      let handlerRan = false;

      // Success case - handler should not run
      await runIO(
        IO.onError(IO.pure(42), (_e: Error) =>
          IO.delay(() => {
            handlerRan = true;
          }),
        ),
      );
      expect(handlerRan).toBe(false);

      // Error case - handler should run
      try {
        await runIO(
          IO.onError(IO.raiseError(new Error("oops")), (_e: Error) =>
            IO.delay(() => {
              handlerRan = true;
            }),
          ),
        );
      } catch {}
      expect(handlerRan).toBe(true);
    });
  });

  // ============================================================================
  // Resource Management
  // ============================================================================

  describe("resource management", () => {
    it("bracket should acquire, use, and release", async () => {
      const log: string[] = [];

      const result = await runIO(
        IO.bracket(
          IO.delay(() => {
            log.push("acquire");
            return { resource: "data" };
          }),
          (r) =>
            IO.delay(() => {
              log.push("use");
              return r.resource.toUpperCase();
            }),
          () =>
            IO.delay(() => {
              log.push("release");
            }),
        ),
      );

      expect(result).toBe("DATA");
      expect(log).toEqual(["acquire", "use", "release"]);
    });

    it("bracket should release even on error", async () => {
      let released = false;

      try {
        await runIO(
          IO.bracket(
            IO.pure("resource"),
            () => IO.raiseError(new Error("use failed")),
            () =>
              IO.delay(() => {
                released = true;
              }),
          ),
        );
      } catch {}

      expect(released).toBe(true);
    });
  });

  // ============================================================================
  // Traversals
  // ============================================================================

  describe("traversals", () => {
    it("traverse should sequence array effects", async () => {
      const result = await runIO(IO.traverse([1, 2, 3], (x) => IO.pure(x * 2)));
      expect(result).toEqual([2, 4, 6]);
    });

    it("sequence should sequence array of IOs", async () => {
      const result = await runIO(
        IO.sequence([IO.pure(1), IO.pure(2), IO.pure(3)]),
      );
      expect(result).toEqual([1, 2, 3]);
    });

    it("replicateA should repeat IO n times", async () => {
      let count = 0;
      const result = await runIO(
        IO.replicateA(
          3,
          IO.delay(() => ++count),
        ),
      );
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ============================================================================
  // Control Flow
  // ============================================================================

  describe("control flow", () => {
    it("ifM should branch based on condition", async () => {
      const resultTrue = await runIO(
        IO.ifM(IO.pure(true), IO.pure("yes"), IO.pure("no")),
      );
      expect(resultTrue).toBe("yes");

      const resultFalse = await runIO(
        IO.ifM(IO.pure(false), IO.pure("yes"), IO.pure("no")),
      );
      expect(resultFalse).toBe("no");
    });

    it("whenA should execute when true", async () => {
      let executed = false;
      await runIO(
        IO.whenA(
          true,
          IO.delay(() => {
            executed = true;
          }),
        ),
      );
      expect(executed).toBe(true);

      executed = false;
      await runIO(
        IO.whenA(
          false,
          IO.delay(() => {
            executed = true;
          }),
        ),
      );
      expect(executed).toBe(false);
    });

    it("tap should execute side effect and return original value", async () => {
      let sideEffect = 0;
      const result = await runIO(
        IO.tap(IO.pure(42), (x) =>
          IO.delay(() => {
            sideEffect = x;
          }),
        ),
      );
      expect(result).toBe(42);
      expect(sideEffect).toBe(42);
    });
  });

  // ============================================================================
  // Retry
  // ============================================================================

  describe("retry", () => {
    it("should retry on failure", async () => {
      let attempts = 0;
      const io = IO.delay(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`attempt ${attempts}`);
        }
        return "success";
      });

      const result = await runIO(IO.retry(io, 3));
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      let attempts = 0;
      const io = IO.delay<string>(() => {
        attempts++;
        throw new Error(`attempt ${attempts}`);
      });

      await expect(runIO(IO.retry(io, 2))).rejects.toThrow();
      expect(attempts).toBe(3); // Initial + 2 retries
    });
  });

  // ============================================================================
  // Sync Runner
  // ============================================================================

  describe("runIOSync", () => {
    it("should run synchronous IO", () => {
      const result = runIOSync(IO.pure(42));
      expect(result).toBe(42);
    });

    it("should handle delay", () => {
      const result = runIOSync(IO.delay(() => 42));
      expect(result).toBe(42);
    });

    it("should handle flatMap chain", () => {
      const result = runIOSync(
        IO.flatMap(IO.pure(10), (x) =>
          IO.flatMap(IO.pure(20), (y) => IO.pure(x + y)),
        ),
      );
      expect(result).toBe(30);
    });

    it("should throw on async IO", () => {
      const asyncIO = IO.fromPromise(() => Promise.resolve(42));
      expect(() => runIOSync(asyncIO)).toThrow(
        "Cannot run async IO synchronously",
      );
    });
  });

  // ============================================================================
  // Do-notation
  // ============================================================================

  describe("do-notation", () => {
    it("should support do-notation style", async () => {
      // Do-notation: bind x first, then y
      const withX = IODo.bind("x", () => IO.pure(10))(IODo.Do);
      const program = IODo.bind("y", (ctx: { x: number }) =>
        IO.pure(ctx.x * 2),
      )(withX);

      const result = await runIO(
        IO.map(program, (ctx: { x: number; y: number }) => ctx.x + ctx.y),
      );
      expect(result).toBe(30);
    });

    it("let_ should bind non-effectful values", async () => {
      const withX = IODo.bind("x", () => IO.pure(21))(IODo.Do);
      const program = IODo.let_(
        "doubled",
        (ctx: { x: number }) => ctx.x * 2,
      )(withX);

      const result = await runIO(
        IO.map(program, (ctx: { doubled: number }) => ctx.doubled),
      );
      expect(result).toBe(42);
    });
  });

  // ============================================================================
  // Fluent API
  // ============================================================================

  describe("fluent API", () => {
    it("should support method chaining", async () => {
      const result = await io(IO.pure(21))
        .map((x) => x * 2)
        .flatMap((x) => IO.pure(x + 1))
        .map((x) => x - 1)
        .run();

      expect(result).toBe(42);
    });

    it("should support tap", async () => {
      let sideEffect = 0;
      const result = await io(IO.pure(42))
        .tap((x) =>
          IO.delay(() => {
            sideEffect = x;
          }),
        )
        .run();

      expect(result).toBe(42);
      expect(sideEffect).toBe(42);
    });

    it("should support error handling", async () => {
      const result = await io(IO.raiseError<number>(new Error("oops")))
        .handleError(() => IO.pure(42))
        .run();

      expect(result).toBe(42);
    });

    it("runSync should work for sync IOs", () => {
      const result = io(IO.pure(42))
        .map((x) => x * 2)
        .runSync();
      expect(result).toBe(84);
    });
  });

  // ============================================================================
  // Stack Safety
  // ============================================================================

  describe("stack safety", () => {
    it("should handle deep flatMap chains", async () => {
      const depth = 10000;
      let io_: IO<number> = IO.pure(0);

      for (let i = 0; i < depth; i++) {
        io_ = IO.flatMap(io_, (n) => IO.pure(n + 1));
      }

      const result = await runIO(io_);
      expect(result).toBe(depth);
    });

    it("should handle deep map chains", async () => {
      const depth = 10000;
      let io_: IO<number> = IO.pure(0);

      for (let i = 0; i < depth; i++) {
        io_ = IO.map(io_, (n) => n + 1);
      }

      const result = await runIO(io_);
      expect(result).toBe(depth);
    });
  });
});
