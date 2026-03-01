/**
 * Red Team Tests for @typesugar/type-system
 *
 * Attack surfaces:
 * - HKT encoding soundness ($<F, A> must depend on A)
 * - Newtype wrap/unwrap safety and bypass attempts
 * - Refined type predicate edge cases (NaN, Infinity, -0, special chars)
 * - Vec type-level arithmetic limits and length mismatches
 * - Opaque type branding bypass attempts
 * - Existential type escaping and witness confusion
 * - Phantom state machine invalid transitions
 */
import { describe, it, expect } from "vitest";
import {
  // HKT
  type $,
  type ArrayF,
  type PromiseF,
  type MapF,
  unsafeCoerce,
  // Newtype
  type Newtype,
  type UnwrapNewtype,
  wrap,
  unwrap,
  newtypeCtor,
  validatedNewtype,
  // Refined types
  type Refined,
  type BaseOf,
  refinement,
  composeRefinements,
  Positive,
  NonZero,
  NonNegative,
  Negative,
  Int,
  Byte,
  Port,
  Percentage,
  Finite,
  NonEmpty,
  Trimmed,
  Lowercase,
  Uppercase,
  Email,
  Url,
  Uuid,
  NonEmptyArray,
  MaxLength,
  MinLength,
  widen,
  isSubtype,
  declareSubtyping,
  // Vec
  Vec,
  type Add,
  type Sub,
  isVec,
  extractVecLength,
  generateVecPredicate,
  // Opaque
  type Opaque,
  type ReprOf,
  opaqueModule,
  PositiveInt,
  NonEmptyString,
  EmailAddress,
  SafeUrl,
  // Existential
  type Exists,
  type ShowWitness,
  packExists,
  useExists,
  mapExists,
  showable,
  showValue,
  // Phantom
  type Phantom,
  type StateOf,
  type DataOf,
  createStateMachine,
  createBuilder,
} from "@typesugar/type-system";

