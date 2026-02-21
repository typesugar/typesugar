/**
 * Red Team Tests for @typesugar/fp (Either, Option edge cases)
 *
 * Attack surfaces:
 * - Either error type inference
 * - Option null collapse scenarios
 * - Nested Either/Option combinations
 * - Type narrowing edge cases
 * - Equality with reference types
 * - Traverse/sequence short-circuiting
 */
import { describe, it, expect } from "vitest";
import {
  Option,
  Some,
  None,
  isSome,
  isNone,
  map as mapOption,
  flatMap as flatMapOption,
  getOrElse,
  filter,
  traverse as traverseOption,
  sequence as sequenceOption,
  zip,
  fold as foldOption,
  Defined,
  defined,
  unwrapDefined,
} from "../packages/fp/src/data/option.js";
import {
  Either,
  Left,
  Right,
  isLeft,
  isRight,
  map as mapEither,
  flatMap as flatMapEither,
  getOrElse as getOrElseEither,
  traverse as traverseEither,
  sequence as sequenceEither,
  fold as foldEither,
  tryCatch,
  fromNullable,
  swap,
  bimap,
  partition,
} from "../packages/fp/src/data/either.js";

describe("Option Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Option<null> Type Collapse (Finding #1)
  // ==========================================================================
  describe("Option<null> scenarios", () => {
    it("Option<Defined<null>> distinguishes Some(null) from None", () => {
      const someNull: Option<Defined<null>> = defined(null);
      const none: Option<Defined<null>> = None;

      expect(isSome(someNull)).toBe(true);
      expect(isNone(none)).toBe(true);

      if (isSome(someNull)) {
        expect(unwrapDefined(someNull)).toBe(null);
      }
    });

    it("Option<string | null> is problematic (Some(null) === None)", () => {
      // This is a known limitation - if A includes null, Some(null) = null = None
      const value: Option<string | null> = null;

      // We cannot distinguish between Some(null) and None
      expect(isNone(value)).toBe(true); // Is this None or Some(null)?
    });

    it("Nested Option<Option<T>> flattens incorrectly without Defined", () => {
      // Option<Option<number>> = (number | null) | null = number | null
      // The nesting is lost!
      type Nested = Option<Option<number>>;
      const inner: Nested = 42;
      const none: Nested = null;

      // We can't represent Some(None) vs None vs Some(Some(42))
      expect(inner).toBe(42);
      expect(none).toBe(null);
    });

    it("Nested Option with Defined works correctly", () => {
      type SafeNested = Option<Defined<Option<number>>>;

      const someNone: SafeNested = defined(null as Option<number>); // Some(None)
      const someSome: SafeNested = defined(42 as Option<number>); // Some(Some(42))
      const none: SafeNested = null; // None

      expect(isSome(someNone)).toBe(true);
      expect(isSome(someSome)).toBe(true);
      expect(isNone(none)).toBe(true);

      if (isSome(someNone)) {
        expect(unwrapDefined(someNone)).toBe(null);
      }
      if (isSome(someSome)) {
        expect(unwrapDefined(someSome)).toBe(42);
      }
    });
  });

  // ==========================================================================
  // Attack 2: Option<unknown> Degeneracy (Finding #5)
  // ==========================================================================
  describe("Option<unknown> scenarios", () => {
    it("Option<unknown> is degenerate (unknown | null = unknown)", () => {
      // TypeScript: unknown | null = unknown
      // So Option<unknown> = unknown, losing the null case
      type Degenerate = Option<unknown>;

      const value: Degenerate = "hello";
      const nullValue: Degenerate = null;

      // Both are valid unknown values
      expect(value).toBe("hello");
      expect(nullValue).toBe(null);

      // isSome checks !== null, which works at runtime but is unsound
      expect(isSome(value)).toBe(true);
      expect(isNone(nullValue)).toBe(true);
    });

    it("Use Defined<unknown> for safety", () => {
      type Safe = Option<Defined<unknown>>;

      const some: Safe = defined("hello" as unknown);
      const none: Safe = null;

      expect(isSome(some)).toBe(true);
      expect(isNone(none)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: map() with Functions Returning null
  // ==========================================================================
  describe("map() edge cases", () => {
    it("map() function returning null produces None", () => {
      const opt: Option<number> = 42;
      const result = mapOption(opt, () => null);

      // The function returned null, so result is null (None)
      expect(isNone(result)).toBe(true);
    });

    it("map() function returning undefined", () => {
      const opt: Option<number> = 42;
      const result = mapOption(opt, () => undefined);

      // undefined is not null, so it's Some(undefined)
      expect(isSome(result)).toBe(true);
      expect(result).toBe(undefined);
    });

    it("flatMap() returning None short-circuits", () => {
      const opt: Option<number> = 42;
      let called = false;

      const result = flatMapOption(opt, () => {
        called = true;
        return null as Option<number>;
      });

      expect(called).toBe(true);
      expect(isNone(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: filter() with Always-False Predicate
  // ==========================================================================
  describe("filter() edge cases", () => {
    it("filter() with false predicate returns None", () => {
      const opt: Option<number> = 42;
      const result = filter(opt, () => false);

      expect(isNone(result)).toBe(true);
    });

    it("filter() on None returns None", () => {
      const opt: Option<number> = None;
      let called = false;

      const result = filter(opt, () => {
        called = true;
        return true;
      });

      expect(called).toBe(false); // Predicate not called
      expect(isNone(result)).toBe(true);
    });

    it("filter() with type guard narrows type", () => {
      const opt: Option<number | string> = "hello";

      const result = filter(opt, (x): x is string => typeof x === "string");

      // At runtime this works
      expect(isSome(result)).toBe(true);
      expect(result).toBe("hello");
    });
  });

  // ==========================================================================
  // Attack 5: traverse/sequence Short-Circuiting
  // ==========================================================================
  describe("traverse/sequence edge cases", () => {
    it("traverse() short-circuits on first None", () => {
      const callOrder: number[] = [];

      const result = traverseOption([1, 2, 3, 4, 5], (x) => {
        callOrder.push(x);
        return x === 3 ? None : Some(x * 2);
      });

      expect(isNone(result)).toBe(true);
      expect(callOrder).toEqual([1, 2, 3]); // Stopped at 3
    });

    it("sequence() with all Some", () => {
      const opts: Option<number>[] = [1, 2, 3];
      const result = sequenceOption(opts);

      expect(isSome(result)).toBe(true);
      expect(result).toEqual([1, 2, 3]);
    });

    it("sequence() with one None", () => {
      const opts: Option<number>[] = [1, null, 3];
      const result = sequenceOption(opts);

      expect(isNone(result)).toBe(true);
    });

    it("traverse() empty array", () => {
      const result = traverseOption([], () => None);

      expect(isSome(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 6: zip() with None
  // ==========================================================================
  describe("zip() edge cases", () => {
    it("zip() with first None", () => {
      const a: Option<number> = None;
      const b: Option<string> = "hello";

      const result = zip(a, b);
      expect(isNone(result)).toBe(true);
    });

    it("zip() with second None", () => {
      const a: Option<number> = 42;
      const b: Option<string> = None;

      const result = zip(a, b);
      expect(isNone(result)).toBe(true);
    });

    it("zip() with both Some", () => {
      const a: Option<number> = 42;
      const b: Option<string> = "hello";

      const result = zip(a, b);
      expect(isSome(result)).toBe(true);
      expect(result).toEqual([42, "hello"]);
    });
  });

  // ==========================================================================
  // Attack 7: fold() Type Safety
  // ==========================================================================
  describe("fold() edge cases", () => {
    it("fold() with different return types", () => {
      const some: Option<number> = 42;
      const none: Option<number> = None;

      const resultSome = foldOption(
        some,
        () => "none",
        (n) => `some: ${n}`
      );
      const resultNone = foldOption(
        none,
        () => "none",
        (n) => `some: ${n}`
      );

      expect(resultSome).toBe("some: 42");
      expect(resultNone).toBe("none");
    });

    it("fold() onNone callback is lazy", () => {
      const opt: Option<number> = 42;
      let called = false;

      foldOption(
        opt,
        () => {
          called = true;
          return 0;
        },
        (n) => n
      );

      expect(called).toBe(false);
    });
  });
});

describe("Either Edge Cases", () => {
  // ==========================================================================
  // Attack 8: Either Error Type Inference
  // ==========================================================================
  describe("Error type inference", () => {
    it("Left preserves error type", () => {
      const err: Either<Error, number> = Left(new Error("oops"));

      if (isLeft(err)) {
        expect(err.left).toBeInstanceOf(Error);
        expect(err.left.message).toBe("oops");
      }
    });

    it("tryCatch() with unknown error", () => {
      const result = tryCatch(
        () => {
          throw "string error";
        },
        (e) => String(e)
      );

      expect(isLeft(result)).toBe(true);
      if (isLeft(result)) {
        expect(result.left).toBe("string error");
      }
    });

    it("tryCatch() error mapping", () => {
      const result = tryCatch(
        () => {
          throw new Error("original");
        },
        (e) => ({ code: 500, message: String(e) })
      );

      if (isLeft(result)) {
        expect(result.left.code).toBe(500);
      }
    });
  });

  // ==========================================================================
  // Attack 9: Either with void
  // ==========================================================================
  describe("Either<E, void> scenarios", () => {
    it("Right(undefined) for void success", () => {
      const result: Either<string, void> = Right(undefined);

      expect(isRight(result)).toBe(true);
      if (isRight(result)) {
        expect(result.right).toBeUndefined();
      }
    });

    it("map() on void Either", () => {
      const result: Either<string, void> = Right(undefined);
      const mapped = mapEither(result, () => 42);

      expect(isRight(mapped)).toBe(true);
      if (isRight(mapped)) {
        expect(mapped.right).toBe(42);
      }
    });
  });

  // ==========================================================================
  // Attack 10: Either flatMap Error Type Widening
  // ==========================================================================
  describe("Error type widening in flatMap", () => {
    it("flatMap() preserves error type", () => {
      const either: Either<string, number> = Right(42);

      const result = flatMapEither(either, (n) => (n > 50 ? Left("too big") : Right(n * 2)));

      expect(isRight(result)).toBe(true);
      if (isRight(result)) {
        expect(result.right).toBe(84);
      }
    });

    it("flatMap() with different error in callback", () => {
      // TypeScript requires E to be the same in flatMap signature
      // But at runtime, we can return different error types
      const either: Either<string, number> = Right(42);

      // This works because both branches return Either<string, number>
      const result = flatMapEither(either, (n) => (n < 50 ? Left("too small") : Right(n)));

      expect(isLeft(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 11: swap() Edge Cases
  // ==========================================================================
  describe("swap() edge cases", () => {
    it("swap() Left becomes Right", () => {
      const either: Either<string, number> = Left("error");
      const swapped = swap(either);

      expect(isRight(swapped)).toBe(true);
      if (isRight(swapped)) {
        expect(swapped.right).toBe("error");
      }
    });

    it("swap() is self-inverse", () => {
      const either: Either<string, number> = Right(42);
      const doubleSwapped = swap(swap(either));

      expect(isRight(doubleSwapped)).toBe(true);
      if (isRight(doubleSwapped)) {
        expect(doubleSwapped.right).toBe(42);
      }
    });

    it("swap() with same types", () => {
      const either: Either<number, number> = Left(1);
      const swapped = swap(either);

      // Type is Either<number, number>, but value moved
      expect(isRight(swapped)).toBe(true);
      if (isRight(swapped)) {
        expect(swapped.right).toBe(1);
      }
    });
  });

  // ==========================================================================
  // Attack 12: bimap() Edge Cases
  // ==========================================================================
  describe("bimap() edge cases", () => {
    it("bimap() on Left applies left function", () => {
      const either: Either<number, string> = Left(42);
      const result = bimap(
        either,
        (n) => n * 2,
        (s) => s.toUpperCase()
      );

      expect(isLeft(result)).toBe(true);
      if (isLeft(result)) {
        expect(result.left).toBe(84);
      }
    });

    it("bimap() on Right applies right function", () => {
      const either: Either<number, string> = Right("hello");
      const result = bimap(
        either,
        (n) => n * 2,
        (s) => s.toUpperCase()
      );

      expect(isRight(result)).toBe(true);
      if (isRight(result)) {
        expect(result.right).toBe("HELLO");
      }
    });

    it("bimap() with throwing functions", () => {
      const either: Either<number, string> = Right("hello");

      // Only right function is called, left throwing doesn't matter
      const result = bimap(
        either,
        () => {
          throw new Error("should not be called");
        },
        (s) => s.length
      );

      expect(isRight(result)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 13: fromNullable() Edge Cases
  // ==========================================================================
  describe("fromNullable() edge cases", () => {
    it("fromNullable() with null", () => {
      const result = fromNullable(null, () => "was null");

      expect(isLeft(result)).toBe(true);
      if (isLeft(result)) {
        expect(result.left).toBe("was null");
      }
    });

    it("fromNullable() with undefined", () => {
      const result = fromNullable(undefined, () => "was undefined");

      expect(isLeft(result)).toBe(true);
    });

    it("fromNullable() with falsy but valid values", () => {
      const zero = fromNullable(0, () => "error");
      const empty = fromNullable("", () => "error");
      const falseVal = fromNullable(false, () => "error");

      expect(isRight(zero)).toBe(true);
      expect(isRight(empty)).toBe(true);
      expect(isRight(falseVal)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 14: partition() Edge Cases
  // ==========================================================================
  describe("partition() edge cases", () => {
    it("partition() separates lefts and rights", () => {
      const result = partition([1, 2, 3, 4, 5], (n) =>
        n % 2 === 0 ? Right(n) : Left(`odd: ${n}`)
      );

      expect(result.lefts).toEqual(["odd: 1", "odd: 3", "odd: 5"]);
      expect(result.rights).toEqual([2, 4]);
    });

    it("partition() empty array", () => {
      const result = partition([], () => Right(1));

      expect(result.lefts).toEqual([]);
      expect(result.rights).toEqual([]);
    });

    it("partition() all lefts", () => {
      const result = partition([1, 2, 3], () => Left("error"));

      expect(result.lefts).toEqual(["error", "error", "error"]);
      expect(result.rights).toEqual([]);
    });

    it("partition() all rights", () => {
      const result = partition([1, 2, 3], (n) => Right(n * 2));

      expect(result.lefts).toEqual([]);
      expect(result.rights).toEqual([2, 4, 6]);
    });
  });

  // ==========================================================================
  // Attack 15: traverse/sequence Error Accumulation (it doesn't)
  // ==========================================================================
  describe("traverse/sequence short-circuiting", () => {
    it("traverse() stops on first Left (no error accumulation)", () => {
      const callOrder: number[] = [];

      const result = traverseEither([1, 2, 3, 4, 5], (x) => {
        callOrder.push(x);
        return x === 3 ? Left(`error at ${x}`) : Right(x * 2);
      });

      expect(isLeft(result)).toBe(true);
      expect(callOrder).toEqual([1, 2, 3]); // Stopped at 3
      if (isLeft(result)) {
        expect(result.left).toBe("error at 3");
      }
    });

    it("sequence() returns first error only", () => {
      const eithers: Either<string, number>[] = [
        Right(1),
        Left("first error"),
        Left("second error"),
        Right(4),
      ];

      const result = sequenceEither(eithers);

      expect(isLeft(result)).toBe(true);
      if (isLeft(result)) {
        expect(result.left).toBe("first error");
      }
    });
  });
});

describe("Combined Option/Either Edge Cases", () => {
  // ==========================================================================
  // Attack 16: Converting Between Types
  // ==========================================================================
  describe("Option <-> Either conversions", () => {
    it("Option to Either loses None info", () => {
      const opt: Option<number> = None;

      // Must provide error for Left case
      const either: Either<string, number> = opt !== null ? Right(opt) : Left("was none");

      expect(isLeft(either)).toBe(true);
    });

    it("Either to Option loses error info", () => {
      const either: Either<{ code: number; message: string }, number> = Left({
        code: 500,
        message: "server error",
      });

      // Converting to Option loses the error details
      const opt: Option<number> = isRight(either) ? either.right : None;

      expect(isNone(opt)).toBe(true);
      // Error info is lost!
    });
  });

  // ==========================================================================
  // Attack 17: Reference Equality
  // ==========================================================================
  describe("Reference equality edge cases", () => {
    it("Two Some with same primitive are equal", () => {
      const a: Option<number> = 42;
      const b: Option<number> = 42;

      expect(a === b).toBe(true); // Primitives
    });

    it("Two Some with same object are not equal (different refs)", () => {
      const a: Option<{ x: number }> = { x: 42 };
      const b: Option<{ x: number }> = { x: 42 };

      expect(a === b).toBe(false); // Different objects
    });

    it("Two Right with same object are not equal", () => {
      const a: Either<string, { x: number }> = Right({ x: 42 });
      const b: Either<string, { x: number }> = Right({ x: 42 });

      expect(a === b).toBe(false); // Different Right wrappers
    });

    it("Two Left with same error are not equal", () => {
      const a: Either<string, number> = Left("error");
      const b: Either<string, number> = Left("error");

      expect(a === b).toBe(false); // Different Left wrappers
    });
  });
});
