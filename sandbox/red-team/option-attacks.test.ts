/**
 * Red Team Tests for @typesugar/fp Option Type
 *
 * Attack surface: Option<A> = A | null means Some(null) === None
 * This is a fundamental limitation of the zero-cost representation.
 */
import { describe, it, expect } from "vitest";
import * as Option from "@typesugar/fp/data/option";

describe("Option Type Safety Attacks", () => {
  // ==========================================================================
  // Attack 1: Option<null> collapses - can't distinguish Some(null) from None
  // ==========================================================================
  describe("Option<null> collapse", () => {
    it("Some(null) and None should be distinguishable (EXPECTED TO FAIL)", () => {
      // This is the fundamental issue with null-based Option
      const someNull: Option.Option<null> = Option.Some(null);
      const none: Option.Option<null> = Option.None;

      // These are the same at runtime!
      // TypeScript thinks they're different types, but runtime values are identical
      expect(someNull).not.toBe(none); // WILL FAIL - both are null
    });

    it("isSome type guard is unsound for Option<null>", () => {
      const opt: Option.Option<null> = Option.Some(null);

      // isSome returns false for Some(null) because null !== null is false
      // This breaks the type guard's promise
      if (Option.isSome(opt)) {
        // TypeScript thinks opt is `null` (the value) here
        // But we never enter this branch!
        expect(true).toBe(true);
      } else {
        // We incorrectly end up here
        expect("incorrectly treated as None").toBe("should be Some(null)");
      }
    });

    it("map on Some(null) behaves like None", () => {
      const opt: Option.Option<null> = Option.Some(null);
      let wasCalled = false;

      const mapped = Option.map(opt, (value) => {
        wasCalled = true;
        return "transformed";
      });

      // The map function should be called for Some(null), but it won't be
      // because the implementation checks `opt !== null`
      expect(wasCalled).toBe(true); // WILL FAIL
      expect(mapped).toBe("transformed"); // WILL FAIL - mapped is null
    });
  });

  // ==========================================================================
  // Attack 2: Option<A | null> - nested null types
  // ==========================================================================
  describe("Option with nullable inner type", () => {
    type MaybeNull = string | null;

    it("Option<string | null> - Some(null) vs None are indistinguishable", () => {
      // A legitimate use case: wrapping a nullable API response
      const validNull: Option.Option<MaybeNull> = Option.Some(null);
      const missing: Option.Option<MaybeNull> = Option.None;

      // Type says they're different, runtime says they're the same
      expect(Option.isSome(validNull)).toBe(true); // WILL FAIL
      expect(Option.isNone(missing)).toBe(true);

      // The distinction is lost!
      expect(validNull).toBe(missing); // Both are null at runtime
    });

    it("fold cannot distinguish Some(null) from None", () => {
      const opt: Option.Option<MaybeNull> = Option.Some(null);

      const result = Option.fold(
        opt,
        () => "was-none",
        (value) => `was-some: ${value}`
      );

      // Expected: "was-some: null"
      // Actual: "was-none"
      expect(result).toBe("was-some: null"); // WILL FAIL
    });

    it("getOrElse doesn't work correctly for Some(null)", () => {
      const opt: Option.Option<MaybeNull> = Option.Some(null);

      const value = Option.getOrElse(opt, () => "default");

      // Expected: null (the wrapped value)
      // Actual: "default" (because Some(null) looks like None)
      expect(value).toBeNull(); // WILL FAIL
    });
  });

  // ==========================================================================
  // Attack 3: Option<undefined> - undefined gets converted to null
  // ==========================================================================
  describe("Option<undefined> edge cases", () => {
    it("fromNullable converts undefined to null", () => {
      const undef = undefined;
      const opt = Option.fromNullable(undef);

      // undefined becomes null via fromNullable
      expect(opt).toBeNull(); // This is by design

      // But what about explicitly wrapping undefined?
      const explicitUndef: Option.Option<undefined> = Option.Some(undefined);

      // TypeScript thinks this is Some(undefined), but...
      // Some(x) just returns x, so this is `undefined`
      // And isSome checks `opt !== null`, so undefined passes!
      expect(Option.isSome(explicitUndef)).toBe(true); // This actually works!

      // But the type system says Option<undefined> = undefined | null
      // So `explicitUndef` has type `undefined | null` = `undefined`
    });

    it("Some(undefined) is distinguishable from None (unlike null)", () => {
      const someUndef: Option.Option<undefined> = Option.Some(undefined);
      const none: Option.Option<undefined> = Option.None;

      // undefined !== null, so this works!
      expect(someUndef).not.toBe(none);
      expect(Option.isSome(someUndef)).toBe(true);
      expect(Option.isNone(none)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: Type narrowing issues
  // ==========================================================================
  describe("Type narrowing edge cases", () => {
    it("isSome narrows to A, but A might include null", () => {
      type MaybeNull = string | null;
      const opt: Option.Option<MaybeNull> = Option.Some("hello");

      if (Option.isSome(opt)) {
        // TypeScript narrows to `string | null` here
        // But we know it's actually "hello" (a string)
        const value: MaybeNull = opt; // This is correctly typed

        // The issue is when opt was Some(null)
        // TypeScript would still narrow to `string | null`
        // But we'd never reach this branch for Some(null)!
      }
    });

    it("filter with predicate can cause type unsoundness", () => {
      const opt: Option.Option<number | null> = Option.Some(0);

      // filter(opt, predicate) returns null if predicate returns false
      const filtered = Option.filter(opt, (x) => x !== 0);

      // filtered is Option<number | null>, but we know it's None if x === 0
      expect(filtered).toBeNull();

      // Now what if the original was Some(null)?
      const optNull: Option.Option<number | null> = Option.Some(null);
      // This would be treated as None before we even get to the predicate!
    });
  });

  // ==========================================================================
  // Attack 5: Sequence/Traverse with nullable elements
  // ==========================================================================
  describe("sequence and traverse with nullable elements", () => {
    it("sequence treats null elements as None", () => {
      // Array of Option<number | null>
      const opts: Option.Option<number | null>[] = [
        Option.Some(1),
        Option.Some(null), // Looks like None!
        Option.Some(3),
      ];

      const sequenced = Option.sequence(opts);

      // Expected: Some([1, null, 3])
      // Actual: None (because Some(null) === null)
      expect(sequenced).not.toBeNull(); // WILL FAIL
    });

    it("traverse with function returning null is problematic", () => {
      const nums = [1, 2, 3, 4];

      const result = Option.traverse(
        nums,
        (n) => (n === 2 ? null : n) // Return null for 2, pretending it's "missing"
      );

      // This should return None because we returned null for 2
      expect(result).toBeNull();

      // But what if we wanted to return Some(null)?
      // We can't express that!
    });
  });

  // ==========================================================================
  // Attack 6: zip behavior with nullable types
  // ==========================================================================
  describe("zip edge cases", () => {
    it("zip with nullable produces unexpected results", () => {
      const a: Option.Option<string | null> = Option.Some(null);
      const b: Option.Option<number> = Option.Some(42);

      const zipped = Option.zip(a, b);

      // Expected: Some([null, 42])
      // Actual: None (because a looks like None)
      expect(zipped).not.toBeNull(); // WILL FAIL
    });
  });

  // ==========================================================================
  // Attack 7: Do-notation with nullable values
  // ==========================================================================
  describe("Do-notation edge cases", () => {
    it("bind treats Some(null) as None", () => {
      const result = Option.bind("x", () => Option.Some(null))(Option.Do);

      // Expected: Some({ x: null })
      // Actual: None
      expect(result).not.toBeNull(); // WILL FAIL
    });
  });
});

// ==========================================================================
// Document the known limitation
// ==========================================================================
describe("DOCUMENTATION: Known Limitations", () => {
  it("Option is null-based for zero-cost, so Option<null> is degenerate", () => {
    // This is by design. The alternative would be:
    // type Option<A> = { _tag: 'Some', value: A } | { _tag: 'None' }
    // But that has runtime overhead (object allocation, tag checking).

    // The workaround for users who need Option<null>:
    // Use a wrapper type or use undefined instead of null

    expect(true).toBe(true); // Documentation only
  });
});
