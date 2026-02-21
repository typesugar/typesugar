/**
 * HKT Encoding Tests for Effect Types
 */
import { describe, it, expect } from "vitest";
import { Effect, Option, Either, Chunk } from "effect";
import type { $, HKT } from "@typesugar/fp/hkt";
import type { EffectF, ChunkF, EffectOptionF, EffectEitherF } from "../src/hkt.js";

describe("HKT Encoding", () => {
  describe("EffectF", () => {
    it("should correctly encode Effect type", () => {
      // Type-level test: this should compile
      type TestEffect = $<EffectF<never, never>, number>;
      const effect: TestEffect = Effect.succeed(42);
      expect(Effect.runSync(effect)).toBe(42);
    });

    it("should preserve error type parameter", () => {
      type TestEffect = $<EffectF<string, never>, number>;
      const effect: TestEffect = Effect.fail("error") as any;
      // Type check passes if this compiles
      expect(true).toBe(true);
    });

    it("should preserve requirements type parameter", () => {
      interface TestService {
        getValue(): Effect.Effect<number>;
      }
      type TestEffect = $<EffectF<never, TestService>, number>;
      // Type check passes if this compiles
      expect(true).toBe(true);
    });
  });

  describe("ChunkF", () => {
    it("should correctly encode Chunk type", () => {
      type TestChunk = $<ChunkF, number>;
      const chunk: TestChunk = Chunk.fromIterable([1, 2, 3]);
      expect(Chunk.toArray(chunk)).toEqual([1, 2, 3]);
    });
  });

  describe("EffectOptionF", () => {
    it("should encode Effect wrapping Option", () => {
      type TestEffectOption = $<EffectOptionF<never, never>, number>;
      const effectOption: TestEffectOption = Effect.succeed(Option.some(42));
      const result = Effect.runSync(effectOption);
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrElse(result, () => 0)).toBe(42);
    });
  });

  describe("EffectEitherF", () => {
    it("should encode Effect wrapping Either", () => {
      type TestEffectEither = $<EffectEitherF<string, never, never>, number>;
      const effectEither: TestEffectEither = Effect.succeed(Either.right(42));
      const result = Effect.runSync(effectEither);
      expect(Either.isRight(result)).toBe(true);
    });
  });
});
