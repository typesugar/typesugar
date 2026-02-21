/**
 * Tests for labeled block comprehension macros
 *
 * These tests verify the semantics of what the `let:/yield:` and `par:/yield:`
 * macros produce. Since the macros run at compile time (as TS transformers),
 * these tests exercise the *output* of the transformations:
 *   - `let:/yield:` → flatMap/map/then chains (monadic, sequential)
 *   - `par:/yield:` → map/ap chains or Promise.all (applicative, independent)
 */

import { describe, it, expect } from "vitest";
import { Option, Either, IO } from "@typesugar/fp";
const { some, none } = Option;
const { left, right } = Either;
const { io } = IO;

// Verify the macro module loads without errors
import "../src/use-cases/comprehensions/index.js";
import {
  registerComprehensionInstance,
  getComprehensionInstance,
  getAllComprehensionInstances,
  type ComprehensionInstance,
} from "../src/use-cases/comprehensions/index.js";
import { globalRegistry } from "../src/core/registry.js";

// ============================================================================
// Test helper: Applicative type with .map() and .ap()
// ============================================================================

/**
 * A simple Box type that supports .map() and .ap() for testing applicative
 * comprehensions. This is the shape that `par:` emits code against.
 */
class Box<A> {
  constructor(public readonly value: A) {}

  map<B>(f: (a: A) => B): Box<B> {
    return new Box(f(this.value));
  }

  ap<B>(this: Box<(a: A) => B>, boxA: Box<A>): Box<B> {
    return new Box(this.value(boxA.value));
  }

  flatMap<B>(f: (a: A) => Box<B>): Box<B> {
    return f(this.value);
  }
}

function box<A>(value: A): Box<A> {
  return new Box(value);
}

/**
 * Validation type — applicative but NOT a monad.
 * Accumulates errors instead of short-circuiting.
 */
class Validation<E, A> {
  private constructor(
    private readonly _errors: E[],
    private readonly _value: A | undefined,
    public readonly isValid: boolean
  ) {}

  static success<E, A>(value: A): Validation<E, A> {
    return new Validation<E, A>([], value, true);
  }

  static failure<E, A>(errors: E[]): Validation<E, A> {
    return new Validation<E, A>(errors, undefined, false);
  }

  get value(): A | undefined {
    return this._value;
  }

  get errors(): E[] {
    return this._errors;
  }

  map<B>(f: (a: A) => B): Validation<E, B> {
    if (this.isValid) {
      return Validation.success(f(this._value!));
    }
    return Validation.failure(this._errors);
  }

  ap<B>(this: Validation<E, (a: A) => B>, va: Validation<E, A>): Validation<E, B> {
    if (this.isValid && va.isValid) {
      return Validation.success(this._value!(va._value!));
    }
    // Accumulate errors from both sides
    return Validation.failure([...this._errors, ...va._errors]);
  }
}

function valid<E, A>(value: A): Validation<E, A> {
  return Validation.success(value);
}

function invalid<E, A>(...errors: E[]): Validation<E, A> {
  return Validation.failure(errors);
}

// ============================================================================
// Macro registration
// ============================================================================

describe("comprehensions macro registration", () => {
  it("should register the let-block-comprehension macro", () => {
    const macro = globalRegistry.getLabeledBlock("let");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("let-block-comprehension");
    expect(macro!.label).toBe("let");
    expect(macro!.continuationLabels).toEqual(["yield", "pure"]);
  });
});

// ============================================================================
// Basic bind (<<) with yield
// ============================================================================

