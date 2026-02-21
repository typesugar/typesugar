/**
 * Extension Method Tests for Effect Types
 *
 * These tests verify that the extension methods work correctly when called directly.
 * The transformer rewrites `effect.map(f)` to `EffectExt.map(effect, f)`.
 */
import { describe, it, expect } from "vitest";
import { Effect, Option, Either, pipe, Duration } from "effect";
import { EffectExt, OptionExt, EitherExt } from "../src/extensions.js";

describe("EffectExt", () => {
  describe("map", () => {
    it("should transform success value", () => {
      const effect = Effect.succeed(10);
      const mapped = EffectExt.map(effect, (x) => x * 2);
      expect(Effect.runSync(mapped)).toBe(20);
    });
  });

  describe("as", () => {
    it("should replace success value with constant", () => {
      const effect = Effect.succeed("hello");
      const mapped = EffectExt.as(effect, 42);
      expect(Effect.runSync(mapped)).toBe(42);
    });
  });

  describe("asVoid", () => {
    it("should discard success value", () => {
      const effect = Effect.succeed(42);
      const voided = EffectExt.asVoid(effect);
      expect(Effect.runSync(voided)).toBeUndefined();
    });
  });

  describe("flatMap", () => {
    it("should chain effects", () => {
      const effect = Effect.succeed(10);
      const chained = EffectExt.flatMap(effect, (x) => Effect.succeed(x * 2));
      expect(Effect.runSync(chained)).toBe(20);
    });

    it("should propagate errors", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const chained = EffectExt.flatMap(effect, (x) => Effect.succeed(x * 2));
      const exit = Effect.runSyncExit(chained);
      expect(exit._tag).toBe("Failure");
    });
  });

  describe("flatten", () => {
    it("should unwrap nested effect", () => {
      const nested = Effect.succeed(Effect.succeed(42));
      const flat = EffectExt.flatten(nested);
      expect(Effect.runSync(flat)).toBe(42);
    });
  });

  describe("tap", () => {
    it("should execute side effect without changing value", () => {
      let sideEffect = 0;
      const effect = Effect.succeed(42);
      const tapped = EffectExt.tap(effect, (x) => {
        sideEffect = x;
        return Effect.void;
      });
      const result = Effect.runSync(tapped);
      expect(result).toBe(42);
      expect(sideEffect).toBe(42);
    });
  });

  describe("tapError", () => {
    it("should execute side effect on error", () => {
      let errorLogged: string | null = null;
      const effect: Effect.Effect<number, string> = Effect.fail("test error");
      const tapped = EffectExt.tapError(effect, (e) => {
        errorLogged = e;
        return Effect.void;
      });
      Effect.runSyncExit(tapped);
      expect(errorLogged).toBe("test error");
    });
  });

  describe("catchAll", () => {
    it("should recover from errors", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const recovered = EffectExt.catchAll(effect, () => Effect.succeed(0));
      expect(Effect.runSync(recovered)).toBe(0);
    });

    it("should not affect successful effects", () => {
      const effect = Effect.succeed(42);
      const recovered = EffectExt.catchAll(effect, () => Effect.succeed(0));
      expect(Effect.runSync(recovered)).toBe(42);
    });
  });

  describe("orElse", () => {
    it("should provide fallback on failure", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const withFallback = EffectExt.orElse(effect, () => Effect.succeed(99));
      expect(Effect.runSync(withFallback)).toBe(99);
    });
  });

  describe("orElseSucceed", () => {
    it("should provide fallback value on failure", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const withFallback = EffectExt.orElseSucceed(effect, () => 99);
      expect(Effect.runSync(withFallback)).toBe(99);
    });
  });

  describe("mapError", () => {
    it("should transform error", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const mapped = EffectExt.mapError(effect, (e) => new Error(e));
      const exit = Effect.runSyncExit(mapped);
      expect(exit._tag).toBe("Failure");
    });
  });

  describe("option", () => {
    it("should convert success to Some", () => {
      const effect = Effect.succeed(42);
      const optional = EffectExt.option(effect);
      const result = Effect.runSync(optional);
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrElse(result, () => 0)).toBe(42);
    });

    it("should convert failure to None", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const optional = EffectExt.option(effect);
      const result = Effect.runSync(optional);
      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe("either", () => {
    it("should convert success to Right", () => {
      const effect = Effect.succeed(42);
      const eitherResult = EffectExt.either(effect);
      const result = Effect.runSync(eitherResult);
      expect(Either.isRight(result)).toBe(true);
    });

    it("should convert failure to Left", () => {
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const eitherResult = EffectExt.either(effect);
      const result = Effect.runSync(eitherResult);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  describe("zip", () => {
    it("should combine two effects", () => {
      const e1 = Effect.succeed(1);
      const e2 = Effect.succeed(2);
      const zipped = EffectExt.zip(e1, e2);
      const [a, b] = Effect.runSync(zipped);
      expect(a).toBe(1);
      expect(b).toBe(2);
    });
  });

  describe("zipWith", () => {
    it("should combine two effects with a function", () => {
      const e1 = Effect.succeed(10);
      const e2 = Effect.succeed(20);
      const combined = EffectExt.zipWith(e1, e2, (a, b) => a + b);
      expect(Effect.runSync(combined)).toBe(30);
    });
  });

  describe("filterOrFail", () => {
    it("should pass through values matching predicate", () => {
      const effect = Effect.succeed(42);
      const filtered = EffectExt.filterOrFail(
        effect,
        (x) => x > 0,
        () => "must be positive"
      );
      expect(Effect.runSync(filtered)).toBe(42);
    });

    it("should fail when predicate returns false", () => {
      const effect = Effect.succeed(-1);
      const filtered = EffectExt.filterOrFail(
        effect,
        (x) => x > 0,
        () => "must be positive"
      );
      const exit = Effect.runSyncExit(filtered);
      expect(exit._tag).toBe("Failure");
    });
  });

  describe("delay", () => {
    it("should delay execution", async () => {
      const effect = Effect.succeed(42);
      const delayed = EffectExt.delay(effect, Duration.millis(10));
      const result = await Effect.runPromise(delayed);
      expect(result).toBe(42);
    });
  });

  describe("ensuring", () => {
    it("should run finalizer after success", () => {
      let finalized = false;
      const effect = Effect.succeed(42);
      const ensured = EffectExt.ensuring(
        effect,
        Effect.sync(() => {
          finalized = true;
        })
      );
      Effect.runSync(ensured);
      expect(finalized).toBe(true);
    });

    it("should run finalizer after failure", () => {
      let finalized = false;
      const effect: Effect.Effect<number, string> = Effect.fail("error");
      const ensured = EffectExt.ensuring(
        effect,
        Effect.sync(() => {
          finalized = true;
        })
      );
      Effect.runSyncExit(ensured);
      expect(finalized).toBe(true);
    });
  });

  describe("runSync", () => {
    it("should run effect synchronously", () => {
      const effect = Effect.succeed(42);
      expect(EffectExt.runSync(effect)).toBe(42);
    });
  });

  describe("runPromise", () => {
    it("should run effect as promise", async () => {
      const effect = Effect.succeed(42);
      const result = await EffectExt.runPromise(effect);
      expect(result).toBe(42);
    });
  });
});

describe("OptionExt", () => {
  describe("map", () => {
    it("should map over Some", () => {
      const opt = Option.some(10);
      const mapped = OptionExt.map(opt, (x) => x * 2);
      expect(Option.getOrElse(mapped, () => 0)).toBe(20);
    });

    it("should preserve None", () => {
      const opt: Option.Option<number> = Option.none();
      const mapped = OptionExt.map(opt, (x) => x * 2);
      expect(Option.isNone(mapped)).toBe(true);
    });
  });

  describe("flatMap", () => {
    it("should chain options", () => {
      const opt = Option.some(10);
      const chained = OptionExt.flatMap(opt, (x) => Option.some(x * 2));
      expect(Option.getOrElse(chained, () => 0)).toBe(20);
    });
  });

  describe("getOrElse", () => {
    it("should return value for Some", () => {
      const opt = Option.some(42);
      expect(OptionExt.getOrElse(opt, () => 0)).toBe(42);
    });

    it("should return default for None", () => {
      const opt: Option.Option<number> = Option.none();
      expect(OptionExt.getOrElse(opt, () => 99)).toBe(99);
    });
  });

  describe("isSome/isNone", () => {
    it("should detect Some", () => {
      const opt = Option.some(42);
      expect(OptionExt.isSome(opt)).toBe(true);
      expect(OptionExt.isNone(opt)).toBe(false);
    });

    it("should detect None", () => {
      const opt: Option.Option<number> = Option.none();
      expect(OptionExt.isNone(opt)).toBe(true);
      expect(OptionExt.isSome(opt)).toBe(false);
    });
  });

  describe("filter", () => {
    it("should keep values matching predicate", () => {
      const opt = Option.some(42);
      const filtered = OptionExt.filter(opt, (x) => x > 0);
      expect(Option.isSome(filtered)).toBe(true);
    });

    it("should filter out values not matching", () => {
      const opt = Option.some(-1);
      const filtered = OptionExt.filter(opt, (x) => x > 0);
      expect(Option.isNone(filtered)).toBe(true);
    });
  });
});

describe("EitherExt", () => {
  describe("map", () => {
    it("should map over Right", () => {
      const either = Either.right(10);
      const mapped = EitherExt.map(either, (x) => x * 2);
      expect(Either.getOrElse(mapped, () => 0)).toBe(20);
    });

    it("should preserve Left", () => {
      const either: Either.Either<number, string> = Either.left("error");
      const mapped = EitherExt.map(either, (x) => x * 2);
      expect(Either.isLeft(mapped)).toBe(true);
    });
  });

  describe("flatMap", () => {
    it("should chain Eithers", () => {
      const either = Either.right(10);
      const chained = EitherExt.flatMap(either, (x) => Either.right(x * 2));
      expect(Either.getOrElse(chained, () => 0)).toBe(20);
    });
  });

  describe("mapLeft", () => {
    it("should transform Left value", () => {
      const either: Either.Either<number, string> = Either.left("error");
      const mapped = EitherExt.mapLeft(either, (e) => e.toUpperCase());
      expect(Either.isLeft(mapped)).toBe(true);
    });
  });

  describe("getOrElse", () => {
    it("should return value for Right", () => {
      const either = Either.right(42);
      expect(EitherExt.getOrElse(either, () => 0)).toBe(42);
    });

    it("should return computed value for Left", () => {
      const either: Either.Either<number, string> = Either.left("error");
      expect(EitherExt.getOrElse(either, () => 99)).toBe(99);
    });
  });

  describe("isRight/isLeft", () => {
    it("should detect Right", () => {
      const either = Either.right(42);
      expect(EitherExt.isRight(either)).toBe(true);
      expect(EitherExt.isLeft(either)).toBe(false);
    });

    it("should detect Left", () => {
      const either: Either.Either<number, string> = Either.left("error");
      expect(EitherExt.isLeft(either)).toBe(true);
      expect(EitherExt.isRight(either)).toBe(false);
    });
  });

  describe("flip", () => {
    it("should swap Right to Left", () => {
      const either = Either.right(42);
      const flipped = EitherExt.flip(either);
      expect(Either.isLeft(flipped)).toBe(true);
    });

    it("should swap Left to Right", () => {
      const either: Either.Either<number, string> = Either.left("error");
      const flipped = EitherExt.flip(either);
      expect(Either.isRight(flipped)).toBe(true);
    });
  });
});
