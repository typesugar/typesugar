/**
 * Tests for the macro hygiene system
 */

import { describe, it, expect, beforeEach } from "vitest";
import { HygieneContext } from "../src/core/hygiene.js";

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
        expect(name).toMatch(/^__typemacro_temp_s\d+_\d+__$/);
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
      expect(name1).toMatch(/^__typemacro_x_\d+__$/);
      expect(name1).not.toBe(name2); // Different because no scope caching
    });
  });

  describe("identifier creation", () => {
    it("should create hygienic identifiers", () => {
      hygiene.withScope(() => {
        const id = hygiene.createIdentifier("result");
        expect(id.text).toMatch(/^__typemacro_result_s\d+_\d+__$/);
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
        expect(name).toBe("__typemacro_x_s0_0__");
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
        expect(trName).toMatch(/^__typemacro_tr_n_s\d+_\d+__$/);
      });
    });

    it("should not collide with user variables named __args", () => {
      hygiene.withScope(() => {
        const argsName = hygiene.mangleName("args");
        // The mangled name should NOT be "__args" which could collide with user code
        expect(argsName).not.toBe("__args");
        expect(argsName).toMatch(/^__typemacro_args_s\d+_\d+__$/);
      });
    });

    it("should not collide with user variables named __p*", () => {
      hygiene.withScope(() => {
        const p0Name = hygiene.mangleName("p0");
        const p1Name = hygiene.mangleName("p1");
        // The mangled names should NOT be "__p0", "__p1" which could collide with user code
        expect(p0Name).not.toBe("__p0");
        expect(p1Name).not.toBe("__p1");
        expect(p0Name).toMatch(/^__typemacro_p0_s\d+_\d+__$/);
        expect(p1Name).toMatch(/^__typemacro_p1_s\d+_\d+__$/);
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
