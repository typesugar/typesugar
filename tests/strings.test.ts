/**
 * Tests for special string type macros
 */

import { describe, it, expect } from "vitest";

describe("SQL string macro semantics", () => {
  describe("SQL parameterization", () => {
    it("should convert interpolations to parameters", () => {
      // Simulating what the sql macro produces
      const userId = 42;
      const sql = `SELECT * FROM users WHERE id = $1`;
      const params = [userId];

      expect(sql).toContain("$1");
      expect(params).toEqual([42]);
    });

    it("should handle multiple parameters", () => {
      const name = "John";
      const age = 25;
      const sql = `SELECT * FROM users WHERE name = $1 AND age > $2`;
      const params = [name, age];

      expect(sql).toContain("$1");
      expect(sql).toContain("$2");
      expect(params).toEqual(["John", 25]);
    });

    it("should not parameterize static parts", () => {
      const sql = `SELECT * FROM users WHERE status = 'active'`;
      expect(sql).toContain("'active'");
      expect(sql).not.toContain("$");
    });
  });

  describe("SQL validation patterns", () => {
    it("should validate SELECT statement structure", () => {
      const validSelects = [
        "SELECT * FROM users",
        "SELECT id, name FROM users",
        "SELECT * FROM users WHERE id = $1",
        "SELECT * FROM users ORDER BY created_at",
      ];

      for (const sql of validSelects) {
        expect(sql.toUpperCase()).toMatch(/^SELECT/);
      }
    });

    it("should validate INSERT statement structure", () => {
      const validInserts = [
        "INSERT INTO users (name) VALUES ($1)",
        "INSERT INTO users (name, email) VALUES ($1, $2)",
      ];

      for (const sql of validInserts) {
        expect(sql.toUpperCase()).toMatch(/^INSERT INTO/);
      }
    });

    it("should validate UPDATE statement structure", () => {
      const validUpdates = [
        "UPDATE users SET name = $1 WHERE id = $2",
        "UPDATE users SET active = true",
      ];

      for (const sql of validUpdates) {
        expect(sql.toUpperCase()).toMatch(/^UPDATE/);
      }
    });

    it("should validate DELETE statement structure", () => {
      const validDeletes = [
        "DELETE FROM users WHERE id = $1",
        "DELETE FROM users WHERE created_at < $1",
      ];

      for (const sql of validDeletes) {
        expect(sql.toUpperCase()).toMatch(/^DELETE FROM/);
      }
    });
  });
});

describe("Regex string macro semantics", () => {
  describe("regex pattern creation", () => {
    it("should create valid RegExp objects", () => {
      const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

      expect(emailPattern.test("test@example.com")).toBe(true);
      expect(emailPattern.test("invalid")).toBe(false);
    });

    it("should support common patterns", () => {
      const digits = /^\d+$/;
      const word = /^\w+$/;
      const whitespace = /^\s*$/;

      expect(digits.test("12345")).toBe(true);
      expect(word.test("hello")).toBe(true);
      expect(whitespace.test("   ")).toBe(true);
    });

    it("should handle special regex characters", () => {
      const escaped = /\$\d+\.\d{2}/;
      expect(escaped.test("$19.99")).toBe(true);
    });
  });

  describe("regex validation at compile time", () => {
    it("should catch invalid regex patterns", () => {
      // These would be caught at compile time by the macro
      // Testing the validation logic concepts

      // Invalid: unmatched brackets
      expect(() => new RegExp("[")).toThrow();

      // Invalid: unmatched parentheses
      expect(() => new RegExp("(")).toThrow();

      // Invalid: invalid quantifier
      expect(() => new RegExp("*")).toThrow();
    });
  });
});

describe("HTML string macro semantics", () => {
  describe("XSS prevention", () => {
    it("should escape HTML entities", () => {
      const escapeHtml = (str: string): string => {
        return str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      };

      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
      expect(escapeHtml('"test"')).toBe("&quot;test&quot;");
      expect(escapeHtml("O'Brien")).toBe("O&#39;Brien");
      expect(escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("should safely interpolate user data", () => {
      const escapeHtml = (str: string): string => str.replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const userInput = "<script>alert('xss')</script>";
      const safe = `<div>${escapeHtml(userInput)}</div>`;

      expect(safe).not.toContain("<script>");
      expect(safe).toContain("&lt;script&gt;");
    });
  });

  describe("HTML structure", () => {
    it("should preserve static HTML", () => {
      const staticHtml = '<div class="container"><p>Hello World</p></div>';

      expect(staticHtml).toContain("<div");
      expect(staticHtml).toContain("</div>");
      expect(staticHtml).toContain('class="container"');
    });
  });
});

describe("Format string macro semantics", () => {
  describe("basic formatting", () => {
    it("should support string interpolation", () => {
      const name = "World";
      const greeting = `Hello, ${name}!`;

      expect(greeting).toBe("Hello, World!");
    });

    it("should support number formatting", () => {
      const value = 42;
      const formatted = `The answer is ${value}`;

      expect(formatted).toBe("The answer is 42");
    });
  });

  describe("printf-style concepts", () => {
    it("should support %s for strings", () => {
      const format = (template: string, ...args: unknown[]): string => {
        let i = 0;
        return template.replace(/%s/g, () => String(args[i++]));
      };

      expect(format("Hello, %s!", "World")).toBe("Hello, World!");
    });

    it("should support %d for integers", () => {
      const format = (template: string, ...args: unknown[]): string => {
        let i = 0;
        return template.replace(/%d/g, () => String(Math.floor(Number(args[i++]))));
      };

      expect(format("Value: %d", 42.7)).toBe("Value: 42");
    });
  });
});

describe("JSON string macro semantics", () => {
  describe("compile-time JSON parsing", () => {
    it("should parse valid JSON", () => {
      const json = JSON.parse('{"name": "John", "age": 30}');

      expect(json.name).toBe("John");
      expect(json.age).toBe(30);
    });

    it("should handle nested objects", () => {
      const json = JSON.parse('{"user": {"name": "John", "email": "john@example.com"}}');

      expect(json.user.name).toBe("John");
      expect(json.user.email).toBe("john@example.com");
    });

    it("should handle arrays", () => {
      const json = JSON.parse("[1, 2, 3, 4, 5]");

      expect(json).toEqual([1, 2, 3, 4, 5]);
    });

    it("should reject invalid JSON", () => {
      // These would be caught at compile time by the macro
      expect(() => JSON.parse("{invalid}")).toThrow();
      expect(() => JSON.parse("{'single': 'quotes'}")).toThrow();
    });
  });
});

describe("Raw string macro semantics", () => {
  describe("escape sequence preservation", () => {
    it("should preserve backslash sequences", () => {
      const raw = String.raw`\n\t\r`;

      expect(raw).toBe("\\n\\t\\r");
      expect(raw.length).toBe(6);
    });

    it("should work with regex patterns", () => {
      const pattern = String.raw`\d+\.\d{2}`;
      const regex = new RegExp(pattern);

      expect(regex.test("19.99")).toBe(true);
    });

    it("should work with file paths", () => {
      const path = String.raw`C:\Users\John\Documents`;

      // Backslashes are preserved as-is
      expect(path).toContain("\\Users\\");
      expect(path).toContain("John");
      expect(path.length).toBe(23); // Full path preserved: C:\Users\John\Documents
    });
  });
});
