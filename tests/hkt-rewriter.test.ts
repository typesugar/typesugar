/**
 * Tests for the HKT type reference rewriter (PEP-007 Wave 4).
 *
 * Covers all 13 edge cases from the POC detection script plus environment
 * compatibility. Tests the rewriter in isolation (no VirtualCompilerHost).
 */

import { describe, it, expect } from "vitest";
import { rewriteHKTTypeReferences, hasHKTPatterns } from "@typesugar/transformer";

// ---------------------------------------------------------------------------
// hasHKTPatterns — fast heuristic
// ---------------------------------------------------------------------------

describe("hasHKTPatterns", () => {
  it("returns true for single uppercase letter followed by <", () => {
    expect(hasHKTPatterns("interface Functor<F> { map(fa: F<A>): void }")).toBe(true);
  });

  it("returns true for M<B>", () => {
    expect(hasHKTPatterns("type X<M> = M<B>")).toBe(true);
  });

  it("returns false for no angle brackets", () => {
    expect(hasHKTPatterns("const x = 1;")).toBe(false);
  });

  it("returns false for concrete generics like Array<T>", () => {
    expect(hasHKTPatterns("const x: Array<number> = [];")).toBe(false);
  });

  it("returns false for Promise<T>", () => {
    expect(hasHKTPatterns("function f(): Promise<string> {}")).toBe(false);
  });

  it("returns true when HKT pattern is mixed with concrete generics", () => {
    expect(hasHKTPatterns("type X<F> = Array<F<A>>")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper: apply rewriter and return code
// ---------------------------------------------------------------------------

function rewrite(source: string, fileName = "test.ts"): string {
  const result = rewriteHKTTypeReferences(source, fileName);
  return result.code;
}

function rewriteResult(source: string, fileName = "test.ts") {
  return rewriteHKTTypeReferences(source, fileName);
}

// ---------------------------------------------------------------------------
// Case 1: Basic typeclass — F<A> in params and return types
// ---------------------------------------------------------------------------

describe("Case 1: Basic typeclass", () => {
  it("rewrites F<A> in parameter type", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
    expect(result).not.toMatch(/\bF<A>/);
    expect(result).not.toMatch(/\bF<B>/);
  });

  it("sets changed=true and produces a source map", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewriteResult(code);
    expect(result.changed).toBe(true);
    expect(result.map).not.toBeNull();
    expect(result.map!.mappings).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Case 2: Nested F<F<A>> — Monad join/flatten
// ---------------------------------------------------------------------------

describe("Case 2: Nested F<F<A>>", () => {
  it("rewrites nested F<F<A>> to Kind<F, Kind<F, A>>", () => {
    const code = `
interface Monad<F> {
  flatten<A>(ffa: F<F<A>>): F<A>;
  pure<A>(a: A): F<A>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("Kind<F, Kind<F, A>>");
    expect(result).toContain("Kind<F, A>");
    expect(result).not.toMatch(/\bF<F<A>>/);
  });
});

// ---------------------------------------------------------------------------
// Case 3: Multiple type args — Applicative
// ---------------------------------------------------------------------------

describe("Case 3: Applicative with function type args", () => {
  it("rewrites F<(a: A) => B> and F<A> correctly", () => {
    const code = `
interface Applicative<F> {
  pure<A>(a: A): F<A>;
  ap<A, B>(ff: F<(a: A) => B>, fa: F<A>): F<B>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("Kind<F, (a: A) => B>");
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
  });
});

// ---------------------------------------------------------------------------
// Case 4: Concrete generics should NOT be rewritten
// ---------------------------------------------------------------------------

describe("Case 4: Concrete generics", () => {
  it("does NOT rewrite Array<A> or Promise<A>", () => {
    const code = `
interface WithConcreteTypes<F> {
  liftArray<A>(fa: F<A>): Array<A>;
  liftPromise<A>(fa: F<A>): Promise<A>;
  mapBoth<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("Array<A>");
    expect(result).toContain("Promise<A>");
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
  });
});

// ---------------------------------------------------------------------------
// Case 5: Generic function — F<A> in function signature
// ---------------------------------------------------------------------------

describe("Case 5: Generic function", () => {
  it("rewrites F<A> in function signature", () => {
    const code = `
declare function lift<F, A, B>(functor: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B>;
`.trim();

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
    // Functor<F> should NOT be rewritten — F is bare (no type args on F)
    expect(result).toContain("Functor<F>");
  });
});

// ---------------------------------------------------------------------------
// Case 6: Type alias with F<A>
// ---------------------------------------------------------------------------

describe("Case 6: Type alias", () => {
  it("rewrites F<A> in type alias", () => {
    const code = `type Lifted<F, A, B> = (fa: F<A>) => F<B>;`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
  });
});

// ---------------------------------------------------------------------------
// Case 7: Conditional type
// ---------------------------------------------------------------------------

describe("Case 7: Conditional type", () => {
  it("rewrites F<A> in conditional type", () => {
    const code = `type IsNullable<F, A> = F<A> extends null ? true : false;`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
    expect(result).not.toMatch(/\bF<A>/);
  });
});

// ---------------------------------------------------------------------------
// Case 8: Mapped type
// ---------------------------------------------------------------------------

describe("Case 8: Mapped type", () => {
  it("rewrites F<T[K]> in mapped type", () => {
    const code = `type MapAll<F, T> = { [K in keyof T]: F<T[K]> };`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, T[K]>");
  });
});

// ---------------------------------------------------------------------------
// Case 9: Tuple, union, intersection positions
// ---------------------------------------------------------------------------

describe("Case 9: Tuple, union, intersection", () => {
  it("rewrites F<A> and F<B> in tuple", () => {
    const code = `type Pair<F, A, B> = [F<A>, F<B>];`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
  });

  it("rewrites F<A> in union", () => {
    const code = `type OrNull<F, A> = F<A> | null;`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
  });

  it("rewrites F<A> in intersection", () => {
    const code = `type AndMeta<F, A> = F<A> & { __meta: true };`;

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A>");
  });
});

// ---------------------------------------------------------------------------
// Case 10: extends clause — Functor<F> is NOT an HKT application
// ---------------------------------------------------------------------------

describe("Case 10: extends clause", () => {
  it("does NOT rewrite Functor<F> in extends clause (F is bare)", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}
interface FunctorFilter<F> extends Functor<F> {
  filter<A>(fa: F<A>, pred: (a: A) => boolean): F<A>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("extends Functor<F>");
    // Functor<F> should stay — F is used as bare type param in extends, not F<X>
    expect(result).toContain("Kind<F, A>");
  });
});

// ---------------------------------------------------------------------------
// Case 11: Bare type usage — Option used without type args
// ---------------------------------------------------------------------------

describe("Case 11: Bare type usage (concrete)", () => {
  it("does NOT rewrite Functor<Option> (Option is not a type param)", () => {
    const code = `
declare const optionFunctor: Functor<Option>;
declare const arrayFunctor: Functor<Array>;
`.trim();

    const result = rewrite(code);
    expect(result).toContain("Functor<Option>");
    expect(result).toContain("Functor<Array>");
  });
});

// ---------------------------------------------------------------------------
// Case 12: Multi-arity type constructor F<A, B>
// ---------------------------------------------------------------------------

describe("Case 12: Multi-arity type constructor", () => {
  it("rewrites F<A, B> to Kind<F, A, B>", () => {
    const code = `
interface Bifunctor<F> {
  bimap<A, B, C, D>(fab: F<A, B>, f: (a: A) => C, g: (b: B) => D): F<C, D>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("Kind<F, A, B>");
    expect(result).toContain("Kind<F, C, D>");
  });
});

// ---------------------------------------------------------------------------
// Case 13: Type parameter NOT used with args — should NOT be rewritten
// ---------------------------------------------------------------------------

describe("Case 13: Non-applied type param", () => {
  it("rewrites F<A> but leaves bare A alone", () => {
    const code = `
interface Container<F, A> {
  value: A;
  wrapped: F<A>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain("value: A;");
    expect(result).toContain("Kind<F, A>");
  });
});

// ---------------------------------------------------------------------------
// No-change cases
// ---------------------------------------------------------------------------

describe("No-change cases", () => {
  it("returns changed=false for code without HKT patterns", () => {
    const code = `
interface User {
  name: string;
  age: number;
}`.trim();

    const result = rewriteResult(code);
    expect(result.changed).toBe(false);
    expect(result.map).toBeNull();
    expect(result.code).toBe(code);
  });

  it("returns changed=false for concrete generics only", () => {
    const code = `const x: Array<number> = []; const y: Map<string, number> = new Map();`;

    const result = rewriteResult(code);
    expect(result.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Import injection
// ---------------------------------------------------------------------------

describe("Import injection", () => {
  it("injects Kind import when no typesugar imports exist", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    expect(result).toContain('import type { Kind } from "@typesugar/type-system"');
  });

  it("adds import after existing imports", () => {
    const code = `
import { something } from "some-module";

interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    const kindImportIdx = result.indexOf("import type { Kind }");
    const someImportIdx = result.indexOf("import { something }");
    expect(kindImportIdx).toBeGreaterThan(someImportIdx);
  });

  it("does NOT inject import if Kind is already imported from typesugar", () => {
    const code = `
import type { Kind } from "@typesugar/type-system";

interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    const matches = result.match(/import type \{ Kind \}/g);
    expect(matches).toHaveLength(1);
  });

  it("does NOT inject import if typesugar is namespace-imported", () => {
    const code = `
import * as ts from "@typesugar/type-system";

interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code);
    expect(result).not.toContain('import type { Kind } from "@typesugar/type-system"');
  });
});

// ---------------------------------------------------------------------------
// TSX support
// ---------------------------------------------------------------------------

describe("TSX support", () => {
  it("handles .tsx files", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewrite(code, "component.tsx");
    expect(result).toContain("Kind<F, A>");
    expect(result).toContain("Kind<F, B>");
  });
});

// ---------------------------------------------------------------------------
// Source map generation
// ---------------------------------------------------------------------------

describe("Source maps", () => {
  it("produces a valid source map with hires mappings", () => {
    const code = `
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}`.trim();

    const result = rewriteResult(code);
    expect(result.map).not.toBeNull();
    expect(result.map!.version).toBe(3);
    expect(result.map!.mappings).toBeTruthy();
    expect(typeof result.map!.mappings).toBe("string");
  });
});
