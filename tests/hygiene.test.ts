/**
 * Tests for the macro hygiene system
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { HygieneContext, FileBindingCache, KNOWN_GLOBALS } from "@typesugar/core";

describe("macro hygiene system", () => {
  let hygiene: HygieneContext;

  beforeEach(() => {
    hygiene = new HygieneContext();
  });

  describe("scope management", () => {
    it("should report not in scope at top level", () => {
      expect(hygiene.isInScope()).toBe(false);
    });

    it("should report in scope inside withScope", () => {
      hygiene.withScope(() => {
        expect(hygiene.isInScope()).toBe(true);
      });
      expect(hygiene.isInScope()).toBe(false);
    });

    it("should track scope depth", () => {
      expect(hygiene.getScopeDepth()).toBe(0);

      hygiene.withScope(() => {
        expect(hygiene.getScopeDepth()).toBe(1);

        hygiene.withScope(() => {
          expect(hygiene.getScopeDepth()).toBe(2);
        });

        expect(hygiene.getScopeDepth()).toBe(1);
      });

      expect(hygiene.getScopeDepth()).toBe(0);
    });
  });

  describe("name mangling", () => {
    it("should mangle names inside a scope", () => {
      hygiene.withScope(() => {
        const name = hygiene.mangleName("temp");
        expect(name).toMatch(/^__typesugar_temp_s\d+_\d+__$/);
      });
    });

    it("should return the same mangled name for the same input in the same scope", () => {
      hygiene.withScope(() => {
        const name1 = hygiene.mangleName("temp");
        const name2 = hygiene.mangleName("temp");
        expect(name1).toBe(name2);
      });
    });

    it("should return different mangled names for different inputs", () => {
      hygiene.withScope(() => {
        const name1 = hygiene.mangleName("a");
        const name2 = hygiene.mangleName("b");
        expect(name1).not.toBe(name2);
      });
    });

    it("should return different mangled names in different scopes", () => {
      let name1: string;
      let name2: string;

      hygiene.withScope(() => {
        name1 = hygiene.mangleName("temp");
      });

      hygiene.withScope(() => {
        name2 = hygiene.mangleName("temp");
      });

      expect(name1!).not.toBe(name2!);
    });

    it("should mangle names outside scope with global counter", () => {
      const name1 = hygiene.mangleName("x");
      const name2 = hygiene.mangleName("x");
      expect(name1).toMatch(/^__typesugar_x_\d+__$/);
      expect(name1).not.toBe(name2); // Different because no scope caching
    });
  });

  describe("identifier creation", () => {
    it("should create hygienic identifiers", () => {
      hygiene.withScope(() => {
        const id = hygiene.createIdentifier("result");
        expect(id.text).toMatch(/^__typesugar_result_s\d+_\d+__$/);
      });
    });

    it("should create unhygienic identifiers", () => {
      const id = hygiene.createUnhygienicIdentifier("result");
      expect(id.text).toBe("result");
    });
  });

  describe("scope introspection", () => {
    it("should track introduced names", () => {
      hygiene.withScope(() => {
        expect(hygiene.isIntroducedInCurrentScope("temp")).toBe(false);
        hygiene.mangleName("temp");
        expect(hygiene.isIntroducedInCurrentScope("temp")).toBe(true);
      });
    });

    it("should list current scope names", () => {
      hygiene.withScope(() => {
        hygiene.mangleName("a");
        hygiene.mangleName("b");
        const names = hygiene.getCurrentScopeNames();
        expect(names.size).toBe(2);
        expect(names.has("a")).toBe(true);
        expect(names.has("b")).toBe(true);
      });
    });
  });

  describe("reset", () => {
    it("should reset all state", () => {
      hygiene.withScope(() => {
        hygiene.mangleName("x");
      });

      hygiene.reset();

      // After reset, scope counter starts from 0 again
      hygiene.withScope(() => {
        const name = hygiene.mangleName("x");
        expect(name).toBe("__typesugar_x_s0_0__");
      });
    });
  });

  describe("nested macro expansion hygiene", () => {
    it("should generate unique names for nested scopes with same logical name", () => {
      const outerNames: string[] = [];
      const innerNames: string[] = [];

      hygiene.withScope(() => {
        outerNames.push(hygiene.mangleName("temp"));
        outerNames.push(hygiene.mangleName("result"));

        hygiene.withScope(() => {
          innerNames.push(hygiene.mangleName("temp"));
          innerNames.push(hygiene.mangleName("result"));
        });
      });

      // Inner and outer should be different (different scope IDs)
      expect(outerNames[0]).not.toBe(innerNames[0]);
      expect(outerNames[1]).not.toBe(innerNames[1]);

      // Outer names should have s0, inner names should have s1
      expect(outerNames[0]).toMatch(/_s0_/);
      expect(innerNames[0]).toMatch(/_s1_/);
    });

    it("should not collide with user variables named _tr_*", () => {
      hygiene.withScope(() => {
        const trName = hygiene.mangleName("tr_n");
        // The mangled name should NOT be "_tr_n" which could collide with user code
        expect(trName).not.toBe("_tr_n");
        expect(trName).toMatch(/^__typesugar_tr_n_s\d+_\d+__$/);
      });
    });

    it("should not collide with user variables named __args", () => {
      hygiene.withScope(() => {
        const argsName = hygiene.mangleName("args");
        // The mangled name should NOT be "__args" which could collide with user code
        expect(argsName).not.toBe("__args");
        expect(argsName).toMatch(/^__typesugar_args_s\d+_\d+__$/);
      });
    });

    it("should not collide with user variables named __p*", () => {
      hygiene.withScope(() => {
        const p0Name = hygiene.mangleName("p0");
        const p1Name = hygiene.mangleName("p1");
        // The mangled names should NOT be "__p0", "__p1" which could collide with user code
        expect(p0Name).not.toBe("__p0");
        expect(p1Name).not.toBe("__p1");
        expect(p0Name).toMatch(/^__typesugar_p0_s\d+_\d+__$/);
        expect(p1Name).toMatch(/^__typesugar_p1_s\d+_\d+__$/);
      });
    });
  });

  describe("scope isolation across macro types", () => {
    it("should isolate names between sequential macro expansions", () => {
      const expansion1Names: string[] = [];
      const expansion2Names: string[] = [];

      // Simulate two sequential macro expansions (e.g., two specialize calls)
      hygiene.withScope(() => {
        expansion1Names.push(hygiene.mangleName("args"));
        expansion1Names.push(hygiene.mangleName("param"));
      });

      hygiene.withScope(() => {
        expansion2Names.push(hygiene.mangleName("args"));
        expansion2Names.push(hygiene.mangleName("param"));
      });

      // Each expansion should get unique names
      expect(expansion1Names[0]).not.toBe(expansion2Names[0]);
      expect(expansion1Names[1]).not.toBe(expansion2Names[1]);
    });

    it("should maintain consistency within a single expansion", () => {
      hygiene.withScope(() => {
        // First reference to "temp"
        const temp1 = hygiene.mangleName("temp");
        // Some other names in between
        hygiene.mangleName("other");
        hygiene.mangleName("another");
        // Second reference to "temp" - should be the same
        const temp2 = hygiene.mangleName("temp");

        expect(temp1).toBe(temp2);
      });
    });

    it("should support multiple macro expansion patterns", () => {
      // Simulate tailrec-style parameter mangling
      const tailrecNames: string[] = [];
      hygiene.withScope(() => {
        tailrecNames.push(hygiene.mangleName("tr_n"));
        tailrecNames.push(hygiene.mangleName("tr_next_n"));
      });

      // Simulate specialize-style args mangling
      const specializeNames: string[] = [];
      hygiene.withScope(() => {
        specializeNames.push(hygiene.mangleName("args"));
        specializeNames.push(hygiene.mangleName("param_0"));
      });

      // All names should be globally unique
      const allNames = [...tailrecNames, ...specializeNames];
      const uniqueNames = new Set(allNames);
      expect(uniqueNames.size).toBe(allNames.length);
    });
  });
});

// =============================================================================
// Reference Hygiene (FileBindingCache & safeRef)
// =============================================================================

describe("reference hygiene (FileBindingCache)", () => {
  function createSourceFile(source: string, fileName = "test.ts"): ts.SourceFile {
    return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }

  describe("KNOWN_GLOBALS", () => {
    it("should include common JS globals", () => {
      expect(KNOWN_GLOBALS.has("Error")).toBe(true);
      expect(KNOWN_GLOBALS.has("Array")).toBe(true);
      expect(KNOWN_GLOBALS.has("JSON")).toBe(true);
      expect(KNOWN_GLOBALS.has("Promise")).toBe(true);
      expect(KNOWN_GLOBALS.has("Map")).toBe(true);
      expect(KNOWN_GLOBALS.has("Set")).toBe(true);
      expect(KNOWN_GLOBALS.has("console")).toBe(true);
      expect(KNOWN_GLOBALS.has("undefined")).toBe(true);
    });

    it("should not include user-defined names", () => {
      expect(KNOWN_GLOBALS.has("Eq")).toBe(false);
      expect(KNOWN_GLOBALS.has("Show")).toBe(false);
      expect(KNOWN_GLOBALS.has("myFunction")).toBe(false);
    });
  });

  describe("import map collection", () => {
    it("should collect named imports", () => {
      const source = `
        import { Eq, Ord, Show } from "@typesugar/std";
        import { Option, Result } from "@typesugar/fp";
      `;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.get("Eq")).toBe("@typesugar/std");
      expect(cache.importMap.get("Ord")).toBe("@typesugar/std");
      expect(cache.importMap.get("Show")).toBe("@typesugar/std");
      expect(cache.importMap.get("Option")).toBe("@typesugar/fp");
      expect(cache.importMap.get("Result")).toBe("@typesugar/fp");
    });

    it("should collect aliased imports", () => {
      const source = `import { Eq as MyEq, Ord as MyOrd } from "@typesugar/std";`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.get("MyEq")).toBe("@typesugar/std");
      expect(cache.importMap.get("MyOrd")).toBe("@typesugar/std");
      expect(cache.importMap.has("Eq")).toBe(false);
      expect(cache.importMap.has("Ord")).toBe(false);
    });

    it("should collect default imports", () => {
      const source = `import React from "react";`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.get("React")).toBe("react");
    });

    it("should not collect namespace imports as individual names", () => {
      const source = `import * as std from "@typesugar/std";`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.has("std")).toBe(false);
      expect(cache.importMap.has("Eq")).toBe(false);
    });
  });

  describe("local declarations collection", () => {
    it("should collect const declarations", () => {
      const source = `const x = 1; const y = 2;`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("x")).toBe(true);
      expect(cache.localDecls.has("y")).toBe(true);
    });

    it("should collect let and var declarations", () => {
      const source = `let a = 1; var b = 2;`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("a")).toBe(true);
      expect(cache.localDecls.has("b")).toBe(true);
    });

    it("should collect function declarations", () => {
      const source = `function foo() {} function bar() {}`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("foo")).toBe(true);
      expect(cache.localDecls.has("bar")).toBe(true);
    });

    it("should collect class declarations", () => {
      const source = `class MyClass {} class AnotherClass {}`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("MyClass")).toBe(true);
      expect(cache.localDecls.has("AnotherClass")).toBe(true);
    });

    it("should collect interface declarations", () => {
      const source = `interface IFoo {} interface IBar {}`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("IFoo")).toBe(true);
      expect(cache.localDecls.has("IBar")).toBe(true);
    });

    it("should collect type alias declarations", () => {
      const source = `type Foo = string; type Bar = number;`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("Foo")).toBe(true);
      expect(cache.localDecls.has("Bar")).toBe(true);
    });

    it("should collect enum declarations", () => {
      const source = `enum Color { Red, Green, Blue }`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("Color")).toBe(true);
    });

    it("should collect destructured declarations", () => {
      const source = `const { a, b } = obj; const [x, y] = arr;`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.localDecls.has("a")).toBe(true);
      expect(cache.localDecls.has("b")).toBe(true);
      expect(cache.localDecls.has("x")).toBe(true);
      expect(cache.localDecls.has("y")).toBe(true);
    });
  });

  describe("safeRef Tier 0 (known globals)", () => {
    it("should return bare identifier for known globals", () => {
      const source = `const x = 1;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Error", "@typesugar/std");
      expect(id.text).toBe("Error");
    });

    it("should not create aliases for known globals even if 'imported'", () => {
      const source = `import { Error } from "some-module";`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Error", "@typesugar/std");
      expect(id.text).toBe("Error");
      expect(cache.hasPendingImports()).toBe(false);
    });
  });

  describe("safeRef Tier 1 (import map)", () => {
    it("should return bare identifier if imported from same module", () => {
      const source = `import { Eq, Ord } from "@typesugar/std";`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toBe("Eq");
      expect(cache.hasPendingImports()).toBe(false);
    });

    it("should create aliased import if imported from different module", () => {
      const source = `import { Eq } from "./my-utils";`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toMatch(/^__Eq_ts\d+__$/);
      expect(cache.hasPendingImports()).toBe(true);
    });
  });

  describe("safeRef Tier 2 (local declarations)", () => {
    it("should return bare identifier if name not in scope", () => {
      const source = `const x = 1;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toBe("Eq");
      expect(cache.hasPendingImports()).toBe(false);
    });

    it("should create aliased import if name is locally declared", () => {
      const source = `const Eq = 42;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toMatch(/^__Eq_ts\d+__$/);
      expect(cache.hasPendingImports()).toBe(true);
    });

    it("should create aliased import if name is a local function", () => {
      const source = `function Eq() {}`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toMatch(/^__Eq_ts\d+__$/);
      expect(cache.hasPendingImports()).toBe(true);
    });

    it("should create aliased import if name is a local class", () => {
      const source = `class Eq {}`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toMatch(/^__Eq_ts\d+__$/);
      expect(cache.hasPendingImports()).toBe(true);
    });
  });

  describe("alias deduplication", () => {
    it("should reuse the same alias for repeated safeRef calls", () => {
      const source = `const Eq = 42;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id1 = cache.safeRef("Eq", "@typesugar/std");
      const id2 = cache.safeRef("Eq", "@typesugar/std");
      const id3 = cache.safeRef("Eq", "@typesugar/std");
      expect(id1.text).toBe(id2.text);
      expect(id2.text).toBe(id3.text);
    });

    it("should create different aliases for different modules", () => {
      const source = `const Eq = 42;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id1 = cache.safeRef("Eq", "@typesugar/std");
      const id2 = cache.safeRef("Eq", "@typesugar/fp");
      expect(id1.text).not.toBe(id2.text);
    });

    it("should create different aliases for different symbols", () => {
      const source = `const Eq = 42; const Show = 43;`;
      const cache = new FileBindingCache(createSourceFile(source));
      const id1 = cache.safeRef("Eq", "@typesugar/std");
      const id2 = cache.safeRef("Show", "@typesugar/std");
      expect(id1.text).not.toBe(id2.text);
    });
  });

  describe("getPendingImports", () => {
    it("should return empty array when no conflicts", () => {
      const source = `import { Eq } from "@typesugar/std";`;
      const cache = new FileBindingCache(createSourceFile(source));
      cache.safeRef("Eq", "@typesugar/std");
      expect(cache.getPendingImports()).toHaveLength(0);
    });

    it("should return import declarations for conflicts", () => {
      const source = `const Eq = 42;`;
      const cache = new FileBindingCache(createSourceFile(source));
      cache.safeRef("Eq", "@typesugar/std");
      const imports = cache.getPendingImports();
      expect(imports).toHaveLength(1);
      expect(ts.isImportDeclaration(imports[0])).toBe(true);
    });

    it("should group imports by module", () => {
      const source = `const Eq = 42; const Ord = 43;`;
      const cache = new FileBindingCache(createSourceFile(source));
      cache.safeRef("Eq", "@typesugar/std");
      cache.safeRef("Ord", "@typesugar/std");
      const imports = cache.getPendingImports();
      // Should be grouped into a single import declaration
      expect(imports).toHaveLength(1);

      // Verify the import has both specifiers
      const importDecl = imports[0];
      const clause = importDecl.importClause;
      expect(clause?.namedBindings && ts.isNamedImports(clause.namedBindings)).toBe(true);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        expect(clause.namedBindings.elements).toHaveLength(2);
      }
    });

    it("should create separate imports for different modules", () => {
      const source = `const Eq = 42; const Option = 43;`;
      const cache = new FileBindingCache(createSourceFile(source));
      cache.safeRef("Eq", "@typesugar/std");
      cache.safeRef("Option", "@typesugar/fp");
      const imports = cache.getPendingImports();
      expect(imports).toHaveLength(2);
    });
  });

  describe("stats tracking", () => {
    it("should track tier hits", () => {
      const source = `
        import { Eq } from "@typesugar/std";
        const Show = 42;
      `;
      const cache = new FileBindingCache(createSourceFile(source));

      cache.safeRef("Error", "@typesugar/std"); // Tier 0
      cache.safeRef("Eq", "@typesugar/std"); // Tier 1 (no conflict)
      cache.safeRef("Show", "@typesugar/std"); // Tier 2 (conflict)
      cache.safeRef("Ord", "@typesugar/std"); // Tier 2 (no conflict)

      const stats = cache.getStats();
      expect(stats.tier0).toBe(1);
      expect(stats.tier1).toBe(1);
      expect(stats.tier2).toBe(2);
      expect(stats.conflicts).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty source files", () => {
      const cache = new FileBindingCache(createSourceFile(""));
      expect(cache.importMap.size).toBe(0);
      expect(cache.localDecls.size).toBe(0);
      const id = cache.safeRef("Eq", "@typesugar/std");
      expect(id.text).toBe("Eq");
    });

    it("should handle side-effect-only imports", () => {
      const source = `import "reflect-metadata";`;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.size).toBe(0);
    });

    it("should handle mixed import styles", () => {
      const source = `
        import React, { useState, useEffect } from "react";
        import * as utils from "./utils";
        import type { SomeType } from "./types";
      `;
      const cache = new FileBindingCache(createSourceFile(source));
      expect(cache.importMap.get("React")).toBe("react");
      expect(cache.importMap.get("useState")).toBe("react");
      expect(cache.importMap.get("useEffect")).toBe("react");
      // Namespace imports don't add individual names
      expect(cache.importMap.has("utils")).toBe(false);
      // Type-only imports still add to the map
      expect(cache.importMap.get("SomeType")).toBe("./types");
    });
  });
});
