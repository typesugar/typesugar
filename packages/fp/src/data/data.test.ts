/**
 * Data Types Tests - Option, Either, List
 */
import { describe, it, expect } from "vitest";
import { Option, Some, None, fromNullable, isSome, isNone } from "./option.js";
import {
  Either,
  Left,
  Right,
  isLeft,
  isRight,
  fromNullable as eitherFromNullable,
} from "./either.js";
import {
  List,
  Cons,
  Nil,
  fromArray,
  toArray,
  head,
  tail,
  map as listMap,
  flatMap as listFlatMap,
  filter as listFilter,
  foldLeft,
  foldRight,
  reverse,
  append,
  length,
} from "./list.js";

// ============================================================================
// Option Tests
// ============================================================================

describe("Option", () => {
  describe("constructors", () => {
    it("Some should wrap a value", () => {
      // Zero-cost: Some(42) = 42, no wrapper object
      const opt = Some(42);
      expect(opt).toBe(42);
      expect(isSome(opt)).toBe(true);
    });

    it("None should represent absence", () => {
      // Zero-cost: None = null
      expect(None).toBe(null);
      expect(isNone(None)).toBe(true);
    });

    it("fromNullable should convert null to None", () => {
      expect(fromNullable(null)).toBe(null);
      expect(fromNullable(undefined)).toBe(null);
    });

    it("fromNullable should convert value to Some", () => {
      const opt = fromNullable(42);
      expect(isSome(opt)).toBe(true);
      // Zero-cost: the value IS the Option when it's Some
      expect(opt).toBe(42);
    });
  });

  describe("type guards", () => {
    it("isSome should identify Some", () => {
      expect(isSome(Some(42))).toBe(true);
      expect(isSome(None)).toBe(false);
    });

    it("isNone should identify None", () => {
      expect(isNone(None)).toBe(true);
      expect(isNone(Some(42))).toBe(false);
    });
  });
});

// ============================================================================
// Either Tests
// ============================================================================

describe("Either", () => {
  describe("constructors", () => {
    it("Right should wrap a success value", () => {
      const either = Right(42);
      expect(either._tag).toBe("Right");
      expect((either as { right: number }).right).toBe(42);
    });

    it("Left should wrap an error value", () => {
      const either = Left("error");
      expect(either._tag).toBe("Left");
      expect((either as { left: string }).left).toBe("error");
    });

    it("fromNullable should convert null to Left", () => {
      const either = eitherFromNullable(null, () => "was null");
      expect(isLeft(either)).toBe(true);
      expect((either as { left: string }).left).toBe("was null");
    });

    it("fromNullable should convert value to Right", () => {
      const either = eitherFromNullable(42, () => "was null");
      expect(isRight(either)).toBe(true);
      expect((either as { right: number }).right).toBe(42);
    });
  });

  describe("type guards", () => {
    it("isRight should identify Right", () => {
      expect(isRight(Right(42))).toBe(true);
      expect(isRight(Left("error"))).toBe(false);
    });

    it("isLeft should identify Left", () => {
      expect(isLeft(Left("error"))).toBe(true);
      expect(isLeft(Right(42))).toBe(false);
    });
  });
});

// ============================================================================
// List Tests
// ============================================================================

