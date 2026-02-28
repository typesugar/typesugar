import { describe, it, expect } from "vitest";
import { preprocess } from "../src/preprocess.js";
import { scanImports } from "../src/import-tracker.js";

describe("HKT extension", () => {
  describe("F<_> declaration removal", () => {
    it("should remove <_> from type parameter", () => {
      const source = `interface Functor<F<_>> {}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toBe(`interface Functor<F> {}`);
    });

    it("should handle multiple HKT parameters", () => {
      const source = `interface BiFunctor<F<_>, G<_>> {}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("BiFunctor<F, G>");
    });

    it("should handle mixed HKT and regular parameters", () => {
      const source = `interface MapLike<F<_>, K> {}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toBe(`interface MapLike<F, K> {}`);
    });
  });

  describe("F<A> usage rewriting to Kind<F, A>", () => {
    it("should rewrite F<A> to Kind<F, A> in method signatures", () => {
      const source = `
interface Functor<F<_>> {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
      expect(code).not.toContain("F<A>");
      expect(code).not.toContain("F<B>");
    });

    it("should not rewrite non-HKT generics", () => {
      const source = `
interface Container<F<_>> {
  get: <A>(fa: F<A>) => Array<A>;
}`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("Array<A>");
      expect(code).toContain("Kind<F, A>");
    });

    it("should handle nested generics", () => {
      const source = `
interface Nested<F<_>> {
  wrap: <A>(a: A) => F<Array<A>>;
}`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("Kind<F, Array<A>>");
    });
  });

  describe("scope handling", () => {
    it("should only rewrite within HKT declaration scope", () => {
      const source = `
interface Functor<F<_>> {
  map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}

interface Other<G> {
  get: <A>(ga: G<A>) => A;
}`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toMatch(/interface Functor<F>/);
      expect(code).toMatch(/Kind<F, A>/);
      expect(code).toMatch(/Kind<F, B>/);
      expect(code).toMatch(/interface Other<G>/);
      expect(code).toMatch(/G<A>/);
    });

    it("should handle real-world Functor example", () => {
      const source = `
export interface Functor<F<_>> {
  readonly map: <A, B>(fa: F<A>, f: (a: A) => B) => F<B>;
}`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("Functor<F>");
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
    });
  });

  describe("edge cases", () => {
    it("should handle type aliases", () => {
      const source = `type Apply<F<_>> = <A, B>(fa: F<A>, fab: F<(a: A) => B>) => F<B>;`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("Apply<F>");
      expect(code).toContain("Kind<F, A>");
    });

    it("should not affect source without HKT syntax", () => {
      const source = `interface Regular<T> { value: T; }`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(false);
      expect(code).toBe(source);
    });

    it("should preserve formatting as much as possible", () => {
      const source = `interface Functor<F<_>> {\n  map: <A>(fa: F<A>) => void;\n}`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("\n");
    });
  });

  describe("whitespace handling", () => {
    it("should handle whitespace in HKT usage F < A >", () => {
      const source = `interface Functor<F<_>> { map: (fa: F < A >) => void; }`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      // Whitespace is preserved in the output since we use token-based slicing
      expect(code).toContain("Kind<F,");
      expect(code).toContain("A >");
    });

    it("should handle newlines in HKT usage", () => {
      const source = `interface Functor<F<_>> {
  map: (fa: F<
    A
  >) => void;
}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("Kind<F,");
    });

    it("should handle whitespace around declaration F < _ >", () => {
      const source = `interface Functor< F < _ > > {}`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("Functor<");
      expect(code).toContain("F");
      expect(code).not.toContain("<_>");
    });
  });

  describe("braceless arrow functions", () => {
    it("should handle HKT in braceless arrow function return type", () => {
      const source = `type Lift<F<_>> = <A, B>(f: (a: A) => B) => (fa: F<A>) => F<B>;`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("Lift<F>");
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
    });

    it("should not leak HKT params outside braceless scope", () => {
      const source = `type Foo<F<_>> = (fa: F<A>) => F<B>;
type Bar<G> = G<A>;`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      // F should be rewritten in Foo's scope
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
      // G should NOT be rewritten (no <_> declaration)
      expect(code).toContain("G<A>");
    });

    it("should handle semicolon-terminated type aliases", () => {
      const source = `type Map<F<_>> = <A, B>(fa: F<A>, f: (a: A) => B) => F<B>; const x = 1;`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
      expect(code).toContain("const x = 1");
    });
  });
});

describe("Import Tracker", () => {
  describe("scanImports", () => {
    it("should detect $ import from typesugar packages", () => {
      const source = `import { $ } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBe("$");
    });

    it("should detect Kind import from typesugar packages", () => {
      const source = `import { Kind } from "@typesugar/type-system";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBe("Kind");
    });

    it("should handle aliased $ import", () => {
      const source = `import { $ as HKT } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBe("HKT");
    });

    it("should NOT detect $ from non-typesugar packages", () => {
      const source = `import $ from "jquery";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBeNull();
    });

    it("should detect HKT type functions", () => {
      const source = `import { $, OptionF, EitherF } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.typeFunctions.has("OptionF")).toBe(true);
      expect(imports.typeFunctions.has("EitherF")).toBe(true);
      expect(imports.typeFunctions.get("OptionF")?.concrete).toBe("Option");
      expect(imports.typeFunctions.get("EitherF")?.concrete).toBe("Either");
    });

    it("should handle aliased type functions", () => {
      const source = `import { OptionF as OF } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.typeFunctions.has("OF")).toBe(true);
      expect(imports.typeFunctions.get("OF")?.concrete).toBe("Option");
    });

    it("should track concrete type imports", () => {
      const source = `import { $, OptionF, Option } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.typeFunctions.get("OptionF")?.localConcrete).toBe("Option");
    });

    it("should handle aliased concrete types", () => {
      const source = `import { $, OptionF, Option as Opt } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.typeFunctions.get("OptionF")?.localConcrete).toBe("Opt");
    });

    it("should identify parameterized type functions", () => {
      const source = `import { EitherF, StateF } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.typeFunctions.get("EitherF")?.isParameterized).toBe(true);
      expect(imports.typeFunctions.get("StateF")?.isParameterized).toBe(true);
    });

    it("should handle type-only imports", () => {
      const source = `import type { $, OptionF } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBe("$");
      expect(imports.typeFunctions.has("OptionF")).toBe(true);
    });

    it("should handle inline type imports", () => {
      const source = `import { $, type OptionF } from "@typesugar/fp";`;
      const imports = scanImports(source);
      expect(imports.hktOperator).toBe("$");
      expect(imports.typeFunctions.has("OptionF")).toBe(true);
    });
  });
});

describe("HKT Resolution (Kind<TypeF, A> or $<TypeF, A> → Type<A>)", () => {
  describe("basic resolution", () => {
    it("should resolve $<OptionF, number> to Option<number>", () => {
      const source = `
import { $, OptionF, Option } from "@typesugar/fp";
const x: $<OptionF, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Option<number>");
      expect(code).not.toContain("$<OptionF");
    });

    it("should resolve $<ArrayF, string> to Array<string>", () => {
      const source = `
import { $, ArrayF } from "@typesugar/type-system";
type Strings = $<ArrayF, string>;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("type Strings = Array<string>");
    });

    it("should resolve $<ListF, boolean> to List<boolean>", () => {
      const source = `
import { $, ListF, List } from "@typesugar/fp";
function get(): $<ListF, boolean> { return []; }
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("function get(): List<boolean>");
    });
  });

  describe("safety - no resolution without proper imports", () => {
    it("should NOT resolve when $ is not from typesugar", () => {
      const source = `
import $ from "jquery";
import { OptionF } from "@typesugar/fp";
const x: $<OptionF, number> = null;
`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("$<OptionF, number>");
    });

    it("should NOT resolve when type function is not imported", () => {
      const source = `
import { $ } from "@typesugar/fp";
interface MyF { _: MyType<this["_"]> }
const x: $<MyF, number> = null;
`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("$<MyF, number>");
    });

    it("should NOT resolve when type function is from non-typesugar package", () => {
      const source = `
import { $ } from "@typesugar/fp";
import { CustomF } from "./my-types";
const x: $<CustomF, number> = null;
`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      expect(code).toContain("$<CustomF, number>");
    });
  });

  describe("aliased imports", () => {
    it("should handle aliased $ (Kind)", () => {
      const source = `
import { $ as Kind, OptionF, Option } from "@typesugar/fp";
const x: Kind<OptionF, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Option<number>");
    });

    it("should handle aliased type function", () => {
      const source = `
import { $, OptionF as OF, Option } from "@typesugar/fp";
const x: $<OF, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Option<number>");
    });

    it("should use aliased concrete type name", () => {
      const source = `
import { $, OptionF, Option as Opt } from "@typesugar/fp";
const x: $<OptionF, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Opt<number>");
    });

    it("should handle fully aliased imports", () => {
      const source = `
import { $ as K, OptionF as OF, Option as O } from "@typesugar/fp";
const x: K<OF, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: O<number>");
    });
  });

  describe("parameterized type functions", () => {
    it("should resolve $<EitherF<string>, number> to Either<string, number>", () => {
      const source = `
import { $, EitherF, Either } from "@typesugar/fp";
const x: $<EitherF<string>, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Either<string, number>");
    });

    it("should resolve $<StateF<Config>, A> to State<Config, A>", () => {
      const source = `
import { $, StateF, State } from "@typesugar/fp";
type MyState<A> = $<StateF<Config>, A>;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("type MyState<A> = State<Config, A>");
    });

    it("should handle complex fixed args", () => {
      const source = `
import { $, EitherF, Either } from "@typesugar/fp";
const x: $<EitherF<Error | string>, number> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const x: Either<Error | string, number>");
    });
  });

  describe("unbound type parameters", () => {
    it("should NOT resolve Kind<F, A> when F is from F<_> declaration", () => {
      const source = `
import { Kind } from "@typesugar/fp";
function map<F<_>, A, B>(fa: Kind<F, A>): Kind<F, B> {}
`;
      const { code } = preprocess(source, { extensions: ["hkt"] });
      // F<_> becomes F, but Kind<F, A> should NOT be resolved (F is a type param)
      expect(code).toContain("Kind<F, A>");
      expect(code).toContain("Kind<F, B>");
    });

    it("should resolve known types while preserving unbound params", () => {
      const source = `
import { Kind, OptionF, Option } from "@typesugar/fp";
function wrap<F<_>, A>(a: A): Kind<F, Kind<OptionF, A>> {}
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      // Inner Kind<OptionF, A> should be resolved, outer Kind<F, ...> should not
      expect(code).toContain("Kind<F, Option<A>>");
    });
  });

  describe("format mode preservation", () => {
    it("should NOT resolve in format mode", () => {
      const source = `
import { $, OptionF, Option } from "@typesugar/fp";
const x: $<OptionF, number> = null;
`;
      const { code } = preprocess(source, { extensions: ["hkt"], mode: "format" });
      // Format mode should preserve $<> for round-tripping
      expect(code).toContain("$<OptionF, number>");
    });
  });

  describe("multiple resolutions", () => {
    it("should resolve multiple HKT applications in one file", () => {
      const source = `
import { $, OptionF, ListF, Option, List } from "@typesugar/fp";
const a: $<OptionF, number> = null;
const b: $<ListF, string> = [];
const c: $<OptionF, boolean> = null;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("const a: Option<number>");
      expect(code).toContain("const b: List<string>");
      expect(code).toContain("const c: Option<boolean>");
    });
  });

  describe("nested HKT applications", () => {
    it("should resolve nested $<OptionF, $<ListF, A>>", () => {
      const source = `
import { $, OptionF, ListF, Option, List } from "@typesugar/fp";
type NestedType<A> = $<OptionF, $<ListF, A>>;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("type NestedType<A> = Option<List<A>>");
      expect(code).not.toContain("$<");
    });

    it("should resolve deeply nested HKT applications", () => {
      const source = `
import { $, OptionF, ListF, EitherF, Option, List, Either } from "@typesugar/fp";
type Deep<A> = $<OptionF, $<ListF, $<EitherF<string>, A>>>;
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("type Deep<A> = Option<List<Either<string, A>>>");
      expect(code).not.toContain("$<");
    });

    it("should resolve multiple nested applications in one type", () => {
      const source = `
import { $, OptionF, ListF, Option, List } from "@typesugar/fp";
interface Container<A> {
  opt: $<OptionF, $<ListF, A>>;
  list: $<ListF, $<OptionF, A>>;
}
`;
      const { code, changed } = preprocess(source, { extensions: ["hkt"] });
      expect(changed).toBe(true);
      expect(code).toContain("opt: Option<List<A>>");
      expect(code).toContain("list: List<Option<A>>");
      expect(code).not.toContain("$<");
    });
  });
});
