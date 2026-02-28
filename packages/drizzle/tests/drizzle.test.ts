/**
 * Tests for @typesugar/drizzle-adapter
 *
 * Tests runtime placeholders, macro definitions, and DrizzleQueryable.
 * Comprehensive edge case testing is in root-level tests/red-team-drizzle.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  dsql,
  ref$,
  id$,
  join$,
  raw$,
  dsqlMacro,
  refMacro,
  idMacro,
  joinMacro,
  rawMacro,
  DrizzleQueryable,
  register,
} from "../src/index.js";

describe("@typesugar/drizzle-adapter", () => {
  describe("runtime placeholders throw errors", () => {
    it("dsql throws without transformer", () => {
      expect(() => dsql`SELECT 1`).toThrow("not transformed at compile time");
    });

    it("ref$ throws without transformer", () => {
      expect(() => ref$("users.id")).toThrow("not transformed at compile time");
    });

    it("id$ throws without transformer", () => {
      expect(() => id$("column")).toThrow("not transformed at compile time");
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
      expect(dsqlMacro.name).toBe("dsql");
      expect(refMacro.name).toBe("ref$");
      expect(idMacro.name).toBe("id$");
      expect(joinMacro.name).toBe("join$");
      expect(rawMacro.name).toBe("raw$");
    });

    it("macros have expand functions", () => {
      expect(typeof dsqlMacro.expand).toBe("function");
      expect(typeof refMacro.expand).toBe("function");
      expect(typeof idMacro.expand).toBe("function");
      expect(typeof joinMacro.expand).toBe("function");
      expect(typeof rawMacro.expand).toBe("function");
    });

    it("dsqlMacro has validate function", () => {
      expect(typeof dsqlMacro.validate).toBe("function");
    });
  });

  describe("DrizzleQueryable", () => {
    it("is exported and has execute method", () => {
      expect(DrizzleQueryable).toBeDefined();
      expect(typeof DrizzleQueryable.execute).toBe("function");
    });

    it("execute calls connection.query with sql and params", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT * FROM users WHERE id = $1", params: [123] }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([{ id: 123, name: "Test" }]),
      };

      const result = await DrizzleQueryable.execute(mockQuery, mockConnection as never);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [123]);
      expect(result).toEqual([{ id: 123, name: "Test" }]);
    });

    it("execute propagates query errors", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT * FROM nonexistent", params: [] }),
      };

      const mockConnection = {
        query: vi.fn().mockRejectedValue(new Error("Table not found")),
      };

      await expect(DrizzleQueryable.execute(mockQuery, mockConnection as never)).rejects.toThrow(
        "Table not found"
      );
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
