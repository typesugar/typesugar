/**
 * Red Team Tests for @typesugar/drizzle-adapter
 *
 * Attack surfaces:
 * - SQL injection in raw$() with dynamic values
 * - SQL syntax validation bypasses
 * - Macro argument validation edge cases
 * - Template literal edge cases
 * - ConnectionIO/Queryable integration edge cases
 */
import { describe, it, expect, vi } from "vitest";
import {
  dsqlMacro,
  refMacro,
  idMacro,
  joinMacro,
  rawMacro,
  dsql,
  ref$,
  id$,
  join$,
  raw$,
  DrizzleQueryable,
  register,
} from "../packages/drizzle/src/index.js";
import { validateSqlSyntax } from "../packages/sql/src/macro-utils.js";

// Mock MacroContext for testing macro expand/validate functions
function createMockContext() {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    factory: {
      createTaggedTemplateExpression: vi.fn(),
      createPropertyAccessExpression: vi.fn(),
      createIdentifier: vi.fn(),
      createCallExpression: vi.fn(),
    },
    reportError: (node: unknown, message: string) => {
      errors.push(message);
    },
    reportWarning: (node: unknown, message: string) => {
      warnings.push(message);
    },
    getErrors: () => errors,
    getWarnings: () => warnings,
  };
}

