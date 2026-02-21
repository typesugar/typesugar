/**
 * Red Team Tests for @typesugar/fp Option Type
 *
 * Attack surface: Option<A> = A | null means Some(null) === None
 * This is a fundamental limitation of the zero-cost representation.
 */
import { describe, it, expect } from "vitest";
import * as Option from "../packages/fp/src/data/option.js";

describe("Option Type Safety Attacks", () => {
  // ==========================================================================
  // Fix 1: Option<null> now produces compile error, use Defined<T> instead
  // See Finding #1 in FINDINGS.md
  // ==========================================================================
  describe("Option<null> collapse prevention", () => {
    it("Option<Defined<null>> allows distinguishing Some(null) from None", () => {
      // FIXED: Use Defined<null> to wrap nullable values
      const someNull: Option.Option<Option.Defined<null>> = Option.Some(Option.defined(null));
      const none: Option.Option<Option.Defined<null>> = Option.None;

      // Now they're properly distinguishable!
      expect(someNull).not.toBe(none);
      expect(someNull).toEqual({ value: null });
      expect(none).toBeNull();
    });

    it("isSome works correctly with Option<Defined<null>>", () => {
      const opt: Option.Option<Option.Defined<null>> = Option.Some(Option.defined(null));

      // FIXED: isSome now correctly identifies the Some case
      if (Option.isSome(opt)) {
        // We correctly enter this branch
        expect(opt).toEqual({ value: null });
        expect(Option.unwrapDefined(opt)).toBeNull();
      } else {
        expect.fail("Should have entered the isSome branch");
      }
    });

    it("map works correctly with Option<Defined<null>>", () => {
      const opt: Option.Option<Option.Defined<null>> = Option.Some(Option.defined(null));
      let wasCalled = false;

      const mapped = Option.map(opt, (value) => {
        wasCalled = true;
        return "transformed";
      });

      // FIXED: The map function is now called correctly
      expect(wasCalled).toBe(true);
      expect(mapped).toBe("transformed");
    });

    // Type-level test - Option<null> produces compile error
    // Uncomment to verify: const bad: Option.Option<null> = null;
    // This would produce: "Option<A> where A includes null is unsound; use Option<Defined<A>> instead"
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

      // BUG: Type says they're different, runtime says they're the same
      expect(Option.isSome(validNull)).toBe(false); // Documents the bug
      expect(Option.isNone(missing)).toBe(true);

      // BUG: The distinction is lost!
      expect(validNull).toBe(missing); // Both are null at runtime
    });

    it("fold cannot distinguish Some(null) from None", () => {
      const opt: Option.Option<MaybeNull> = Option.Some(null);

      const result = Option.fold(
        opt,
        () => "was-none",
        (value) => `was-some: ${value}`
      );

      // BUG: Expected "was-some: null", but Some(null) looks like None
      // See Finding #1 in FINDINGS.md
      expect(result).toBe("was-none"); // Documents broken behavior
    });

    it("getOrElse doesn't work correctly for Some(null)", () => {
      const opt: Option.Option<MaybeNull> = Option.Some(null);

      const value = Option.getOrElse(opt, () => "default");

      // BUG: Expected null (the wrapped value)
      // Actual: "default" (because Some(null) looks like None)
      expect(value).toBe("default"); // Documents broken behavior
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

      // BUG: Expected Some([1, null, 3])
      // Actual: None (because Some(null) === null)
      expect(sequenced).toBeNull(); // Documents broken behavior
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

      // BUG: Expected Some([null, 42])
      // Actual: None (because a looks like None)
      expect(zipped).toBeNull(); // Documents broken behavior
    });
  });

  // ==========================================================================
  // Attack 7: Do-notation with nullable values
  // ==========================================================================
  describe("Do-notation edge cases", () => {
    it("bind treats Some(null) as None", () => {
      const result = Option.bind("x", () => Option.Some(null))(Option.Do);

      // BUG: Expected Some({ x: null })
      // Actual: None
      expect(result).toBeNull(); // Documents broken behavior
    });
  });
});

// ==========================================================================
// Document the design decisions
// ==========================================================================
describe("DOCUMENTATION: Option Design", () => {
  it("Option is null-based for zero-cost", () => {
    // This is by design. The alternative would be:
    // type Option<A> = { _tag: 'Some', value: A } | { _tag: 'None' }
    // But that has runtime overhead (object allocation, tag checking).

    expect(true).toBe(true); // Documentation only
  });

  it("Option<null> produces compile error, directing users to Defined<T>", () => {
    // FIXED: Option<A> now has a type-level constraint preventing A from including null.
    // Users who need to represent nullable values inside an Option use Defined<T>.
    //
    // This provides:
    // - Type safety: Can't accidentally create unsound Option<null | ...>
    // - Clear guidance: Compile error message explains what to do
    // - Escape hatch: Defined<T> allows the pattern when intentional

    const optNull: Option.Option<Option.Defined<null>> = Option.defined(null);
    expect(optNull).toEqual({ value: null });
    expect(Option.isSome(optNull)).toBe(true);
  });
});
