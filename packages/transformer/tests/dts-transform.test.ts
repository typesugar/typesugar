/**
 * Tests for .d.ts post-processing and consumer-side @opaque discovery.
 *
 * Part 1: transformDtsContent — rewrites @opaque interfaces to type aliases
 * Part 2: discoverOpaqueTypesFromImports — derives TypeRewriteEntry from .d.ts
 */

import { describe, it, expect } from "vitest";
import { transformDtsContent } from "../src/dts-transform.js";

// ============================================================================
// Part 1: .d.ts post-processor
// ============================================================================

describe("transformDtsContent", () => {
  it("replaces @opaque interface with type alias", () => {
    const input = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.transformedCount).toBe(1);
    expect(result.transformedTypes).toEqual(["Option"]);
    expect(result.content).toContain("/** @opaque A | null */");
    expect(result.content).toContain("export type Option<A> = A | null;");
    expect(result.content).not.toContain("interface Option");
    expect(result.content).not.toContain("map<B>");
  });

  it("preserves companion function declarations", () => {
    const input = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

export function Some<A>(value: A): Option<A>;
export const None: Option<never>;
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B>;
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.content).toContain("export function Some<A>(value: A): Option<A>;");
    expect(result.content).toContain("export const None: Option<never>;");
    expect(result.content).toContain(
      "export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B>;"
    );
  });

  it("handles multiple @opaque interfaces", () => {
    const input = `
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}

/** @opaque { _tag: 'Left'; left: E } | { _tag: 'Right'; right: A } */
export interface Either<E, A> {
  map<B>(f: (a: A) => B): Either<E, B>;
  flatMap<B>(f: (a: A) => Either<E, B>): Either<E, B>;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.transformedCount).toBe(2);
    expect(result.transformedTypes).toEqual(["Option", "Either"]);
    expect(result.content).toContain("export type Option<A> = A | null;");
    expect(result.content).toContain(
      "export type Either<E, A> = { _tag: 'Left'; left: E } | { _tag: 'Right'; right: A };"
    );
  });

  it("ignores interfaces without @opaque", () => {
    const input = `
export interface Functor<F> {
  map<A, B>(fa: F, f: (a: A) => B): F;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.transformedCount).toBe(0);
    expect(result.content).toBe(input);
  });

  it("preserves declare modifier", () => {
    const input = `
/** @opaque A | null */
export declare interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.content).toContain("export declare type Option<A> = A | null;");
  });

  it("handles non-exported @opaque interface", () => {
    const input = `
/** @opaque A | null */
interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.content).toContain("type Option<A> = A | null;");
    expect(result.content).not.toContain("export");
  });

  it("handles interface with no type parameters", () => {
    const input = `
/** @opaque string */
export interface Token {
  length: number;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.content).toContain("export type Token = string;");
  });

  it("preserves @opaque annotation in JSDoc with other tags", () => {
    const input = `
/**
 * Option data type — zero cost wrapper over A | null.
 *
 * @opaque A | null
 * @hkt
 */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.transformedCount).toBe(1);
    expect(result.content).toContain("@opaque A | null");
    expect(result.content).toContain("@hkt");
    expect(result.content).toContain("export type Option<A> = A | null;");
  });

  it("returns identical content when no @opaque types found", () => {
    const input = `
export type Foo = string;
export interface Bar { x: number; }
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.transformedCount).toBe(0);
    expect(result.content).toBe(input);
  });

  it("handles multi-line @opaque type", () => {
    const input = `
/**
 * @opaque { readonly tag: "Some"; readonly value: A }
 *   | { readonly tag: "None" }
 */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;
    const result = transformDtsContent("test.d.ts", input);
    expect(result.transformedCount).toBe(1);
    // The underlying type should be the full multi-line type joined
    expect(result.content).toContain("export type Option<A> =");
    expect(result.content).not.toContain("interface Option");
  });

  it("handles @opaque followed by other tags", () => {
    const input = `
/**
 * @opaque A | null
 * @since 1.0.0
 */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;
    const result = transformDtsContent("test.d.ts", input);
    expect(result.transformedCount).toBe(1);
    expect(result.content).toContain("export type Option<A> = A | null;");
  });

  it("handles constrained type parameters", () => {
    const input = `
/** @opaque A | null */
export interface Option<A extends object> {
  map<B>(f: (a: A) => B): Option<B>;
}
`;

    const result = transformDtsContent("test.d.ts", input);

    expect(result.content).toContain("export type Option<A extends object> = A | null;");
  });
});