describe("let:/yield: bind (<<) semantics", () => {
  describe("basic bindings with Option", () => {
    it("single binding", () => {
      // let: { x << some(42) }
      // yield: { x }
      const result = some(42).map((x) => x);
      expect(result.value).toBe(42);
    });

    it("two bindings", () => {
      // let: { a << some(10); b << some(20) }
      // yield: { a + b }
      const result = some(10).flatMap((a) => some(20).map((b) => a + b));
      expect(result.value).toBe(30);
    });

    it("three bindings", () => {
      // let: { a << some(1); b << some(2); c << some(3) }
      // yield: { a + b + c }
      const result = some(1).flatMap((a) => some(2).flatMap((b) => some(3).map((c) => a + b + c)));
      expect(result.value).toBe(6);
    });

    it("dependent bindings (b depends on a)", () => {
      // let: { a << some(10); b << some(a * 2) }
      // yield: { a + b }
      const result = some(10).flatMap((a) => some(a * 2).map((b) => a + b));
      expect(result.value).toBe(30);
    });
  });

  describe("discard bindings with _", () => {
    it("should execute effect but discard result", () => {
      let sideEffect = false;
      const doSideEffect = some("ignored").map((x) => {
        sideEffect = true;
        return x;
      });

      // let: { a << some(10); _ << doSideEffect; b << some(20) }
      // yield: { a + b }
      const result = some(10).flatMap((a) =>
        doSideEffect.flatMap((_) => some(20).map((b) => a + b))
      );
      expect(result.value).toBe(30);
      expect(sideEffect).toBe(true);
    });
  });

  describe("short-circuiting", () => {
    it("should short-circuit on none in the middle", () => {
      const result = some(10).flatMap((a) =>
        none<number>().flatMap((b: number) => some(30).map((c) => a + b + c))
      );
      expect(result.value).toBeUndefined();
    });

    it("should short-circuit on none at the start", () => {
      let reached = false;
      const result = none<number>().flatMap((a: number) => {
        reached = true;
        return some(20).map((b) => a + b);
      });
      expect(result.value).toBeUndefined();
      expect(reached).toBe(false);
    });
  });

  describe("with Either", () => {
    it("should chain Right values", () => {
      const result = right<string, number>(10).flatMap((a) =>
        right<string, number>(20).map((b) => a + b)
      );
      expect(result.value).toBe(30);
      expect(result.isRight).toBe(true);
    });

    it("should short-circuit on Left", () => {
      const result = right<string, number>(10).flatMap((a) =>
        left<string, number>("error").flatMap((b: number) =>
          right<string, number>(30).map((c) => a + b + c)
        )
      );
      expect(result.isRight).toBe(false);
      expect(result.error).toBe("error");
    });
  });

  describe("with IO", () => {
    it("should compose IO effects", () => {
      const result = io(() => 10).flatMap((a) => io(() => 20).map((b) => a + b));
      expect(result.run()).toBe(30);
    });

    it("should handle side effects in order", () => {
      const log: string[] = [];
      const result = io(() => {
        log.push("first");
      }).flatMap((_) =>
        io(() => {
          log.push("second");
          return 42;
        }).flatMap((a) =>
          io(() => {
            log.push("third");
          }).map((_) => a)
        )
      );
      expect(result.run()).toBe(42);
      expect(log).toEqual(["first", "second", "third"]);
    });
  });

  describe("without yield block", () => {
    it("single binding returns the expression directly", () => {
      // let: { a << some(42) }
      // (no yield)
      const result = some(42);
      expect(result.value).toBe(42);
    });

    it("multiple bindings, last one is the result", () => {
      // let: { a << some(10); b << some(20) }
      // (no yield — last bind's expression is the result)
      const result = some(10).flatMap((_a) => some(20));
      expect(result.value).toBe(20);
    });
  });
});

// ============================================================================
// Pure map (=) syntax
// ============================================================================

describe("let:/yield: pure map (=) semantics", () => {
  it("should compute a pure value from a previous binding", () => {
    // let: {
    //   x << some(10)
    //   y = x * 2          // pure computation, no effect
    // }
    // yield: { y }
    const result = some(10).map((x) => ((y: number) => y)(x * 2));
    expect(result.value).toBe(20);
  });

  it("should allow mixing bind and map steps", () => {
    // let: {
    //   a << some(10)
    //   b = a + 5           // pure map
    //   c << some(b * 2)    // uses the mapped value
    // }
    // yield: { c }
    const result = some(10).flatMap((a) => ((b: number) => some(b * 2).map((c) => c))(a + 5));
    expect(result.value).toBe(30);
  });

  it("should work with string transformations", () => {
    // let: {
    //   name << some("alice")
    //   upper = name.toUpperCase()
    // }
    // yield: { upper }
    const result = some("alice").map((name) => ((upper: string) => upper)(name.toUpperCase()));
    expect(result.value).toBe("ALICE");
  });
});

// ============================================================================
// Promise/thenable support (.then instead of .flatMap)
// ============================================================================

