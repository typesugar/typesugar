/**
 * Tests for @typesugar/kysely-adapter
 *
 * Tests runtime placeholders, macro definitions, and KyselyQueryable.
 * Comprehensive edge case testing is in root-level tests/red-team-kysely.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ksql,
  ref$,
  table$,
  id$,
  lit$,
  join$,
  raw$,
  ksqlMacro,
  refMacro,
  tableMacro,
  idMacro,
  litMacro,
  joinMacro,
  rawMacro,
  KyselyQueryable,
  register,
  type Column,
  type Generated,
  type Nullable,
} from "../src/index.js";

describe("@typesugar/kysely-adapter", () => {
  describe("runtime placeholders throw errors", () => {
    it("ksql throws without transformer", () => {
      expect(() => ksql`SELECT 1`).toThrow("not transformed at compile time");
    });

    it("ref$ throws without transformer", () => {
      expect(() => ref$("users.id")).toThrow("not transformed at compile time");
    });

    it("table$ throws without transformer", () => {
      expect(() => table$("users")).toThrow("not transformed at compile time");
    });

    it("id$ throws without transformer", () => {
      expect(() => id$("column")).toThrow("not transformed at compile time");
    });

    it("lit$ throws without transformer", () => {
      expect(() => lit$("DESC")).toThrow("not transformed at compile time");
    });

    it("join$ throws without transformer", () => {
      expect(() => join$(["a", "b"])).toThrow("not transformed at compile time");
    });

    it("raw$ throws without transformer", () => {
      expect(() => raw$("NOW()")).toThrow("not transformed at compile time");
    });
  });

  describe("macro definitions", () => {
    it("macros have correct names", () => {
      expect(ksqlMacro.name).toBe("ksql");
      expect(refMacro.name).toBe("ref$");
      expect(tableMacro.name).toBe("table$");
      expect(idMacro.name).toBe("id$");
      expect(litMacro.name).toBe("lit$");
      expect(joinMacro.name).toBe("join$");
      expect(rawMacro.name).toBe("raw$");
    });

    it("macros have expand functions", () => {
      expect(typeof ksqlMacro.expand).toBe("function");
      expect(typeof refMacro.expand).toBe("function");
      expect(typeof tableMacro.expand).toBe("function");
      expect(typeof idMacro.expand).toBe("function");
      expect(typeof litMacro.expand).toBe("function");
      expect(typeof joinMacro.expand).toBe("function");
      expect(typeof rawMacro.expand).toBe("function");
    });

    it("ksqlMacro has validate function", () => {
      expect(typeof ksqlMacro.validate).toBe("function");
    });
  });

  describe("KyselyQueryable", () => {
    it("is exported and has execute method", () => {
      expect(KyselyQueryable).toBeDefined();
      expect(typeof KyselyQueryable.execute).toBe("function");
    });

    it("execute calls connection.query with sql and parameters", async () => {
      const mockQuery = {
        compile: () => ({
          sql: "SELECT * FROM users WHERE id = ?",
          parameters: [123],
        }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([{ id: 123, name: "Test" }]),
      };

      const result = await KyselyQueryable.execute(mockQuery, mockConnection as never);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?", [123]);
      expect(result).toEqual([{ id: 123, name: "Test" }]);
    });

    it("execute propagates query errors", async () => {
      const mockQuery = {
        compile: () => ({ sql: "SELECT * FROM nonexistent", parameters: [] }),
      };

      const mockConnection = {
        query: vi.fn().mockRejectedValue(new Error("Table not found")),
      };

      await expect(KyselyQueryable.execute(mockQuery, mockConnection as never)).rejects.toThrow(
        "Table not found"
      );
    });
  });

  describe("type helpers", () => {
    it("Column<T> is transparent at runtime", () => {
      const col: Column<string> = "test";
      expect(col).toBe("test");
    });

    it("Generated<T> is transparent at runtime", () => {
      const gen: Generated<number> = 42;
      expect(gen).toBe(42);
    });

    it("Nullable<T> correctly unions with null", () => {
      const nullable1: Nullable<string> = "test";
      const nullable2: Nullable<string> = null;
      expect(nullable1).toBe("test");
      expect(nullable2).toBeNull();
    });
  });

  describe("register function", () => {
    it("is exported", () => {
      expect(typeof register).toBe("function");
    });

    it("is idempotent", () => {
      expect(() => {
        register();
        register();
      }).not.toThrow();
    });
  });
});