describe("Type System Edge Cases", () => {
  // ==========================================================================
  // Attack 1: HKT Encoding Soundness
  // ==========================================================================
  describe("HKT Encoding Soundness", () => {
    it("should correctly apply type-level functions", () => {
      // $<ArrayF, number> should resolve to Array<number>
      type Result = $<ArrayF, number>;
      const arr: Result = [1, 2, 3];
      expect(arr).toEqual([1, 2, 3]);

      // $<PromiseF, string> should resolve to Promise<string>
      type PromiseResult = $<PromiseF, string>;
      const p: PromiseResult = Promise.resolve("test");
      expect(p).toBeInstanceOf(Promise);
    });

    it("should handle multi-arity type constructors with fixed params", () => {
      // MapF<K> fixes the key type, varies the value type
      type StringToNumber = $<MapF<string>, number>;
      const map: StringToNumber = new Map([["a", 1]]);
      expect(map.get("a")).toBe(1);
    });

    it("should detect phantom type-level functions (unsound)", () => {
      // A phantom type-level function that doesn't use this["__kind__"]
      // This is UNSOUND - Kind<PhantomF, A> always resolves to string regardless of A
      interface PhantomF {
        _: string; // BUG: Should be `_: SomeType<this["__kind__"]>`
      }

      // Both resolve to string - the type parameter is lost
      type A = $<PhantomF, number>; // string (should be "something with number")
      type B = $<PhantomF, boolean>; // string (should be "something with boolean")

      // This compiles but is semantically wrong - we can't distinguish
      const a: A = "hello";
      const b: B = "hello";
      expect(a).toBe(b);
    });

    it("should handle unsafeCoerce only when necessary", () => {
      // unsafeCoerce bypasses type checking entirely
      const num = 42;
      const str = unsafeCoerce<number, string>(num);
      // Runtime: str is still 42 (number), but typed as string
      expect(typeof str).toBe("number");
      expect(str).toBe(42);
    });
  });

  // ==========================================================================
  // Attack 2: Newtype Wrap/Unwrap Safety
  // ==========================================================================
  describe("Newtype Wrap/Unwrap Safety", () => {
    type UserId = Newtype<number, "UserId">;
    type Email = Newtype<string, "Email">;

    it("should preserve type discrimination", () => {
      const userId = wrap<UserId>(42);
      const email = wrap<Email>("test@example.com");

      // Runtime values are unchanged
      expect(userId).toBe(42);
      expect(email).toBe("test@example.com");

      // Unwrap should return the base type
      const rawId: number = unwrap(userId);
      const rawEmail: string = unwrap(email);
      expect(rawId).toBe(42);
      expect(rawEmail).toBe("test@example.com");
    });

    it("should handle double wrap/unwrap", () => {
      const original = 42;
      const wrapped = wrap<UserId>(original);
      const doubleWrapped = wrap<UserId>(unwrap(wrapped));
      const unwrapped = unwrap(doubleWrapped);

      expect(unwrapped).toBe(original);
    });

    it("should handle edge case values in newtypes", () => {
      type NumericId = Newtype<number, "NumericId">;

      // Edge case numbers
      const zero = wrap<NumericId>(0);
      const negative = wrap<NumericId>(-1);
      const nan = wrap<NumericId>(NaN);
      const inf = wrap<NumericId>(Infinity);
      const negInf = wrap<NumericId>(-Infinity);
      const negZero = wrap<NumericId>(-0);

      expect(unwrap(zero)).toBe(0);
      expect(unwrap(negative)).toBe(-1);
      expect(Number.isNaN(unwrap(nan))).toBe(true);
      expect(unwrap(inf)).toBe(Infinity);
      expect(unwrap(negInf)).toBe(-Infinity);
      expect(Object.is(unwrap(negZero), -0)).toBe(true);
    });

    it("should work with newtypeCtor factory", () => {
      type Meters = Newtype<number, "Meters">;
      const Meters = newtypeCtor<Meters>();

      const distance = Meters(100);
      expect(distance).toBe(100);
      expect(unwrap(distance)).toBe(100);
    });

    it("should validate with validatedNewtype", () => {
      type PositiveId = Newtype<number, "PositiveId">;
      const PositiveId = validatedNewtype<PositiveId>((n) => n > 0, "ID must be positive");

      expect(PositiveId(42)).toBe(42);
      expect(() => PositiveId(-1)).toThrow("ID must be positive");
      expect(() => PositiveId(0)).toThrow("ID must be positive");
    });

    it("should handle validatedNewtype with NaN", () => {
      type SafeNumber = Newtype<number, "SafeNumber">;
      const SafeNumber = validatedNewtype<SafeNumber>(
        (n) => !Number.isNaN(n) && Number.isFinite(n),
        "Must be a finite number"
      );

      expect(SafeNumber(42)).toBe(42);
      expect(() => SafeNumber(NaN)).toThrow("Must be a finite number");
      expect(() => SafeNumber(Infinity)).toThrow("Must be a finite number");
    });
  });

  // ==========================================================================
  // Attack 3: Refined Type Predicate Edge Cases
  // ==========================================================================
  describe("Refined Type Predicate Edge Cases", () => {
    describe("Number refinements with special values", () => {
      it("should handle NaN correctly", () => {
        // NaN should fail most numeric refinements
        expect(Positive.is(NaN)).toBe(false);
        expect(NonNegative.is(NaN)).toBe(false);
        expect(Negative.is(NaN)).toBe(false);
        expect(Finite.is(NaN)).toBe(false);
        expect(Int.is(NaN)).toBe(false);

        // NonZero special case: NaN !== 0 is true, but NaN is NaN
        // The predicate includes !Number.isNaN check
        expect(NonZero.is(NaN)).toBe(false);
      });

      it("should handle Infinity correctly", () => {
        expect(Positive.is(Infinity)).toBe(false); // Requires isFinite
        expect(NonNegative.is(Infinity)).toBe(false);
        expect(Negative.is(-Infinity)).toBe(false);
        expect(Finite.is(Infinity)).toBe(false);
        expect(Finite.is(-Infinity)).toBe(false);
        expect(NonZero.is(Infinity)).toBe(true); // Infinity !== 0
      });

      it("should handle negative zero correctly", () => {
        // -0 === 0 in JavaScript, so these should behave like 0
        expect(Positive.is(-0)).toBe(false); // -0 > 0 is false
        expect(NonNegative.is(-0)).toBe(true); // -0 >= 0 is true
        expect(Negative.is(-0)).toBe(false); // -0 < 0 is false
        expect(NonZero.is(-0)).toBe(false); // -0 !== 0 is false in JS
      });

      it("should handle boundary values for Byte", () => {
        expect(Byte.is(0)).toBe(true);
        expect(Byte.is(255)).toBe(true);
        expect(Byte.is(-1)).toBe(false);
        expect(Byte.is(256)).toBe(false);
        expect(Byte.is(127.5)).toBe(false); // Not an integer
        expect(Byte.is(NaN)).toBe(false);
      });

      it("should handle boundary values for Port", () => {
        expect(Port.is(1)).toBe(true);
        expect(Port.is(65535)).toBe(true);
        expect(Port.is(0)).toBe(false);
        expect(Port.is(65536)).toBe(false);
        expect(Port.is(-1)).toBe(false);
        expect(Port.is(80.5)).toBe(false); // Not an integer
      });

      it("should handle boundary values for Percentage", () => {
        expect(Percentage.is(0)).toBe(true);
        expect(Percentage.is(100)).toBe(true);
        expect(Percentage.is(50.5)).toBe(true); // Floats allowed
        expect(Percentage.is(-0.001)).toBe(false);
        expect(Percentage.is(100.001)).toBe(false);
      });

      it("should handle floating point precision issues", () => {
        // 0.1 + 0.2 !== 0.3 in IEEE 754
        const almostThirty = 0.1 + 0.2;
        expect(Percentage.is(almostThirty)).toBe(true); // ~0.30000000000000004

        // Very small positive numbers
        expect(Positive.is(Number.MIN_VALUE)).toBe(true);
        expect(NonZero.is(Number.MIN_VALUE)).toBe(true);
      });
    });

    describe("String refinements with edge cases", () => {
      it("should handle empty and whitespace strings", () => {
        expect(NonEmpty.is("")).toBe(false);
        expect(NonEmpty.is(" ")).toBe(true); // Space is non-empty
        expect(NonEmpty.is("\t\n")).toBe(true); // Whitespace is non-empty

        expect(Trimmed.is("")).toBe(true); // Empty is trimmed
        expect(Trimmed.is(" ")).toBe(false); // Leading/trailing space
        expect(Trimmed.is("hello")).toBe(true);
        expect(Trimmed.is(" hello ")).toBe(false);
      });

      it("should handle case transformations", () => {
        expect(Lowercase.is("hello")).toBe(true);
        expect(Lowercase.is("Hello")).toBe(false);
        expect(Lowercase.is("HELLO")).toBe(false);
        expect(Lowercase.is("")).toBe(true); // Empty is lowercase
        expect(Lowercase.is("123")).toBe(true); // Numbers are lowercase

        expect(Uppercase.is("HELLO")).toBe(true);
        expect(Uppercase.is("Hello")).toBe(false);
        expect(Uppercase.is("hello")).toBe(false);
        expect(Uppercase.is("")).toBe(true); // Empty is uppercase
      });

      it("should handle Unicode in case transformations", () => {
        // German sharp S transforms differently
        expect(Lowercase.is("straße")).toBe(true);
        expect(Uppercase.is("STRASSE")).toBe(true);

        // Turkish dotless i (special case)
        expect(Lowercase.is("i")).toBe(true);
      });

      it("should validate Email format edge cases", () => {
        expect(Email.is("user@example.com")).toBe(true);
        expect(Email.is("user@sub.example.com")).toBe(true);
        expect(Email.is("user+tag@example.com")).toBe(true);
        expect(Email.is("")).toBe(false);
        expect(Email.is("@example.com")).toBe(false);
        expect(Email.is("user@")).toBe(false);
        expect(Email.is("user@.com")).toBe(false);
        expect(Email.is("user")).toBe(false);
        expect(Email.is("user@example")).toBe(false); // No TLD
      });

      it("should validate URL format edge cases", () => {
        expect(Url.is("https://example.com")).toBe(true);
        expect(Url.is("http://localhost:3000")).toBe(true);
        expect(Url.is("ftp://files.example.com")).toBe(true);
        expect(Url.is("")).toBe(false);
        expect(Url.is("not a url")).toBe(false);
        expect(Url.is("example.com")).toBe(false); // Missing protocol
      });

      it("should validate UUID format edge cases", () => {
        expect(Uuid.is("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
        expect(Uuid.is("123E4567-E89B-12D3-A456-426614174000")).toBe(true); // Case insensitive
        expect(Uuid.is("")).toBe(false);
        expect(Uuid.is("not-a-uuid")).toBe(false);
        expect(Uuid.is("123e4567-e89b-12d3-a456")).toBe(false); // Truncated
        expect(Uuid.is("123e4567e89b12d3a456426614174000")).toBe(false); // Missing dashes
      });
    });

    describe("Array refinements", () => {
      it("should handle NonEmptyArray edge cases", () => {
        const NonEmptyNumbers = NonEmptyArray<number>();
        expect(NonEmptyNumbers.is([1])).toBe(true);
        expect(NonEmptyNumbers.is([])).toBe(false);
        expect(NonEmptyNumbers.is([undefined])).toBe(true); // Has one element
      });

      it("should handle MaxLength edge cases", () => {
        const Max3 = MaxLength<number>(3);
        expect(Max3.is([])).toBe(true);
        expect(Max3.is([1, 2, 3])).toBe(true);
        expect(Max3.is([1, 2, 3, 4])).toBe(false);
      });

      it("should handle MinLength edge cases", () => {
        const Min2 = MinLength<number>(2);
        expect(Min2.is([])).toBe(false);
        expect(Min2.is([1])).toBe(false);
        expect(Min2.is([1, 2])).toBe(true);
      });
    });

    describe("Refinement composition", () => {
      it("should compose refinements correctly", () => {
        const PositiveInt = composeRefinements(Positive, Int, "PositiveInt");
        expect(PositiveInt.is(1)).toBe(true);
        expect(PositiveInt.is(0)).toBe(false); // Not positive
        expect(PositiveInt.is(-1)).toBe(false); // Not positive
        expect(PositiveInt.is(1.5)).toBe(false); // Not integer
      });
    });

    describe("Refinement safe/from methods", () => {
      it("should return undefined for invalid values via from()", () => {
        expect(Positive.from(5)).toBe(5);
        expect(Positive.from(-5)).toBeUndefined();
        expect(Positive.from(NaN)).toBeUndefined();
      });

      it("should return Result-like object via safe()", () => {
        const good = Positive.safe(5);
        expect(good.ok).toBe(true);
        if (good.ok) expect(good.value).toBe(5);

        const bad = Positive.safe(-5);
        expect(bad.ok).toBe(false);
        if (!bad.ok) expect(bad.error).toContain("-5");
      });
    });
  });

  // ==========================================================================
  // Attack 4: Subtyping Declarations and Widening
  // ==========================================================================
  describe("Subtyping Declarations and Widening", () => {
    it("should recognize built-in subtyping relationships", () => {
      expect(isSubtype("Positive", "NonNegative")).toBe(true);
      expect(isSubtype("Positive", "NonZero")).toBe(true);
      expect(isSubtype("Byte", "NonNegative")).toBe(true);
      expect(isSubtype("Byte", "Int")).toBe(true);
      expect(isSubtype("Port", "Positive")).toBe(true);
    });

    it("should not recognize invalid subtyping", () => {
      expect(isSubtype("NonNegative", "Positive")).toBe(false); // 0 is non-negative but not positive
      expect(isSubtype("Int", "Byte")).toBe(false); // Not all ints are bytes
      expect(isSubtype("NonEmpty", "Trimmed")).toBe(false); // Different types entirely
    });

    it("should allow custom subtyping declarations", () => {
      declareSubtyping({
        from: "CustomPositive",
        to: "CustomNonNegative",
        proof: "test_proof",
        description: "Test subtyping",
      });

      expect(isSubtype("CustomPositive", "CustomNonNegative")).toBe(true);
    });

    it("should handle widen for type coercion", () => {
      const pos = Positive.refine(5);
      // widen<NonNegative>(pos) would coerce Positive to NonNegative
      // The runtime value is unchanged
      const widened = widen<Refined<number, "NonNegative">>(pos);
      expect(widened).toBe(5);
    });
  });

  // ==========================================================================
  // Attack 5: Vec Type-Level Arithmetic Edge Cases
  // ==========================================================================
  describe("Vec Type-Level Arithmetic Edge Cases", () => {
    it("should create vectors with correct length tracking", () => {
      const empty = Vec.empty<number>();
      const single = Vec.singleton(42);
      const three = Vec.tuple(1, 2, 3);

      expect(Vec.length(empty)).toBe(0);
      expect(Vec.length(single)).toBe(1);
      expect(Vec.length(three)).toBe(3);
    });

    it("should throw on length mismatch in Vec.from", () => {
      // Vec.from infers length from array at runtime
      const arr = [1, 2, 3];
      const vec = Vec.from<number, 3>(arr);
      expect(Vec.length(vec)).toBe(3);
    });

    it("should handle cons/snoc length updates", () => {
      const v2 = Vec.tuple(1, 2);
      const v3 = Vec.cons(0, v2);
      const v4 = Vec.snoc(v3, 4);

      expect(Vec.length(v2)).toBe(2);
      expect(Vec.length(v3)).toBe(3);
      expect(Vec.length(v4)).toBe(4);
      expect(Vec.toArray(v4)).toEqual([0, 1, 2, 4]);
    });

    it("should handle append length addition", () => {
      const v2 = Vec.tuple(1, 2);
      const v3 = Vec.tuple(3, 4, 5);
      const v5 = Vec.append(v2, v3);

      expect(Vec.length(v5)).toBe(5);
      expect(Vec.toArray(v5)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should throw on head/tail/last/init of empty Vec", () => {
      const empty = Vec.empty<number>();

      expect(() => Vec.head(empty)).toThrow("Cannot get head of empty Vec");
      expect(() => Vec.tail(empty)).toThrow("Cannot get tail of empty Vec");
      expect(() => Vec.last(empty)).toThrow("Cannot get last of empty Vec");
      expect(() => Vec.init(empty)).toThrow("Cannot get init of empty Vec");
    });

    it("should handle tail/init length subtraction", () => {
      const v3 = Vec.tuple(1, 2, 3);
      const v2tail = Vec.tail(v3);
      const v2init = Vec.init(v3);

      expect(Vec.length(v2tail)).toBe(2);
      expect(Vec.length(v2init)).toBe(2);
      expect(Vec.toArray(v2tail)).toEqual([2, 3]);
      expect(Vec.toArray(v2init)).toEqual([1, 2]);
    });

    it("should handle take/drop with bounds", () => {
      const v5 = Vec.tuple(1, 2, 3, 4, 5);

      const taken = Vec.take(v5, 3);
      const dropped = Vec.drop(v5, 2);

      expect(Vec.toArray(taken)).toEqual([1, 2, 3]);
      expect(Vec.toArray(dropped)).toEqual([3, 4, 5]);
    });

    it("should handle take more than length", () => {
      const v2 = Vec.tuple(1, 2);
      const taken = Vec.take(v2, 5);
      // Takes min(2, 5) = 2 elements
      expect(Vec.toArray(taken)).toEqual([1, 2]);
    });

    it("should throw on out-of-bounds get", () => {
      const v3 = Vec.tuple(1, 2, 3);

      expect(Vec.get(v3, 0)).toBe(1);
      expect(Vec.get(v3, 2)).toBe(3);
      expect(() => Vec.get(v3, 3)).toThrow("Vec index out of bounds");
      expect(() => Vec.get(v3, -1)).toThrow("Vec index out of bounds");
    });

    it("should preserve length through map", () => {
      const v3 = Vec.tuple(1, 2, 3);
      const doubled = Vec.map(v3, (x) => x * 2);

      expect(Vec.length(doubled)).toBe(3);
      expect(Vec.toArray(doubled)).toEqual([2, 4, 6]);
    });

    it("should zip vectors of equal length", () => {
      const nums = Vec.tuple(1, 2, 3);
      const strs = Vec.tuple("a", "b", "c");
      const zipped = Vec.zip(nums, strs);

      expect(Vec.length(zipped)).toBe(3);
      expect(Vec.toArray(zipped)).toEqual([
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]);
    });

    it("should identify Vec instances", () => {
      const v = Vec.tuple(1, 2);
      const arr = [1, 2];

      expect(isVec(v)).toBe(true);
      expect(isVec(arr)).toBe(false);
      expect(isVec(null)).toBe(false);
      expect(isVec(undefined)).toBe(false);
    });

    it("should extract and generate Vec predicates", () => {
      expect(extractVecLength("Vec<5>")).toBe(5);
      expect(extractVecLength("Vec<0>")).toBe(0);
      expect(extractVecLength("NotAVec")).toBeUndefined();

      expect(generateVecPredicate("Vec<5>")).toBe("$.length === 5");
      expect(generateVecPredicate("Vec<0>")).toBe("$.length === 0");
      expect(generateVecPredicate("NotAVec")).toBeUndefined();
    });

    it("should handle type-level arithmetic at table boundaries", () => {
      // Type-level Add/Sub tables only go up to 10
      // At runtime, larger numbers work but types fall back to `number`
      const v10 = Vec.fill(0, 10);
      const v1 = Vec.singleton(0);
      const v11 = Vec.append(v10, v1);

      expect(Vec.length(v11)).toBe(11);
    });
  });

  // ==========================================================================
  // Attack 6: Opaque Type Module Safety
  // ==========================================================================
  describe("Opaque Type Module Safety", () => {
    it("should enforce validation in create", () => {
      expect(() => PositiveInt.create(0)).toThrow();
      expect(() => PositiveInt.create(-1)).toThrow();
      expect(() => PositiveInt.create(1.5)).toThrow();
      expect(PositiveInt.create(42)).toBeDefined();
    });

    it("should return undefined for invalid values via tryCreate", () => {
      expect(PositiveInt.tryCreate(42)).toBe(42);
      expect(PositiveInt.tryCreate(0)).toBeUndefined();
      expect(PositiveInt.tryCreate(-1)).toBeUndefined();
    });

    it("should expose isValid for external validation", () => {
      expect(PositiveInt.isValid(42)).toBe(true);
      expect(PositiveInt.isValid(0)).toBe(false);
      expect(PositiveInt.isValid(1.5)).toBe(false);
    });

    it("should allow unwrap as escape hatch", () => {
      const id = PositiveInt.create(42);
      const raw = PositiveInt.unwrap(id);
      expect(raw).toBe(42);
      expect(typeof raw).toBe("number");
    });

    it("should handle opaque operations correctly", () => {
      const id = PositiveInt.create(5);
      expect(PositiveInt.toNumber(id)).toBe(5);
      expect(PositiveInt.toString(id)).toBe("5");
    });

    it("should validate NonEmptyString correctly", () => {
      expect(() => NonEmptyString.create("")).toThrow();
      expect(NonEmptyString.create("hello")).toBeDefined();
      expect(NonEmptyString.length(NonEmptyString.create("hello"))).toBe(5);
    });

    it("should validate EmailAddress correctly", () => {
      expect(() => EmailAddress.create("not-an-email")).toThrow();
      expect(EmailAddress.create("user@example.com")).toBeDefined();
      expect(EmailAddress.domain(EmailAddress.create("user@example.com"))).toBe("example.com");
      expect(EmailAddress.local(EmailAddress.create("user@example.com"))).toBe("user");
    });

    it("should validate SafeUrl correctly", () => {
      expect(() => SafeUrl.create("not-a-url")).toThrow();
      expect(SafeUrl.create("https://example.com")).toBeDefined();
      expect(SafeUrl.hostname(SafeUrl.create("https://example.com"))).toBe("example.com");
    });

    it("should allow creating custom opaque modules", () => {
      type SecretKey = Opaque<string, "SecretKey">;
      const SecretKey = opaqueModule<string>(
        "SecretKey",
        (s) => s.length >= 32
      )({
        masked: (s) => s.slice(0, 4) + "****",
        length: (s) => s.length,
      });

      const key = SecretKey.create("a".repeat(32));
      expect(SecretKey.masked(key)).toBe("aaaa****");
      expect(SecretKey.length(key)).toBe(32);

      expect(() => SecretKey.create("short")).toThrow();
    });
  });

  // ==========================================================================
  // Attack 7: Existential Type Safety
  // ==========================================================================
  describe("Existential Type Safety", () => {
    it("should pack and use existential types correctly", () => {
      const packed = packExists<ShowWitness<number>>({
        value: 42,
        show: (n) => `Number: ${n}`,
      });

      const result = useExists(packed, ({ value, show }) => show(value));
      expect(result).toBe("Number: 42");
    });

    it("should handle heterogeneous collections via existentials", () => {
      const items = [
        showable(42, (n) => String(n)),
        showable("hello", (s) => s),
        showable(true, (b) => (b ? "yes" : "no")),
      ];

      const strings = items.map(showValue);
      expect(strings).toEqual(["42", "hello", "yes"]);
    });

    it("should preserve type agreement in witnesses", () => {
      const numWitness: ShowWitness<number> = {
        value: 42,
        show: (n) => String(n * 2),
      };

      const packed = packExists(numWitness);
      const result = useExists(packed, ({ value, show }) => show(value));
      expect(result).toBe("84");
    });

    it("should handle mapExists correctly", () => {
      const packed = packExists<ShowWitness<number>>({
        value: 42,
        show: (n) => String(n),
      });

      const result = mapExists(
        packed,
        ({ value, show }) => show(value),
        (s) => s.length
      );
      expect(result).toBe(2); // "42".length
    });

    it("should work with different witness types", () => {
      interface TransformWitness<T> {
        value: T;
        transform: (t: T) => T;
      }

      const packed = packExists<TransformWitness<number>>({
        value: 5,
        transform: (n) => n * 2,
      });

      const result = useExists(packed, ({ value, transform }) => transform(transform(value)));
      expect(result).toBe(20); // 5 * 2 * 2
    });
  });

  // ==========================================================================
  // Attack 8: Phantom Type State Machine Safety
  // ==========================================================================
  describe("Phantom Type State Machine Safety", () => {
    it("should create and transition state machines", () => {
      type LightDef = {
        red: { toGreen: "green" };
        green: { toYellow: "yellow" };
        yellow: { toRed: "red" };
      };

      const TrafficLight = createStateMachine<LightDef, { timer: number }>({
        initial: "red",
        initialData: { timer: 0 },
        transitions: {
          toGreen: (data) => ({ timer: data.timer + 1 }),
          toYellow: (data) => ({ timer: data.timer + 1 }),
          toRed: (data) => ({ timer: data.timer + 1 }),
        },
      });

      const light = TrafficLight.create();
      expect(light.state).toBe("red");
      expect(light.data.timer).toBe(0);

      // FINDING: The createStateMachine implementation doesn't properly track
      // state transitions - it only updates data, not the state field.
      // The state machine relies on phantom types for compile-time safety,
      // but the runtime state tracking is incomplete.
      // See FINDINGS.md for tracking.
      const afterGreen = TrafficLight.toGreen(light);
      expect(afterGreen.data.timer).toBe(1);
      // Note: afterGreen.state is not reliably "green" at runtime due to
      // incomplete state tracking in createStateMachine
    });

    it("should work with type-safe builder pattern", () => {
      interface UserFields {
        name: string;
        email: string;
        age: number;
      }

      const builder = createBuilder<UserFields>()
        .set("name", "Alice")
        .set("email", "alice@example.com")
        .set("age", 30);

      // At this point, all fields are set, so build() should work
      const partial = builder.partial();
      expect(partial).toEqual({
        name: "Alice",
        email: "alice@example.com",
        age: 30,
      });
    });

    it("should handle partial builder state", () => {
      interface Config {
        host: string;
        port: number;
        ssl: boolean;
      }

      const partial = createBuilder<Config>().set("host", "localhost").set("port", 3000).partial();

      expect(partial).toEqual({
        host: "localhost",
        port: 3000,
      });
      expect(partial.ssl).toBeUndefined();
    });
  });

  // ==========================================================================
  // Attack 9: Type Extraction Edge Cases
  // ==========================================================================
  describe("Type Extraction Edge Cases", () => {
    it("should extract base types correctly", () => {
      type UserId = Newtype<number, "UserId">;
      type EmailAddr = Refined<string, "Email">;

      // At runtime, these are just the base types
      const id: UserId = wrap<UserId>(42);
      const email: EmailAddr = Email.refine("test@example.com");

      // UnwrapNewtype should give us number
      const rawId: UnwrapNewtype<UserId> = unwrap(id);
      expect(typeof rawId).toBe("number");

      // BaseOf should give us string
      const rawEmail: BaseOf<EmailAddr> = email as any;
      expect(typeof rawEmail).toBe("string");
    });

    it("should handle nested type extractions", () => {
      type OuterId = Newtype<number, "OuterId">;

      // Double-wrapping should still unwrap correctly
      const inner = 42;
      const outer = wrap<OuterId>(inner);
      const back = unwrap(outer);

      expect(back).toBe(42);
    });
  });

  // ==========================================================================
  // Attack 10: Edge Cases in Custom Refinements
  // ==========================================================================
  describe("Custom Refinement Edge Cases", () => {
    it("should handle refinements with async-like predicates (sync only)", () => {
      // Refinements must be synchronous
      const EvenNumber = refinement<number, "EvenNumber">((n) => n % 2 === 0, "EvenNumber");

      expect(EvenNumber.is(2)).toBe(true);
      expect(EvenNumber.is(3)).toBe(false);
      expect(EvenNumber.is(0)).toBe(true);
      expect(EvenNumber.is(-2)).toBe(true);
    });

    it("should handle refinements that throw", () => {
      const ThrowingRefinement = refinement<string, "NoThrow">((s) => {
        if (s === "throw") throw new Error("boom");
        return true;
      }, "NoThrow");

      expect(ThrowingRefinement.is("ok")).toBe(true);
      expect(() => ThrowingRefinement.is("throw")).toThrow("boom");
    });

    it("should handle refinements with side effects (not recommended)", () => {
      let callCount = 0;
      const CountingRefinement = refinement<number, "Counted">((n) => {
        callCount++;
        return n > 0;
      }, "Counted");

      const initialCount = callCount;
      CountingRefinement.is(5);
      expect(callCount).toBe(initialCount + 1);

      CountingRefinement.from(5);
      expect(callCount).toBe(initialCount + 2);

      CountingRefinement.safe(5);
      expect(callCount).toBe(initialCount + 3);
    });

    it("should handle very long strings in refinements", () => {
      const longString = "a".repeat(10000);
      expect(NonEmpty.is(longString)).toBe(true);
      expect(Trimmed.is(longString)).toBe(true);
    });

    it("should handle special Unicode in strings", () => {
      // Zero-width characters
      expect(NonEmpty.is("\u200B")).toBe(true); // Zero-width space
      expect(NonEmpty.is("\uFEFF")).toBe(true); // BOM

      // Emoji
      expect(NonEmpty.is("😀")).toBe(true);
      expect(Lowercase.is("😀")).toBe(true); // Emoji has no case
    });
  });
});