describe("let:/yield: Promise support", () => {
  it("should chain Promises with .then()", async () => {
    // let: {
    //   a << Promise.resolve(10)
    //   b << Promise.resolve(20)
    // }
    // yield: { a + b }
    // => uses .then() instead of .flatMap()
    const result = await Promise.resolve(10).then((a) => Promise.resolve(20).then((b) => a + b));
    expect(result).toBe(30);
  });

  it("should handle async operations", async () => {
    const delay = (ms: number, value: number) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(value), ms));

    // let: {
    //   a << delay(1, 10)
    //   b << delay(1, 20)
    // }
    // yield: { a + b }
    const result = await delay(1, 10).then((a) => delay(1, 20).then((b) => a + b));
    expect(result).toBe(30);
  });

  it("should propagate rejections", async () => {
    // let: {
    //   a << Promise.resolve(10)
    //   b << Promise.reject(new Error("boom"))
    // }
    // yield: { a + b }
    const result = Promise.resolve(10).then((_a) =>
      Promise.reject(new Error("boom")).then((_b: number) => 0)
    );
    await expect(result).rejects.toThrow("boom");
  });

  it("should support dependent async bindings", async () => {
    const fetchUser = (id: number) => Promise.resolve({ id, name: "Alice" });
    const fetchPosts = (userId: number) => Promise.resolve([{ userId, title: "Hello" }]);

    // let: {
    //   user << fetchUser(1)
    //   posts << fetchPosts(user.id)
    // }
    // yield: { ({ user, posts }) }
    const result = await fetchUser(1).then((user) =>
      fetchPosts(user.id).then((posts) => ({ user, posts }))
    );
    expect(result.user.name).toBe("Alice");
    expect(result.posts).toHaveLength(1);
  });
});

// ============================================================================
// orElse fallback (<<  || )
// ============================================================================

describe("let:/yield: orElse (||) semantics", () => {
  // For these tests we need a type with .orElse()
  // Option from @typesugar/fp doesn't have orElse, so let's test the shape

  it("should wrap expression with .orElse() call", () => {
    // The macro generates: expr.orElse(() => fallback)
    // Let's test with a simple object that has orElse
    const withOrElse = {
      orElse(f: () => { map: (fn: (x: number) => number) => number }) {
        return f();
      },
      flatMap(_f: unknown) {
        return this; // simulates failure path
      },
    };

    const fallback = {
      map(f: (x: number) => number) {
        return f(42);
      },
    };

    // let: { x << withOrElse || fallback }
    // yield: { x }
    // => withOrElse.orElse(() => fallback).map(x => x)
    const result = withOrElse.orElse(() => fallback).map((x) => x);
    expect(result).toBe(42);
  });

  it("should use primary when orElse is not needed", () => {
    const primary = {
      orElse(_f: () => unknown) {
        return this; // primary succeeds, orElse not called
      },
      map(f: (x: number) => number) {
        return f(10);
      },
    };

    const fallback = {
      map(f: (x: number) => number) {
        return f(99);
      },
    };

    const result = primary.orElse(() => fallback).map((x) => x);
    expect(result).toBe(10);
  });
});

// ============================================================================
// Guard/filter (if)
// ============================================================================

describe("let:/yield: guard (if) semantics", () => {
  it("should pass through when condition is true", () => {
    // let: {
    //   x << some(10)
    //   if (x > 0) {}
    // }
    // yield: { x }
    // => some(10).map(x => x > 0 ? x : undefined)
    const result = some(10).map((x) => (x > 0 ? x : undefined));
    expect(result.value).toBe(10);
  });

  it("should short-circuit when condition is false", () => {
    // let: {
    //   x << some(-5)
    //   if (x > 0) {}
    // }
    // yield: { x }
    const result = some(-5).map((x) => (x > 0 ? x : undefined));
    expect(result.value).toBeUndefined();
  });

  it("should work with complex conditions", () => {
    // let: {
    //   xs << some([1, 2, 3])
    //   if (xs.length > 0) {}
    //   head = xs[0]
    // }
    // yield: { head }
    const result = some([1, 2, 3]).map((xs) =>
      xs.length > 0 ? ((head: number) => head)(xs[0]) : undefined
    );
    expect(result.value).toBe(1);
  });
});

// ============================================================================
// Complex combinations
// ============================================================================

describe("let:/yield: combined features", () => {
  it("bind + map + yield", () => {
    // let: {
    //   a << some(10)
    //   b = a * 3
    //   c << some(b + 1)
    // }
    // yield: { a + c }
    const result = some(10).flatMap((a) => ((b: number) => some(b + 1).map((c) => a + c))(a * 3));
    expect(result.value).toBe(41); // 10 + 31
  });

  it("bind + guard + bind + yield", () => {
    // let: {
    //   x << some(10)
    //   if (x > 0) {}
    //   y << some(x * 2)
    // }
    // yield: { y }
    const result = some(10).flatMap((x) => (x > 0 ? some(x * 2).map((y) => y) : undefined));
    expect(result?.value).toBe(20);
  });

  it("object construction in yield needs parens", () => {
    // let: { name << some("Alice"); age << some(30) }
    // yield: { ({ name, age }) }
    const result = some("Alice").flatMap((name) => some(30).map((age) => ({ name, age })));
    expect(result.value).toEqual({ name: "Alice", age: 30 });
  });
});