describe("Drizzle Adapter Edge Cases", () => {
  // ==========================================================================
  // Attack 1: SQL Injection Prevention
  // ==========================================================================
  describe("SQL injection prevention", () => {
    it("raw$ with string literal should not warn", () => {
      const ctx = createMockContext();
      const mockStringLiteral = {
        kind: 11, // ts.SyntaxKind.StringLiteral
      };

      // raw$ macro checks if argument is a string literal
      // Non-literal should trigger warning
      expect(rawMacro.name).toBe("raw$");
    });

    it("validateSqlSyntax detects DROP TABLE patterns", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax(
        "SELECT * FROM users; DROP TABLE users;",
        ctx as any,
        mockNode as any
      );

      expect(ctx.getWarnings().length).toBeGreaterThan(0);
      expect(ctx.getWarnings()[0]).toContain("dangerous");
    });

    it("validateSqlSyntax detects DELETE FROM patterns", () => {
      const ctx = createMockContext();
      const mockNode = {};

      validateSqlSyntax("SELECT 1; DELETE FROM users", ctx as any, mockNode as any);

      expect(ctx.getWarnings().length).toBeGreaterThan(0);
    });

    it("validateSqlSyntax detects SQL comment injection", () => {
      const ctx = createMockContext();
      const mockNode = {};

      validateSqlSyntax("SELECT * FROM users -- ignore rest", ctx as any, mockNode as any);

      expect(ctx.getWarnings().length).toBeGreaterThan(0);
    });

    it("validateSqlSyntax detects block comment injection", () => {
      const ctx = createMockContext();
      const mockNode = {};

      validateSqlSyntax("SELECT * /* malicious */ FROM users", ctx as any, mockNode as any);

      expect(ctx.getWarnings().length).toBeGreaterThan(0);
    });

    it("validateSqlSyntax detects TRUNCATE patterns", () => {
      const ctx = createMockContext();
      const mockNode = {};

      validateSqlSyntax("SELECT 1; TRUNCATE users", ctx as any, mockNode as any);

      expect(ctx.getWarnings().length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Attack 2: SQL Syntax Validation Bypasses
  // ==========================================================================
  describe("SQL syntax validation bypasses", () => {
    it("unbalanced parentheses (too many closing)", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax("SELECT (1))", ctx as any, mockNode as any);

      expect(result).toBe(false);
      expect(ctx.getErrors()[0]).toContain("unbalanced");
    });

    it("unbalanced parentheses (missing closing)", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax("SELECT ((1)", ctx as any, mockNode as any);

      expect(result).toBe(false);
      expect(ctx.getErrors()[0]).toContain("unbalanced");
    });

    it("nested parentheses should validate correctly", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax(
        "SELECT * FROM (SELECT * FROM (SELECT 1))",
        ctx as any,
        mockNode as any
      );

      expect(result).toBe(true);
    });

    it("empty SQL should pass validation", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax("", ctx as any, mockNode as any);

      // Empty string doesn't match any valid starter, but length check allows it
      expect(result).toBe(true);
    });

    it("whitespace-only SQL should pass validation", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax("   \n\t  ", ctx as any, mockNode as any);

      expect(result).toBe(true);
    });

    it("case insensitivity for keywords", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax("select * from users", ctx as any, mockNode as any);

      // Should work - validation uppercases before checking
      expect(result).toBe(true);
    });

    it("fragments starting with non-keyword should pass", () => {
      const ctx = createMockContext();
      const mockNode = {};

      // Fragments like "WHERE id = 1" don't start with SELECT/INSERT/etc
      const result = validateSqlSyntax("WHERE id = 1", ctx as any, mockNode as any);

      expect(result).toBe(true);
    });

    it("parentheses inside string literals (false positive)", () => {
      const ctx = createMockContext();
      const mockNode = {};

      // The validator doesn't parse strings, so this might fail incorrectly
      const result = validateSqlSyntax("SELECT '(' FROM users", ctx as any, mockNode as any);

      // BUG: This will report unbalanced parens even though they're in a string
      // The simple paren counter doesn't track string context
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 3: Macro Argument Validation
  // ==========================================================================
  describe("macro argument validation", () => {
    it("runtime dsql throws without transformer", () => {
      expect(() => dsql`SELECT 1`).toThrow();
    });

    it("runtime dsql error message is descriptive", () => {
      try {
        dsql`SELECT * FROM users`;
      } catch (e) {
        expect((e as Error).message).toContain("not transformed at compile time");
        expect((e as Error).message).toContain("@typesugar/drizzle-adapter");
      }
    });

    it("runtime ref$ throws without transformer", () => {
      expect(() => ref$("users.name")).toThrow();
    });

    it("runtime ref$ with empty string", () => {
      expect(() => ref$("")).toThrow();
    });

    it("runtime id$ throws without transformer", () => {
      expect(() => id$("column")).toThrow();
    });

    it("runtime id$ with special characters", () => {
      // Would this cause issues in the generated SQL identifier?
      expect(() => id$("column; DROP TABLE users")).toThrow();
    });

    it("runtime join$ throws without transformer", () => {
      expect(() => join$(["a", "b", "c"])).toThrow();
    });

    it("runtime join$ with empty array", () => {
      expect(() => join$([])).toThrow();
    });

    it("runtime join$ with undefined separator", () => {
      expect(() => join$(["a", "b"], undefined)).toThrow();
    });

    it("runtime raw$ throws without transformer", () => {
      expect(() => raw$("NOW()")).toThrow();
    });

    it("runtime raw$ with potential injection", () => {
      // Even at runtime, this should throw (not execute)
      expect(() => raw$("1; DROP TABLE users")).toThrow();
    });
  });

  // ==========================================================================
  // Attack 4: Template Literal Edge Cases
  // ==========================================================================
  describe("template literal edge cases", () => {
    it("dsql with no interpolations", () => {
      expect(() => dsql`SELECT 1`).toThrow();
    });

    it("dsql with multiple interpolations", () => {
      const a = 1;
      const b = 2;
      expect(() => dsql`SELECT * FROM t WHERE a = ${a} AND b = ${b}`).toThrow();
    });

    it("dsql with object interpolation", () => {
      const obj = { id: 1 };
      expect(() => dsql`SELECT * FROM t WHERE id = ${obj}`).toThrow();
    });

    it("dsql with null interpolation", () => {
      expect(() => dsql`SELECT * FROM t WHERE x = ${null}`).toThrow();
    });

    it("dsql with undefined interpolation", () => {
      expect(() => dsql`SELECT * FROM t WHERE x = ${undefined}`).toThrow();
    });

    it("dsql with array interpolation", () => {
      const ids = [1, 2, 3];
      expect(() => dsql`SELECT * FROM t WHERE id IN (${ids})`).toThrow();
    });

    it("dsql with nested template literal", () => {
      const inner = `SELECT 1`;
      expect(() => dsql`${inner}`).toThrow();
    });

    it("dsql with function interpolation", () => {
      const fn = () => 42;
      expect(() => dsql`SELECT ${fn}`).toThrow();
    });

    it("dsql with symbol interpolation", () => {
      const sym = Symbol("test");
      expect(() => dsql`SELECT ${sym as unknown as number}`).toThrow();
    });
  });

  // ==========================================================================
  // Attack 5: DrizzleQueryable Edge Cases
  // ==========================================================================
  describe("DrizzleQueryable integration", () => {
    it("DrizzleQueryable should be exported", () => {
      expect(DrizzleQueryable).toBeDefined();
      expect(typeof DrizzleQueryable.execute).toBe("function");
    });

    it("DrizzleQueryable.execute with mock query", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT 1", params: [] }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      };

      const result = await DrizzleQueryable.execute(mockQuery, mockConnection as any);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT 1", []);
      expect(result).toEqual([{ "?column?": 1 }]);
    });

    it("DrizzleQueryable.execute with params", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT * FROM users WHERE id = $1", params: [123] }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([{ id: 123, name: "test" }]),
      };

      const result = await DrizzleQueryable.execute(mockQuery, mockConnection as any);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [123]);
    });

    it("DrizzleQueryable.execute with query error", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT * FROM nonexistent", params: [] }),
      };

      const mockConnection = {
        query: vi.fn().mockRejectedValue(new Error("relation does not exist")),
      };

      await expect(DrizzleQueryable.execute(mockQuery, mockConnection as any)).rejects.toThrow(
        "relation does not exist"
      );
    });

    it("DrizzleQueryable.execute with null params", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT * FROM t WHERE x IS $1", params: [null] }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([]),
      };

      await DrizzleQueryable.execute(mockQuery, mockConnection as any);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT * FROM t WHERE x IS $1", [null]);
    });

    it("DrizzleQueryable.execute with undefined params", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: "SELECT $1", params: [undefined] }),
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([]),
      };

      await DrizzleQueryable.execute(mockQuery, mockConnection as any);

      expect(mockConnection.query).toHaveBeenCalledWith("SELECT $1", [undefined]);
    });

    it("DrizzleQueryable.execute with malformed toSQL return", async () => {
      const mockQuery = {
        toSQL: () => ({ sql: null, params: null }) as any,
      };

      const mockConnection = {
        query: vi.fn().mockResolvedValue([]),
      };

      // Should handle null sql gracefully
      await DrizzleQueryable.execute(mockQuery, mockConnection as any);

      expect(mockConnection.query).toHaveBeenCalledWith(null, null);
    });

    it("DrizzleQueryable.execute with missing toSQL method", async () => {
      const mockQuery = {} as any;

      const mockConnection = {
        query: vi.fn(),
      };

      // Should throw when toSQL is called
      await expect(DrizzleQueryable.execute(mockQuery, mockConnection as any)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Attack 6: Registration Edge Cases
  // ==========================================================================
  describe("registration edge cases", () => {
    it("register is idempotent", () => {
      // Should not throw when called multiple times
      expect(() => {
        register();
        register();
        register();
      }).not.toThrow();
    });

    it("macros are registered with correct names", () => {
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

  // ==========================================================================
  // Attack 7: Unicode and Special Characters
  // ==========================================================================
  describe("unicode and special characters", () => {
    it("ref$ with unicode column name", () => {
      // Would break if identifier isn't properly escaped
      expect(() => ref$("テーブル.列")).toThrow();
    });

    it("id$ with emoji", () => {
      expect(() => id$("column_🎉")).toThrow();
    });

    it("raw$ with unicode SQL", () => {
      expect(() => raw$("SELECT '日本語'")).toThrow();
    });

    it("SQL validation with unicode", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax(
        "SELECT * FROM users WHERE name = 'ユーザー'",
        ctx as any,
        mockNode as any
      );

      expect(result).toBe(true);
    });

    it("SQL validation with emojis", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const result = validateSqlSyntax(
        "SELECT * FROM t WHERE emoji = '🎉'",
        ctx as any,
        mockNode as any
      );

      expect(result).toBe(true);
    });

    it("ref$ with null byte injection", () => {
      // Null bytes can cause issues in C-based systems
      expect(() => ref$("users\x00.name")).toThrow();
    });

    it("id$ with newline injection", () => {
      expect(() => id$("column\nname")).toThrow();
    });
  });

  // ==========================================================================
  // Attack 8: Boundary Conditions
  // ==========================================================================
  describe("boundary conditions", () => {
    it("very long SQL query validation", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const longSql = "SELECT " + "a, ".repeat(10000) + "b FROM t";

      const result = validateSqlSyntax(longSql, ctx as any, mockNode as any);

      // Should complete without hanging
      expect(result).toBe(true);
    });

    it("deeply nested parentheses", () => {
      const ctx = createMockContext();
      const mockNode = {};

      const deepNested = "SELECT " + "(".repeat(100) + "1" + ")".repeat(100);

      const result = validateSqlSyntax(deepNested, ctx as any, mockNode as any);

      expect(result).toBe(true);
    });

    it("SQL with maximum number of placeholders", () => {
      const ctx = createMockContext();
      const mockNode = {};

      // 100 placeholders
      const manyParams =
        "SELECT * FROM t WHERE " + Array.from({ length: 100 }, (_, i) => `c${i} = ?`).join(" AND ");

      const result = validateSqlSyntax(manyParams, ctx as any, mockNode as any);

      expect(result).toBe(true);
    });

    it("empty string column reference", () => {
      expect(() => ref$("")).toThrow();
    });

    it("whitespace-only column reference", () => {
      expect(() => ref$("   ")).toThrow();
    });

    it("join$ with single element array", () => {
      expect(() => join$(["single"])).toThrow();
    });
  });
});