describe("List", () => {
  describe("constructors", () => {
    it("Nil should represent empty list", () => {
      expect(Nil._tag).toBe("Nil");
    });

    it("Cons should construct a list", () => {
      const list = Cons(1, Cons(2, Cons(3, Nil)));
      expect(list._tag).toBe("Cons");
    });

    it("fromArray should convert array to list", () => {
      const list = fromArray([1, 2, 3]);
      expect(toArray(list)).toEqual([1, 2, 3]);
    });

    it("toArray should convert list to array", () => {
      const list = Cons(1, Cons(2, Cons(3, Nil)));
      expect(toArray(list)).toEqual([1, 2, 3]);
    });
  });

  describe("accessors", () => {
    it("head should get first element", () => {
      const list = fromArray([1, 2, 3]);
      const h = head(list);
      expect(isSome(h)).toBe(true);
      // Zero-cost: h IS the value when it's Some
      expect(h).toBe(1);
    });

    it("head of empty list should be None", () => {
      expect(head(Nil)).toBe(null);
    });

    it("tail should get rest of list", () => {
      const list = fromArray([1, 2, 3]);
      const t = tail(list);
      expect(isSome(t)).toBe(true);
      // Zero-cost: t IS the list when it's Some
      expect(toArray(t as List<number>)).toEqual([2, 3]);
    });

    it("tail of empty list should be None", () => {
      expect(tail(Nil)).toBe(null);
    });

    it("length should count elements", () => {
      expect(length(Nil)).toBe(0);
      expect(length(fromArray([1, 2, 3]))).toBe(3);
    });
  });

  describe("functor", () => {
    it("map should transform elements", () => {
      const list = fromArray([1, 2, 3]);
      const mapped = listMap(list, (x) => x * 2);
      expect(toArray(mapped)).toEqual([2, 4, 6]);
    });

    it("map on empty list should return empty", () => {
      const mapped = listMap(Nil as List<number>, (x) => x * 2);
      expect(mapped).toBe(Nil);
    });
  });

  describe("monad", () => {
    it("flatMap should chain operations", () => {
      const list = fromArray([1, 2, 3]);
      const flatMapped = listFlatMap(list, (x) => fromArray([x, x * 10]));
      expect(toArray(flatMapped)).toEqual([1, 10, 2, 20, 3, 30]);
    });

    it("flatMap on empty list should return empty", () => {
      const result = listFlatMap(Nil as List<number>, (x) => fromArray([x]));
      expect(result).toBe(Nil);
    });
  });

  describe("filter", () => {
    it("filter should keep matching elements", () => {
      const list = fromArray([1, 2, 3, 4, 5]);
      const filtered = listFilter(list, (x) => x % 2 === 0);
      expect(toArray(filtered)).toEqual([2, 4]);
    });

    it("filter on empty list should return empty", () => {
      const filtered = listFilter(Nil as List<number>, (x) => x > 0);
      expect(filtered).toBe(Nil);
    });
  });

  describe("folds", () => {
    it("foldLeft should accumulate left to right", () => {
      const list = fromArray([1, 2, 3, 4]);
      const result = foldLeft(list, 0, (acc, x) => acc + x);
      expect(result).toBe(10);
    });

    it("foldRight should accumulate right to left", () => {
      const list = fromArray([1, 2, 3, 4]);
      const result = foldRight(list, 0, (x, acc) => x + acc);
      expect(result).toBe(10);
    });

    it("foldLeft should work as string concatenation", () => {
      const list = fromArray(["a", "b", "c"]);
      const result = foldLeft(list, "", (acc, x) => acc + x);
      expect(result).toBe("abc");
    });

    it("foldRight should work as string concatenation", () => {
      const list = fromArray(["a", "b", "c"]);
      const result = foldRight(list, "", (x, acc) => x + acc);
      expect(result).toBe("abc");
    });
  });

  describe("utilities", () => {
    it("reverse should reverse the list", () => {
      const list = fromArray([1, 2, 3]);
      const reversed = reverse(list);
      expect(toArray(reversed)).toEqual([3, 2, 1]);
    });

    it("reverse of empty list should be empty", () => {
      expect(reverse(Nil)).toBe(Nil);
    });

    it("append should concatenate lists", () => {
      const list1 = fromArray([1, 2]);
      const list2 = fromArray([3, 4]);
      const appended = append(list1, list2);
      expect(toArray(appended)).toEqual([1, 2, 3, 4]);
    });

    it("append with empty should return other list", () => {
      const list = fromArray([1, 2, 3]);
      expect(toArray(append(Nil, list))).toEqual([1, 2, 3]);
      expect(toArray(append(list, Nil))).toEqual([1, 2, 3]);
    });
  });

  describe("stack safety", () => {
    it("map should handle large lists", () => {
      const arr = Array.from({ length: 10000 }, (_, i) => i);
      const list = fromArray(arr);
      const mapped = listMap(list, (x) => x * 2);
      expect(toArray(mapped).length).toBe(10000);
      expect(toArray(mapped)[0]).toBe(0);
      expect(toArray(mapped)[9999]).toBe(19998);
    });

    it("foldLeft should handle large lists", () => {
      const arr = Array.from({ length: 10000 }, (_, i) => 1);
      const list = fromArray(arr);
      const sum = foldLeft(list, 0, (acc, x) => acc + x);
      expect(sum).toBe(10000);
    });

    it("foldRight should handle large lists", () => {
      const arr = Array.from({ length: 10000 }, (_, i) => 1);
      const list = fromArray(arr);
      const sum = foldRight(list, 0, (x, acc) => x + acc);
      expect(sum).toBe(10000);
    });

    it("flatMap should handle large lists", () => {
      const arr = Array.from({ length: 1000 }, (_, i) => i);
      const list = fromArray(arr);
      const flatMapped = listFlatMap(list, (x) => fromArray([x, x]));
      expect(toArray(flatMapped).length).toBe(2000);
    });
  });
});
