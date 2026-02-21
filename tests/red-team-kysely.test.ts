/**
 * Red Team Tests for @typesugar/kysely-adapter
 *
 * Attack surfaces:
 * - SQL injection vectors through lit$/raw$ macros
 * - SQL validation bypass attempts
 * - Macro argument validation edge cases
 * - Template string parsing edge cases
 * - Type helper soundness
 * - KyselyQueryable error handling
 */
import { describe, it, expect } from "vitest";
import {
  ksqlMacro,
  refMacro,
  tableMacro,
  idMacro,
  litMacro,
  joinMacro,
  rawMacro,
  ksql,
  ref$,
  table$,
  id$,
  lit$,
  join$,
  raw$,
  KyselyQueryable,
  type SqlResult,
  type Column,
  type Generated,
  type Nullable,
} from "../packages/kysely/src/index.js";
import { validateSqlSyntax } from "../packages/sql/src/macro-utils.js";

describe("Kysely Adapter Edge Cases", () => {
  // ==========================================================================
  // Attack 1: SQL Injection Vectors
  // ==========================================================================
  describe("SQL Injection via lit$ and raw$", () => {
    it("lit$ runtime placeholder throws for any input", () => {
      // Even safe-looking inputs should throw at runtime without transformer
      expect(() => lit$("ASC")).toThrow("not transformed at compile time");
      expect(() => lit$("DESC")).toThrow("not transformed at compile time");
    });

    it("raw$ runtime placeholder throws for any input", () => {
      // raw$ is the most dangerous - should always throw without transformer
      expect(() => raw$("NOW()")).toThrow("not transformed at compile time");
      expect(() => raw$("1; DROP TABLE users; --")).toThrow("not transformed at compile time");
    });

    it("injection payloads in runtime placeholders are blocked by throw", () => {
      // Classic SQL injection payloads - all should throw, never execute
      const payloads = [
        "'; DROP TABLE users; --",
        "1 OR 1=1",
        "1; DELETE FROM users WHERE 1=1",
        "' UNION SELECT * FROM passwords --",
        "1/**/OR/**/1=1",
        "admin'--",
        "1' AND '1'='1",
      ];

      for (const payload of payloads) {
        expect(() => raw$(payload)).toThrow("not transformed at compile time");
        expect(() => lit$(payload)).toThrow("not transformed at compile time");
      }
    });

    it("null byte injection attempts throw", () => {
      // Null byte attacks - should throw at runtime
      expect(() => raw$("SELECT * FROM users\x00")).toThrow();
      expect(() => lit$("\x00; DROP TABLE users")).toThrow();
    });
  });

  // ==========================================================================
  // Attack 2: SQL Validation Bypass Attempts
  // ==========================================================================
  describe("SQL Validation Edge Cases", () => {
    const mockCtx = {
      reportError: (_node: unknown, _msg: string) => {},
      reportWarning: (_node: unknown, _msg: string) => {},
    };
    const mockNode = {} as Parameters<typeof validateSqlSyntax>[2];

    it("detects comment-based injection patterns", () => {
      const warnings: string[] = [];
      const ctx = {
        ...mockCtx,
        reportWarning: (_n: unknown, msg: string) => warnings.push(msg),
      };

      // SQL comment injection
      validateSqlSyntax("SELECT * FROM users -- DROP TABLE users", ctx, mockNode);
      expect(warnings.some((w) => w.includes("dangerous"))).toBe(true);
    });

    it("detects multi-statement injection patterns", () => {
      const warnings: string[] = [];
      const ctx = {
        ...mockCtx,
        reportWarning: (_n: unknown, msg: string) => warnings.push(msg),
      };

      validateSqlSyntax("SELECT 1; DROP TABLE users", ctx, mockNode);
      expect(warnings.some((w) => w.includes("dangerous"))).toBe(true);
    });

    it("detects block comment injection", () => {
      const warnings: string[] = [];
      const ctx = {
        ...mockCtx,
        reportWarning: (_n: unknown, msg: string) => warnings.push(msg),
      };

      validateSqlSyntax("SELECT /* malicious */ * FROM users", ctx, mockNode);
      expect(warnings.some((w) => w.includes("dangerous"))).toBe(true);
    });

    it("rejects unbalanced parentheses (excess closing)", () => {
      const errors: string[] = [];
      const ctx = {
        ...mockCtx,
        reportError: (_n: unknown, msg: string) => errors.push(msg),
      };

      const result = validateSqlSyntax("SELECT * FROM users WHERE id = (1))", ctx, mockNode);
      expect(result).toBe(false);
      expect(errors.some((e) => e.includes("unbalanced"))).toBe(true);
    });

    it("rejects unbalanced parentheses (missing closing)", () => {
      const errors: string[] = [];
      const ctx = {
        ...mockCtx,
        reportError: (_n: unknown, msg: string) => errors.push(msg),
      };

      const result = validateSqlSyntax("SELECT * FROM users WHERE ((id = 1)", ctx, mockNode);
      expect(result).toBe(false);
      expect(errors.some((e) => e.includes("unbalanced"))).toBe(true);
    });

    it("allows valid nested parentheses", () => {
      const errors: string[] = [];
      const ctx = {
        ...mockCtx,
        reportError: (_n: unknown, msg: string) => errors.push(msg),
      };

      const result = validateSqlSyntax(
        "SELECT * FROM users WHERE (id = 1 AND (name = 'test' OR age > 18))",
        ctx,
        mockNode
      );
      expect(result).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("case-insensitive keyword detection", () => {
      const warnings: string[] = [];
      const ctx = {
        ...mockCtx,
        reportWarning: (_n: unknown, msg: string) => warnings.push(msg),
      };

      // Mixed case should still be detected
      validateSqlSyntax("SELECT 1; dRoP tAbLe users", ctx, mockNode);
      expect(warnings.some((w) => w.includes("dangerous"))).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 3: Macro Argument Validation
  // ==========================================================================
  describe("Macro Argument Edge Cases", () => {
    it("ref$ throws without transformer regardless of argument validity", () => {
      // Valid-looking references
      expect(() => ref$("users.id")).toThrow();
      expect(() => ref$("schema.table.column")).toThrow();

      // Invalid references (would be caught at compile time)
      expect(() => ref$("")).toThrow();
      expect(() => ref$("   ")).toThrow();
    });

    it("table$ throws without transformer regardless of argument validity", () => {
      expect(() => table$("users")).toThrow();
      expect(() => table$("public.users")).toThrow();
      expect(() => table$("")).toThrow();
    });

    it("id$ throws without transformer regardless of argument validity", () => {
      expect(() => id$("column_name")).toThrow();
      expect(() => id$("CamelCase")).toThrow();
      expect(() => id$("")).toThrow();
    });

    it("join$ throws without transformer regardless of arguments", () => {
      expect(() => join$(["a", "b", "c"])).toThrow();
      expect(() => join$([])).toThrow();
      // @ts-expect-error - Testing wrong argument types at runtime
      expect(() => join$("not an array")).toThrow();
    });

    it("macro definitions have correct names", () => {
      expect(ksqlMacro.name).toBe("ksql");
      expect(refMacro.name).toBe("ref$");
      expect(tableMacro.name).toBe("table$");
      expect(idMacro.name).toBe("id$");
      expect(litMacro.name).toBe("lit$");
      expect(joinMacro.name).toBe("join$");
      expect(rawMacro.name).toBe("raw$");
    });

    it("all macros have expand functions", () => {
      expect(typeof ksqlMacro.expand).toBe("function");
      expect(typeof refMacro.expand).toBe("function");
      expect(typeof tableMacro.expand).toBe("function");
      expect(typeof idMacro.expand).toBe("function");
      expect(typeof litMacro.expand).toBe("function");
      expect(typeof joinMacro.expand).toBe("function");
      expect(typeof rawMacro.expand).toBe("function");
    });
  });

  // ==========================================================================
  // Attack 4: Template String Edge Cases
  // ==========================================================================
  describe("Template String Parsing Edge Cases", () => {
    it("ksql throws without transformer for empty template", () => {
      expect(() => ksql``).toThrow("not transformed at compile time");
    });

    it("ksql throws without transformer for whitespace-only template", () => {
      expect(() => ksql`   `).toThrow();
      expect(() => ksql`\n\t\r`).toThrow();
    });

    it("ksql throws without transformer for templates with interpolations", () => {
      const id = 123;
      expect(() => ksql`SELECT * FROM users WHERE id = ${id}`).toThrow();
    });

    it("ksql throws without transformer for unicode content", () => {
      expect(() => ksql`SELECT * FROM users WHERE name = '日本語'`).toThrow();
      expect(() => ksql`SELECT * FROM émojis WHERE 🎉 = 1`).toThrow();
    });

    it("ksql throws without transformer for nested template expressions", () => {
      const table = "users";
      const col = "id";
      expect(() => ksql`SELECT * FROM ${table} WHERE ${col} = 1`).toThrow();
    });

    it("ksql throws without transformer for very long queries", () => {
      const longCondition = Array(100).fill("id = 1").join(" OR ");
      expect(() => ksql`SELECT * FROM users WHERE ${longCondition}`).toThrow();
    });
  });

  // ==========================================================================
  // Attack 5: Type Helper Soundness
  // ==========================================================================
  describe("Type Helper Edge Cases", () => {
    it("Column<T> is transparent (compile-time only)", () => {
      // Column<T> should just be T at runtime
      type TestColumn = Column<string>;
      const val: TestColumn = "test";
      expect(val).toBe("test");
    });

    it("Generated<T> is transparent (compile-time only)", () => {
      // Generated<T> should just be T at runtime
      type TestGenerated = Generated<number>;
      const val: TestGenerated = 42;
      expect(val).toBe(42);
    });

    it("Nullable<T> correctly unions with null", () => {
      type TestNullable = Nullable<string>;
      const val1: TestNullable = "test";
      const val2: TestNullable = null;
      expect(val1).toBe("test");
      expect(val2).toBeNull();
    });

    it("SqlResult extracts result type correctly", () => {
      type MockQuery = { execute: (db: unknown) => Promise<{ id: number }[]> };
      type Result = SqlResult<MockQuery>;

      // This is a type-level test - just ensure it compiles
      const result: Result = [{ id: 1 }];
      expect(result).toEqual([{ id: 1 }]);
    });

    it("SqlResult returns never for non-query types", () => {
      type NotAQuery = { notExecute: () => void };
      type Result = SqlResult<NotAQuery>;

      // SqlResult of non-query should be never
      // We can't assign anything to never, so just verify the type exists
      const _typeCheck: Result extends never ? true : false = true;
      expect(_typeCheck).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 6: KyselyQueryable Error Handling
  // ==========================================================================
  describe("KyselyQueryable Edge Cases", () => {
    it("KyselyQueryable is defined and has execute method", () => {
      expect(KyselyQueryable).toBeDefined();
      expect(typeof KyselyQueryable.execute).toBe("function");
    });

    it("KyselyQueryable.execute rejects with invalid connection", async () => {
      const mockQuery = {
        compile: () => ({ sql: "SELECT 1", parameters: [] }),
      };

      const invalidConn = {
        query: async () => {
          throw new Error("Connection closed");
        },
      };

      await expect(KyselyQueryable.execute(mockQuery, invalidConn as never)).rejects.toThrow(
        "Connection closed"
      );
    });

    it("KyselyQueryable.execute handles query compilation errors", async () => {
      const badQuery = {
        compile: () => {
          throw new Error("Failed to compile query");
        },
      };

      const mockConn = {
        query: async () => [],
      };

      await expect(KyselyQueryable.execute(badQuery, mockConn as never)).rejects.toThrow(
        "Failed to compile query"
      );
    });

    it("KyselyQueryable.execute passes parameters correctly", async () => {
      let capturedSql = "";
      let capturedParams: unknown[] = [];

      const mockQuery = {
        compile: () => ({
          sql: "SELECT * FROM users WHERE id = ?",
          parameters: [123],
        }),
      };

      const mockConn = {
        query: async (sql: string, params: unknown[]) => {
          capturedSql = sql;
          capturedParams = params;
          return [];
        },
      };

      await KyselyQueryable.execute(mockQuery, mockConn as never);

      expect(capturedSql).toBe("SELECT * FROM users WHERE id = ?");
      expect(capturedParams).toEqual([123]);
    });

    it("KyselyQueryable.execute handles empty parameters", async () => {
      let capturedParams: unknown[] | undefined;

      const mockQuery = {
        compile: () => ({
          sql: "SELECT 1",
          parameters: [],
        }),
      };

      const mockConn = {
        query: async (_sql: string, params: unknown[]) => {
          capturedParams = params;
          return [];
        },
      };

      await KyselyQueryable.execute(mockQuery, mockConn as never);
      expect(capturedParams).toEqual([]);
    });

    it("KyselyQueryable.execute handles null/undefined in parameters", async () => {
      let capturedParams: unknown[] | undefined;

      const mockQuery = {
        compile: () => ({
          sql: "INSERT INTO users (name, age) VALUES (?, ?)",
          parameters: [null, undefined],
        }),
      };

      const mockConn = {
        query: async (_sql: string, params: unknown[]) => {
          capturedParams = params;
          return [];
        },
      };

      await KyselyQueryable.execute(mockQuery, mockConn as never);
      expect(capturedParams).toEqual([null, undefined]);
    });
  });

  // ==========================================================================
  // Attack 7: Error Message Quality
  // ==========================================================================
  describe("Error Message Quality", () => {
    it("ksql error message is actionable", () => {
      try {
        ksql`SELECT 1`;
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("ksql");
        expect(msg).toContain("compile time");
        expect(msg).toContain("@typesugar/kysely-adapter");
      }
    });

    it("ref$ error message mentions the macro name", () => {
      try {
        ref$("users.id");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("ref$");
      }
    });

    it("raw$ error message emphasizes compile-time requirement", () => {
      try {
        raw$("SELECT 1");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("raw$");
        expect(msg).toContain("compile time");
      }
    });

    it("all macro errors mention transformer registration", () => {
      const macros = [
        () => ksql`SELECT 1`,
        () => ref$("x"),
        () => table$("x"),
        () => id$("x"),
        () => lit$("x"),
        () => join$([]),
        () => raw$("x"),
      ];

      for (const macro of macros) {
        try {
          macro();
        } catch (e) {
          expect((e as Error).message).toContain("registered");
        }
      }
    });
  });
});
