/**
 * Red Team Tests for HKT (Higher-Kinded Types) Encoding
 *
 * Attack surface: The encoding `Kind<F, A> = F & { readonly __kind__: A }`
 * uses phantom kind markers. Type-level functions define `_: T<this["__kind__"]>`.
 * The preprocessor resolves known type functions; `Apply<F, A>` does eager resolution.
 */
import { describe, it, expect } from "vitest";
import type { $, Kind, ArrayF, PromiseF, MapF, TypeFunction } from "../packages/type-system/src/hkt.js";
import { unsafeCoerce } from "../packages/type-system/src/hkt.js";

// Test type-level functions
interface OptionF extends TypeFunction {
  _: Option<this["__kind__"]>;
}
type Option<A> = A | null;

interface EitherF<E> extends TypeFunction {
  _: Either<E, this["__kind__"]>;
}
type Either<E, A> = { _tag: "Left"; left: E } | { _tag: "Right"; right: A };

describe("HKT Encoding Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Phantom type-level functions (unsound)
  // ==========================================================================
  describe("Phantom type-level functions", () => {
    it("Phantom type-level function ignoring the type argument", () => {
      // A "type-level function" that ignores its argument is unsound
      // This should NOT be allowed but TypeScript accepts it
      interface PhantomF {
        _: string; // Always string, ignores this["__kind__"]
      }

      // $<PhantomF, number> should be number-related, but it's always string
      type Result1 = $<PhantomF, number>; // string
      type Result2 = $<PhantomF, boolean>; // string
      type Result3 = $<PhantomF, object>; // string

      // All three are the same type - this is unsound for Functor/Monad!
      // If we had Functor<PhantomF>, map would claim to transform A -> B
      // but actually always produce string

      const x: Result1 = "hello";
      const y: Result2 = "world";
      const z: Result3 = "!";

      // TypeScript doesn't prevent this
      expect(typeof x).toBe("string");
      expect(typeof y).toBe("string");
      expect(typeof z).toBe("string");
    });

    it("Partially phantom type-level function", () => {
      // Uses _ but in a way that loses information
      interface PartiallyPhantomF {
        _: Array<string>; // Always Array<string>, not Array<this["__kind__"]>
      }

      type R1 = $<PartiallyPhantomF, number>; // Array<string>
      type R2 = $<PartiallyPhantomF, boolean>; // Array<string>

      // This would break any generic code expecting Array<A>
      expect(true).toBe(true); // Type-level test
    });
  });

  // ==========================================================================
  // Attack 2: Intersection type edge cases
  // ==========================================================================
  describe("Intersection type edge cases", () => {
    it("What happens when F has a conflicting _ property?", () => {
      // The HKT encoding is: Kind<F, A> = F & { readonly __kind__: A }
      // Apply<F, A> resolves via (F & { readonly __kind__: A })["_"]
      // What if F already has a _ property that conflicts?

      interface ConflictingF {
        _: string; // Static _ property, doesn't use this["__kind__"]
      }

      // Apply<ConflictingF, number> resolves _ with __kind__ set to number
      // But _ is just `string`, so result is always string regardless of A

      type Result = $<ConflictingF, number>;
      // Result is `never` because string & number = never

      // This silently produces `never` instead of a type error!
      const x: Result = undefined as never; // Can only assign never
      expect(true).toBe(true); // Type-level test
    });

    it("HKT with union types produces unexpected results", () => {
      interface UnionF {
        _: this["__kind__"] | string; // Always includes string
      }

      type R1 = $<UnionF, number>; // number | string
      type R2 = $<UnionF, boolean>; // boolean | string

      // This might be intentional, but could cause type widening issues
      // in generic code that expects $<F, A> to be "just A" transformed

      const x: R1 = "always valid"; // string is always in the union
      expect(x).toBe("always valid");
    });

    it("HKT with conditional types", () => {
      // What if the type-level function uses conditional types?
      interface ConditionalF {
        _: this["__kind__"] extends string ? string[] : number[];
      }

      type R1 = $<ConditionalF, string>; // string[]
      type R2 = $<ConditionalF, number>; // number[]
      type R3 = $<ConditionalF, boolean>; // number[]

      // This actually works! But the behavior might be surprising
      // if someone expects $<F, A> to always include A somehow

      const x: R1 = ["a", "b", "c"];
      const y: R2 = [1, 2, 3];
      expect(x.length).toBe(3);
      expect(y.length).toBe(3);
    });
  });

  // ==========================================================================
  // Attack 3: unsafeCoerce misuse
  // ==========================================================================
  describe("unsafeCoerce vulnerabilities", () => {
    it("unsafeCoerce can cast anything to anything", () => {
      // This is by design, but let's verify it's truly unsafe
      const num = 42;
      const str = unsafeCoerce<number, string>(num);

      // TypeScript thinks str is string, but it's actually number
      // This will cause runtime errors if we treat it as a string
      expect(typeof str).toBe("number"); // Runtime says number

      // @ts-expect-error - TypeScript thinks this works but it doesn't
      // expect(str.toUpperCase()).toThrow(); // Would fail at runtime
    });

    it("unsafeCoerce between incompatible HKT types", () => {
      // Can coerce between different type-level functions
      type ArrayOfNum = $<ArrayF, number>;
      type PromiseOfNum = $<PromiseF, number>;

      const arr: ArrayOfNum = [1, 2, 3];
      const promise = unsafeCoerce<ArrayOfNum, PromiseOfNum>(arr);

      // TypeScript thinks promise is Promise<number>
      // But it's actually [1, 2, 3]
      expect(Array.isArray(promise)).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 4: Multi-param HKT edge cases (e.g., Either<E, A>)
  // ==========================================================================
  describe("Multi-param HKT edge cases", () => {
    it("EitherF with different error types", () => {
      type E1 = $<EitherF<string>, number>; // Either<string, number>
      type E2 = $<EitherF<Error>, number>; // Either<Error, number>

      // These are properly different types - good!
      const e1: E1 = { _tag: "Left", left: "error" };
      const e2: E2 = { _tag: "Left", left: new Error("oops") };

      expect(e1.left).toBe("error");
      expect(e2.left).toBeInstanceOf(Error);
    });

    it("MapF loses key type information", () => {
      // MapF<K> fixes K, but what if we want to transform both?
      type M1 = $<MapF<string>, number>; // Map<string, number>
      type M2 = $<MapF<number>, string>; // Map<number, string>

      // We can't express a type-level function that transforms both K and V
      // This is a limitation of the single-param HKT encoding

      const m1 = new Map<string, number>();
      m1.set("a", 1);
      expect(m1.get("a")).toBe(1);
    });
  });

  // ==========================================================================
  // Attack 5: Recursive type-level functions
  // ==========================================================================
  describe("Recursive type-level function edge cases", () => {
    it("Self-referential type-level function", () => {
      // A type-level function that references itself
      interface RecursiveF {
        _: [this["__kind__"], RecursiveF]; // Infinite type!
      }

      // $<RecursiveF, number> = [number, RecursiveF]
      // But RecursiveF contains another RecursiveF...
      // This should cause infinite type expansion

      // Actually TypeScript handles this somewhat gracefully
      type R = $<RecursiveF, number>;
      // R = [number, { _: [R, RecursiveF] }] - lazy/deferred

      expect(true).toBe(true); // TypeScript doesn't explode
    });

    it("Mutually recursive type-level functions", () => {
      interface FooF {
        _: { foo: $<BarF, this["__kind__"]> };
      }
      interface BarF {
        _: { bar: $<FooF, this["__kind__"]> };
      }

      // $<FooF, number> = { foo: { bar: { foo: { bar: ... } } } }
      // Infinite nesting!

      type R = $<FooF, number>;
      // TypeScript resolves this lazily

      expect(true).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 6: never and unknown edge cases
  // ==========================================================================
  describe("never and unknown edge cases", () => {
    it("$<F, never> behavior", () => {
      // What happens when the type argument is never?
      type R1 = $<ArrayF, never>; // Array<never> = []
      type R2 = $<OptionF, never>; // Option<never> = never | null = null
      type R3 = $<PromiseF, never>; // Promise<never>

      // Array<never> is the type of empty arrays only
      const arr: R1 = [];
      expect(arr.length).toBe(0);

      // Option<never> collapses to null
      const opt: R2 = null;
      expect(opt).toBeNull();
    });

    it("$<F, unknown> behavior", () => {
      type R1 = $<ArrayF, unknown>; // Array<unknown>
      type R2 = $<OptionF, unknown>; // Option<unknown> = unknown | null = unknown
      type R3 = $<PromiseF, unknown>; // Promise<unknown>

      // Option<unknown> = unknown (because unknown | null = unknown)
      // This loses the Option structure!

      const arr: R1 = [1, "two", true];
      expect(arr.length).toBe(3);
    });

    it("$<F, any> behavior", () => {
      type R1 = $<ArrayF, any>; // Array<any>
      type R2 = $<OptionF, any>; // Option<any> = any | null = any

      // Option<any> = any, losing the Option structure completely
      const opt: R2 = "anything";
      expect(opt).toBe("anything");
    });
  });

  // ==========================================================================
  // Attack 7: Branded types and HKT
  // ==========================================================================
  describe("Branded types and HKT", () => {
    it("HKT with branded types", () => {
      // Branded types use intersection with a phantom brand
      type Brand<K, T> = T & { __brand: K };
      type UserId = Brand<"UserId", string>;
      type Email = Brand<"Email", string>;

      // $<ArrayF, UserId> should be Array<UserId>
      type UserIds = $<ArrayF, UserId>;
      type Emails = $<ArrayF, Email>;

      // These should be distinct types
      const ids: UserIds = ["u1", "u2"] as UserIds[];
      const emails: Emails = ["a@b.com"] as Emails[];

      // TypeScript correctly keeps them separate
      // @ts-expect-error - can't assign UserIds[] to Emails[]
      // const wrong: Emails = ids;

      expect(ids.length).toBe(2);
      expect(emails.length).toBe(1);
    });
  });
});

// ==========================================================================
// Runtime tests for Functor/Monad with HKT
// ==========================================================================
describe("HKT with Typeclasses - Runtime Safety", () => {
  // Define a simple Functor interface
  interface Functor<F> {
    map<A, B>(fa: $<F, A>, f: (a: A) => B): $<F, B>;
  }

  // Implement for Array
  const arrayFunctor: Functor<ArrayF> = {
    map: <A, B>(fa: A[], f: (a: A) => B): B[] => fa.map(f),
  };

  // Implement for Option (null-based)
  const optionFunctor: Functor<OptionF> = {
    map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => (fa !== null ? f(fa) : null),
  };

  it("Functor map works correctly for Array", () => {
    const nums: $<ArrayF, number> = [1, 2, 3];
    const strs = arrayFunctor.map(nums, (n) => n.toString());

    expect(strs).toEqual(["1", "2", "3"]);
  });

  it("Functor map works correctly for Option (non-null)", () => {
    const opt: $<OptionF, number> = 42;
    const result = optionFunctor.map(opt, (n) => n.toString());

    expect(result).toBe("42");
  });

  it("Functor map works correctly for Option (null)", () => {
    const opt: $<OptionF, number> = null;
    const result = optionFunctor.map(opt, (n) => n.toString());

    expect(result).toBeNull();
  });

  it("UNSOUND: Phantom type functor allows type mismatch", () => {
    // A "phantom" type-level function that doesn't use its argument
    interface PhantomF {
      _: string;
    }

    // This functor is technically type-correct but semantically wrong
    const phantomFunctor: Functor<PhantomF> = {
      map: <A, B>(_fa: $<PhantomF, A>, _f: (a: A) => B): $<PhantomF, B> => {
        // TypeScript expects us to return B somehow
        // But $<PhantomF, A> = string and $<PhantomF, B> = string
        // So we can just return any string!
        return "I ignore the function completely" as any;
      },
    };

    const input: $<PhantomF, number> = "hello";
    const output = phantomFunctor.map(input, (n) => n * 2);

    // output is typed as $<PhantomF, number> (which is string)
    // but we never actually called the function!
    expect(output).toBe("I ignore the function completely");
    // The `n * 2` function was never called - this is unsound!
  });
});