// ============================================================================
// Monad laws
// ============================================================================

describe("Monad laws with comprehension style", () => {
  it("left identity: pure(a) >>= f === f(a)", () => {
    const f = (x: number) => some(x * 2);
    const lhs = some(21).flatMap(f);
    const rhs = f(21);
    expect(lhs.value).toBe(rhs.value);
  });

  it("right identity: m >>= pure === m", () => {
    const m = some(42);
    const lhs = m.map((a) => a);
    expect(lhs.value).toBe(m.value);
  });

  it("associativity: (m >>= f) >>= g === m >>= (x => f(x) >>= g)", () => {
    const m = some(5);
    const f = (x: number) => some(x * 2);
    const g = (x: number) => some(x + 1);
    const lhs = m.flatMap(f).flatMap(g);
    const rhs = m.flatMap((x) => f(x).flatMap(g));
    expect(lhs.value).toBe(rhs.value);
  });
});

// ============================================================================
// par: macro registration
// ============================================================================

describe("par: macro registration", () => {
  it("should register the par-block-comprehension macro", () => {
    const macro = globalRegistry.getLabeledBlock("par");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("par-block-comprehension");
    expect(macro!.label).toBe("par");
    expect(macro!.continuationLabels).toEqual(["yield", "pure"]);
  });
});

// ============================================================================
// par: applicative combination with .map().ap()
// ============================================================================

describe("par:/yield: applicative (.map/.ap) semantics", () => {
  describe("basic applicative bindings with Box", () => {
    it("single binding — just .map()", () => {
      // par: { x << box(42) }
      // yield: { x * 2 }
      // => box(42).map(x => x * 2)
      const result = box(42).map((x) => x * 2);
      expect(result.value).toBe(84);
    });

    it("two independent bindings", () => {
      // par: { a << box(10); b << box(20) }
      // yield: { a + b }
      // => box(10).map(a => b => a + b).ap(box(20))
      const result = box(10)
        .map((a: number) => (b: number) => a + b)
        .ap(box(20));
      expect(result.value).toBe(30);
    });

    it("three independent bindings", () => {
      // par: { a << box(1); b << box(2); c << box(3) }
      // yield: { a + b + c }
      // => box(1).map(a => b => c => a + b + c).ap(box(2)).ap(box(3))
      const result = box(1)
        .map((a: number) => (b: number) => (c: number) => a + b + c)
        .ap(box(2))
        .ap(box(3));
      expect(result.value).toBe(6);
    });

    it("object construction in yield", () => {
      // par: { name << box("Alice"); age << box(30) }
      // yield: { ({ name, age }) }
      const result = box("Alice")
        .map((name: string) => (age: number) => ({ name, age }))
        .ap(box(30));
      expect(result.value).toEqual({ name: "Alice", age: 30 });
    });
  });

  describe("with Validation (applicative but NOT monadic)", () => {
    it("should combine successful validations", () => {
      // par: { name << valid("Alice"); age << valid(30) }
      // yield: { ({ name, age }) }
      const result = valid<string, string>("Alice")
        .map((name: string) => (age: number) => ({ name, age }))
        .ap(valid<string, number>(30));
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual({ name: "Alice", age: 30 });
    });

    it("should accumulate errors from multiple failures", () => {
      // par: { name << invalid("name required"); age << invalid("age required") }
      // yield: { ({ name, age }) }
      // With monadic (let:), only the first error would be reported.
      // With applicative (par:), BOTH errors are accumulated.
      const result = invalid<string, string>("name required")
        .map((_name: string) => (_age: number) => ({ _name, _age }))
        .ap(invalid<string, number>("age required"));
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(["name required", "age required"]);
    });

    it("should accumulate errors from three failures", () => {
      const result = invalid<string, string>("name required")
        .map((_name: string) => (_age: number) => (_email: string) => ({
          _name,
          _age,
          _email,
        }))
        .ap(invalid<string, number>("age required"))
        .ap(invalid<string, string>("email required"));
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(["name required", "age required", "email required"]);
    });

    it("should report error from one failure among successes", () => {
      const result = valid<string, string>("Alice")
        .map((name: string) => (age: number) => ({ name, age }))
        .ap(invalid<string, number>("age must be positive"));
      expect(result.isValid).toBe(false);
      expect(result.errors).toEqual(["age must be positive"]);
    });
  });

  describe("with pure map steps", () => {
    it("should inline pure computations as IIFEs", () => {
      // par: {
      //   a << box(10)
      //   b << box(20)
      //   c = 100          // pure, no effect
      // }
      // yield: { a + b + c }
      // => ((c) => box(10).map(a => b => a + b + c).ap(box(20)))(100)
      const result = ((c: number) =>
        box(10)
          .map((a: number) => (b: number) => a + b + c)
          .ap(box(20)))(100);
      expect(result.value).toBe(130);
    });
  });
});

