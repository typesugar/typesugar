/**
 * Typeclass Instance Tests for Effect Types
 */
import { describe, it, expect } from "vitest";
import { Effect, Option, Either, Chunk, pipe } from "effect";
import {
  effectFunctor,
  effectApplicative,
  effectMonad,
  effectMonadError,
  chunkFunctor,
  chunkFoldable,
  effectOptionFunctor,
  effectOptionMonad,
  effectEitherFunctor,
  effectEitherMonad,
} from "../src/instances.js";

describe("Effect Typeclass Instances", () => {
  describe("effectFunctor", () => {
    it("should map over Effect success value", () => {
      const effect = Effect.succeed(10);
      const mapped = effectFunctor<never, never>().map(effect, (x) => x * 2);
      expect(Effect.runSync(mapped)).toBe(20);
    });

    it("should preserve identity law: map(fa, id) === fa", () => {
      const effect = Effect.succeed(42);
      const mapped = effectFunctor<never, never>().map(effect, (x) => x);
      expect(Effect.runSync(mapped)).toBe(Effect.runSync(effect));
    });

    it("should preserve composition law: map(map(fa, f), g) === map(fa, g . f)", () => {
      const effect = Effect.succeed(5);
      const f = (x: number) => x + 1;
      const g = (x: number) => x * 2;

      const left = effectFunctor<never, never>().map(
        effectFunctor<never, never>().map(effect, f),
        g
      );
      const right = effectFunctor<never, never>().map(effect, (x) => g(f(x)));

      expect(Effect.runSync(left)).toBe(Effect.runSync(right));
    });
  });

  describe("effectApplicative", () => {
    it("should create pure effects", () => {
      const pure = effectApplicative<never, never>().pure(42);
      expect(Effect.runSync(pure)).toBe(42);
    });

    it("should apply function effects to value effects", () => {
      const fn = Effect.succeed((x: number) => x * 2);
      const value = Effect.succeed(21);
      const result = effectApplicative<never, never>().ap(fn, value);
      expect(Effect.runSync(result)).toBe(42);
    });
  });

  describe("effectMonad", () => {
    it("should flatMap over Effect", () => {
      const effect = Effect.succeed(10);
      const result = effectMonad<never, never>().flatMap(effect, (x) => Effect.succeed(x * 2));
      expect(Effect.runSync(result)).toBe(20);
    });

    it("should satisfy left identity: flatMap(pure(a), f) === f(a)", () => {
      const a = 5;
      const f = (x: number) => Effect.succeed(x * 2);

      const left = effectMonad<never, never>().flatMap(effectMonad<never, never>().pure(a), f);
      const right = f(a);

      expect(Effect.runSync(left)).toBe(Effect.runSync(right));
    });

    it("should satisfy right identity: flatMap(fa, pure) === fa", () => {
      const fa = Effect.succeed(42);

      const result = effectMonad<never, never>().flatMap(fa, (x) =>
        effectMonad<never, never>().pure(x)
      );

      expect(Effect.runSync(result)).toBe(Effect.runSync(fa));
    });
  });

  describe("effectMonadError", () => {
    it("should raise errors", () => {
      const error = effectMonadError<string, never>().raiseError("test error");
      const exit = Effect.runSyncExit(error);
      expect(exit._tag).toBe("Failure");
    });

    it("should handle errors", () => {
      const failing = Effect.fail("original error");
      const recovered = effectMonadError<string, never>().handleErrorWith(failing, () =>
        Effect.succeed(42)
      );
      expect(Effect.runSync(recovered)).toBe(42);
    });
  });
});

describe("Chunk Typeclass Instances", () => {
  describe("chunkFunctor", () => {
    it("should map over Chunk elements", () => {
      const chunk = Chunk.fromIterable([1, 2, 3]);
      const mapped = chunkFunctor.map(chunk, (x) => x * 2);
      expect(Chunk.toArray(mapped)).toEqual([2, 4, 6]);
    });
  });

  describe("chunkFoldable", () => {
    it("should foldLeft over Chunk", () => {
      const chunk = Chunk.fromIterable([1, 2, 3, 4]);
      const sum = chunkFoldable.foldLeft(chunk, 0, (acc, x) => acc + x);
      expect(sum).toBe(10);
    });

    it("should foldRight over Chunk", () => {
      const chunk = Chunk.fromIterable(["a", "b", "c"]);
      const result = chunkFoldable.foldRight(chunk, "", (x, acc) => x + acc);
      expect(result).toBe("abc");
    });
  });
});

describe("Effect Option Instances", () => {
  describe("effectOptionFunctor", () => {
    it("should map over Some values", () => {
      const opt = Option.some(10);
      const mapped = effectOptionFunctor.map(opt, (x) => x * 2);
      expect(Option.getOrElse(mapped, () => 0)).toBe(20);
    });

    it("should preserve None", () => {
      const opt: Option.Option<number> = Option.none();
      const mapped = effectOptionFunctor.map(opt, (x) => x * 2);
      expect(Option.isNone(mapped)).toBe(true);
    });
  });

  describe("effectOptionMonad", () => {
    it("should flatMap over Some values", () => {
      const opt = Option.some(10);
      const result = effectOptionMonad.flatMap(opt, (x) => Option.some(x * 2));
      expect(Option.getOrElse(result, () => 0)).toBe(20);
    });

    it("should short-circuit on None", () => {
      const opt: Option.Option<number> = Option.none();
      const result = effectOptionMonad.flatMap(opt, (x) => Option.some(x * 2));
      expect(Option.isNone(result)).toBe(true);
    });
  });
});

describe("Effect Either Instances", () => {
  describe("effectEitherFunctor", () => {
    it("should map over Right values", () => {
      const either = Either.right(10);
      const mapped = effectEitherFunctor<string, never, never>().map(either, (x) => x * 2);
      expect(Either.getOrElse(mapped, () => 0)).toBe(20);
    });

    it("should preserve Left values", () => {
      const either: Either.Either<number, string> = Either.left("error");
      const mapped = effectEitherFunctor<string, never, never>().map(either, (x) => x * 2);
      expect(Either.isLeft(mapped)).toBe(true);
    });
  });

  describe("effectEitherMonad", () => {
    it("should flatMap over Right values", () => {
      const either = Either.right(10);
      const result = effectEitherMonad<string, never, never>().flatMap(either, (x) =>
        Either.right(x * 2)
      );
      expect(Either.getOrElse(result, () => 0)).toBe(20);
    });

    it("should short-circuit on Left", () => {
      const either: Either.Either<number, string> = Either.left("error");
      const result = effectEitherMonad<string, never, never>().flatMap(either, (x) =>
        Either.right(x * 2)
      );
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