// ============================================================================
// par: with Promises (Promise.all)
// ============================================================================

describe("par:/yield: Promise support (Promise.all)", () => {
  it("should combine two independent Promises with Promise.all", async () => {
    // par: { a << Promise.resolve(10); b << Promise.resolve(20) }
    // yield: { a + b }
    // => Promise.all([Promise.resolve(10), Promise.resolve(20)])
    //      .then(([a, b]) => a + b)
    const result = await Promise.all([Promise.resolve(10), Promise.resolve(20)]).then(
      ([a, b]) => a + b
    );
    expect(result).toBe(30);
  });

  it("should combine three independent Promises", async () => {
    // par: { a << fa; b << fb; c << fc }
    // yield: { ({ a, b, c }) }
    const result = await Promise.all([
      Promise.resolve("Alice"),
      Promise.resolve(30),
      Promise.resolve(["admin"]),
    ]).then(([name, age, roles]) => ({ name, age, roles }));
    expect(result).toEqual({ name: "Alice", age: 30, roles: ["admin"] });
  });

  it("should run Promises concurrently", async () => {
    const order: string[] = [];
    const delay = (ms: number, label: string, value: number) =>
      new Promise<number>((resolve) =>
        setTimeout(() => {
          order.push(label);
          resolve(value);
        }, ms)
      );

    // par: { a << delay(30, "a", 1); b << delay(10, "b", 2); c << delay(20, "c", 3) }
    // yield: { a + b + c }
    // With let: (sequential), order would be ["a", "b", "c"]
    // With par: (Promise.all), order is by completion time: ["b", "c", "a"]
    const result = await Promise.all([
      delay(30, "a", 1),
      delay(10, "b", 2),
      delay(20, "c", 3),
    ]).then(([a, b, c]) => a + b + c);

    expect(result).toBe(6);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("should reject if any Promise rejects", async () => {
    const result = Promise.all([
      Promise.resolve(10),
      Promise.reject(new Error("boom")),
      Promise.resolve(30),
    ]).then(([a, _b, c]) => a + c);
    await expect(result).rejects.toThrow("boom");
  });

  it("single Promise — just .then()", async () => {
    // par: { x << Promise.resolve(42) }
    // yield: { x * 2 }
    // => Promise.resolve(42).then(x => x * 2)
    const result = await Promise.resolve(42).then((x) => x * 2);
    expect(result).toBe(84);
  });

  it("should work with pure map steps", async () => {
    // par: {
    //   a << Promise.resolve(10)
    //   b << Promise.resolve(20)
    //   c = 100
    // }
    // yield: { a + b + c }
    const result = await ((c: number) =>
      Promise.all([Promise.resolve(10), Promise.resolve(20)]).then(([a, b]) => a + b + c))(100);
    expect(result).toBe(130);
  });
});

// ============================================================================
// Applicative laws
// ============================================================================

describe("Applicative laws with par: style", () => {
  it("identity: pure(id).ap(v) === v", () => {
    const v = box(42);
    const id = (x: number) => x;
    const lhs = box(id).ap(v);
    expect(lhs.value).toBe(v.value);
  });

  it("homomorphism: pure(f).ap(pure(x)) === pure(f(x))", () => {
    const f = (x: number) => x * 2;
    const x = 21;
    const lhs = box(f).ap(box(x));
    const rhs = box(f(x));
    expect(lhs.value).toBe(rhs.value);
  });

  it("composition: pure(compose).ap(u).ap(v).ap(w) === u.ap(v.ap(w))", () => {
    const compose = (f: (b: number) => number) => (g: (a: number) => number) => (a: number) =>
      f(g(a));
    const u = box((x: number) => x + 1);
    const v = box((x: number) => x * 2);
    const w = box(3);

    const lhs = box(compose).ap(u).ap(v).ap(w);
    const rhs = u.ap(v.ap(w));
    expect(lhs.value).toBe(rhs.value);
  });
});

// ============================================================================
// Comprehension typeclass (method resolution registry)
// ============================================================================

describe("Comprehension typeclass registry", () => {
  describe("built-in instances", () => {
    it("should have a Promise instance registered", () => {
      const instance = getComprehensionInstance("Promise");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("then");
      expect(instance!.map).toBe("then");
      expect(instance!.usePromiseAll).toBe(true);
    });

    it("should have an Option instance registered", () => {
      const instance = getComprehensionInstance("Option");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("flatMap");
      expect(instance!.map).toBe("map");
      expect(instance!.orElse).toBe("orElse");
    });

    it("should have an Either instance registered", () => {
      const instance = getComprehensionInstance("Either");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("flatMap");
      expect(instance!.map).toBe("map");
    });

    it("should have an Effect instance registered", () => {
      const instance = getComprehensionInstance("Effect");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("flatMap");
      expect(instance!.map).toBe("map");
      expect(instance!.orElse).toBe("catchAll");
    });

    it("should have an IO instance registered", () => {
      const instance = getComprehensionInstance("IO");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("chain");
      expect(instance!.map).toBe("map");
    });

    it("should have an Array instance registered", () => {
      const instance = getComprehensionInstance("Array");
      expect(instance).toBeDefined();
      expect(instance!.bind).toBe("flatMap");
      expect(instance!.map).toBe("map");
    });
  });

  describe("custom instance registration", () => {
    it("should allow registering a custom comprehension instance", () => {
      const customInstance: ComprehensionInstance = {
        bind: "andThen",
        map: "transform",
        pure: "MyType.of",
        empty: "MyType.empty()",
        orElse: "recover",
        ap: "apply",
      };

      registerComprehensionInstance("MyCustomType", customInstance);

      const retrieved = getComprehensionInstance("MyCustomType");
      expect(retrieved).toBeDefined();
      expect(retrieved!.bind).toBe("andThen");
      expect(retrieved!.map).toBe("transform");
      expect(retrieved!.pure).toBe("MyType.of");
      expect(retrieved!.empty).toBe("MyType.empty()");
      expect(retrieved!.orElse).toBe("recover");
      expect(retrieved!.ap).toBe("apply");
    });

    it("should override existing instances on re-registration", () => {
      registerComprehensionInstance("TestOverride", {
        bind: "original",
        map: "original",
      });
      registerComprehensionInstance("TestOverride", {
        bind: "updated",
        map: "updated",
      });

      const instance = getComprehensionInstance("TestOverride");
      expect(instance!.bind).toBe("updated");
    });

    it("should return undefined for unregistered types", () => {
      const instance = getComprehensionInstance("NonExistentType");
      expect(instance).toBeUndefined();
    });
  });

  describe("getAllComprehensionInstances", () => {
    it("should return all registered instances", () => {
      const all = getAllComprehensionInstances();
      expect(all.size).toBeGreaterThanOrEqual(6); // Promise, Option, Either, Effect, IO, Array
      expect(all.has("Promise")).toBe(true);
      expect(all.has("Option")).toBe(true);
      expect(all.has("Either")).toBe(true);
    });

    it("should return a copy (not the internal map)", () => {
      const all = getAllComprehensionInstances();
      all.delete("Promise");
      // Original should still have it
      expect(getComprehensionInstance("Promise")).toBeDefined();
    });
  });

  describe("ComprehensionInstance shape", () => {
    it("Promise instance should use Promise.all for parallel", () => {
      const instance = getComprehensionInstance("Promise")!;
      expect(instance.usePromiseAll).toBe(true);
    });

    it("Option instance should not use Promise.all", () => {
      const instance = getComprehensionInstance("Option")!;
      expect(instance.usePromiseAll).toBeUndefined();
    });

    it("IO instance uses 'chain' instead of 'flatMap'", () => {
      const instance = getComprehensionInstance("IO")!;
      expect(instance.bind).toBe("chain");
      // This demonstrates the typeclass-driven approach: IO uses different
      // method names than the default, and the comprehension macro will
      // emit .chain() instead of .flatMap()
    });
  });
});
