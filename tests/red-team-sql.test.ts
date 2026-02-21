/**
 * Red Team Tests for @typesugar/sql
 *
 * Attack surfaces:
 * - SQL injection through fragment interpolation
 * - Parameter binding edge cases (NULL, special chars, encoding)
 * - Fragment composition with empty/nested fragments
 * - Type mapping edge cases (Date, BigInt, Buffer, JSON)
 * - ConnectionIO monad behavior (error handling, transactions)
 * - NULL vs undefined handling in Get/Put/Meta typeclasses
 */
import { describe, it, expect } from "vitest";
import {
  Fragment,
  sql,
  __sql_build,
  Get,
  Put,
  Meta,
  Read,
  Write,
  Codec,
  TypedFragment,
  emptyTyped,
  andTyped,
  orTyped,
  inListTyped,
  valuesTyped,
  valuesManyTyped,
  whenTyped,
  whereAndTyped,
  toSnakeCase,
  deriveRead,
  deriveWrite,
  ConnectionIO,
  Left,
  Right,
  sequence,
  traverse,
  when,
  whenA,
} from "../packages/sql/src/index.js";

describe("SQL DSL Edge Cases", () => {
  // ==========================================================================
  // Attack 1: SQL Injection Prevention
  // ==========================================================================
  describe("SQL Injection Prevention", () => {
    it("should parameterize user input, not interpolate as raw SQL", () => {
      const maliciousInput = "'; DROP TABLE users; --";
      const frag = sql`SELECT * FROM users WHERE name = ${maliciousInput}`;

      // The SQL text should contain a placeholder, not the raw input
      expect(frag.text).toBe("SELECT * FROM users WHERE name = $1");
      expect(frag.text).not.toContain("DROP TABLE");

      // The malicious input should be in params, safely bound
      expect(frag.values).toEqual([maliciousInput]);
    });

    it("should escape special SQL characters in string parameters", () => {
      const trickyInput = "O'Reilly";
      const frag = sql`SELECT * FROM books WHERE author = ${trickyInput}`;

      expect(frag.text).toBe("SELECT * FROM books WHERE author = $1");
      expect(frag.values).toEqual([trickyInput]);
      // The apostrophe is not escaped in the text — it's bound safely
      expect(frag.text).not.toContain("O'Reilly");
    });

    it("should handle multiple injection attempts in one query", () => {
      const input1 = "1; DELETE FROM users WHERE 1=1; --";
      const input2 = "admin' OR '1'='1";

      const frag = sql`SELECT * FROM users WHERE id = ${input1} AND name = ${input2}`;

      expect(frag.text).toBe("SELECT * FROM users WHERE id = $1 AND name = $2");
      expect(frag.values).toEqual([input1, input2]);
    });
  });

  // ==========================================================================
  // Attack 2: Parameter Binding Edge Cases
  // ==========================================================================
  describe("Parameter Binding Edge Cases", () => {
    it("should handle NULL parameter values", () => {
      const frag = sql`INSERT INTO users (name, email) VALUES (${null}, ${"test@example.com"})`;

      expect(frag.text).toBe("INSERT INTO users (name, email) VALUES ($1, $2)");
      expect(frag.values).toEqual([null, "test@example.com"]);
    });

    it("should handle empty string vs NULL", () => {
      const emptyFrag = sql`SELECT * FROM users WHERE name = ${""}`;
      const nullFrag = sql`SELECT * FROM users WHERE name = ${null}`;

      expect(emptyFrag.values[0]).toBe("");
      expect(nullFrag.values[0]).toBe(null);
      expect(emptyFrag.values[0]).not.toBe(nullFrag.values[0]);
    });

    it("should handle boolean values correctly", () => {
      const trueFrag = sql`SELECT * FROM users WHERE active = ${true}`;
      const falseFrag = sql`SELECT * FROM users WHERE active = ${false}`;

      expect(trueFrag.values).toEqual([true]);
      expect(falseFrag.values).toEqual([false]);
    });

    it("should handle numeric edge cases", () => {
      const maxInt = sql`SELECT * FROM t WHERE n = ${Number.MAX_SAFE_INTEGER}`;
      const minInt = sql`SELECT * FROM t WHERE n = ${Number.MIN_SAFE_INTEGER}`;
      const nanFrag = sql`SELECT * FROM t WHERE n = ${NaN}`;
      const infFrag = sql`SELECT * FROM t WHERE n = ${Infinity}`;
      const negZero = sql`SELECT * FROM t WHERE n = ${-0}`;

      expect(maxInt.values).toEqual([Number.MAX_SAFE_INTEGER]);
      expect(minInt.values).toEqual([Number.MIN_SAFE_INTEGER]);
      expect(nanFrag.values).toEqual([NaN]);
      expect(infFrag.values).toEqual([Infinity]);
      // -0 should be preserved or normalized
      expect(Object.is(negZero.values[0], -0) || negZero.values[0] === 0).toBe(true);
    });

    it("should handle Date objects", () => {
      const date = new Date("2024-01-15T12:30:00Z");
      const frag = sql`SELECT * FROM events WHERE created_at = ${date}`;

      expect(frag.values).toEqual([date]);
    });

    it("should handle Buffer/binary data", () => {
      const buffer = Buffer.from([0x00, 0xff, 0xde, 0xad, 0xbe, 0xef]);
      const frag = sql`INSERT INTO files (data) VALUES (${buffer})`;

      expect(frag.values).toEqual([buffer]);
    });

    it("should handle array parameters for IN clauses", () => {
      const ids = [1, 2, 3, 4, 5];
      const frag = Fragment.inList("id", ids);

      expect(frag.text).toBe("id IN ($1, $2, $3, $4, $5)");
      expect(frag.values).toEqual(ids);
    });

    it("should handle empty array for IN clause", () => {
      const frag = Fragment.inList("id", []);

      // Empty IN should be FALSE, not syntactically invalid
      expect(frag.text).toBe("FALSE");
      expect(frag.values).toEqual([]);
    });
  });

  // ==========================================================================
  // Attack 3: Fragment Composition Edge Cases
  // ==========================================================================
  describe("Fragment Composition Edge Cases", () => {
    it("should handle appending to empty fragment", () => {
      const empty = Fragment.empty;
      const other = sql`SELECT * FROM users`;
      const result = empty.append(other);

      expect(result.text).toBe(" SELECT * FROM users");
    });

    it("should handle empty.appendNoSpace", () => {
      const empty = Fragment.empty;
      const other = sql`SELECT * FROM users`;
      const result = empty.appendNoSpace(other);

      expect(result.text).toBe("SELECT * FROM users");
    });

    it("should handle deeply nested fragment composition", () => {
      const a = sql`a = ${1}`;
      const b = sql`b = ${2}`;
      const c = sql`c = ${3}`;
      const d = sql`d = ${4}`;

      const combined = Fragment.and([Fragment.or([a, b]), Fragment.or([c, d])]);

      // Should properly renumber all parameters
      expect(combined.text).toContain("$1");
      expect(combined.text).toContain("$4");
      expect(combined.values).toEqual([1, 2, 3, 4]);
    });

    it("should handle Fragment.and with single element", () => {
      const single = Fragment.and([sql`x = ${1}`]);
      expect(single.text).toBe("x = $1");
      expect(single.values).toEqual([1]);
    });

    it("should handle Fragment.and with empty array", () => {
      const empty = Fragment.and([]);
      expect(empty).toBe(Fragment.empty);
    });

    it("should handle Fragment.or wrapping in parens", () => {
      const frag = Fragment.or([sql`a = ${1}`, sql`b = ${2}`]);

      // OR results should be wrapped in parentheses for safety
      expect(frag.text).toMatch(/^\(.*\)$/);
    });

    it("should handle nested Fragment interpolation", () => {
      const inner = sql`name = ${"Alice"}`;
      const outer = sql`SELECT * FROM users WHERE ${inner}`;

      // Nested fragment should be inlined, not double-parameterized
      expect(outer.text).toBe("SELECT * FROM users WHERE name = $1");
      expect(outer.values).toEqual(["Alice"]);
    });

    it("should handle multiple nested fragments with correct param numbering", () => {
      const cond1 = sql`a = ${1}`;
      const cond2 = sql`b = ${2}`;
      const combined = sql`SELECT * FROM t WHERE ${cond1} AND ${cond2}`;

      expect(combined.text).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
      expect(combined.values).toEqual([1, 2]);
    });
  });

  // ==========================================================================
  // Attack 4: NULL Value Handling in Typeclasses
  // ==========================================================================
  describe("NULL Value Handling in Typeclasses", () => {
    it("Get.string should return null for NULL input", () => {
      expect(Get.string.get(null)).toBe(null);
    });

    it("Get.string.unsafeGet should throw for NULL input", () => {
      expect(() => Get.string.unsafeGet(null)).toThrow();
    });

    it("Get.nullable should preserve null", () => {
      const nullableString = Get.nullable(Get.string);
      expect(nullableString.get(null)).toBe(null);
      expect(nullableString.get("hello")).toBe("hello");
    });

    it("Get.optional should map null to undefined", () => {
      const optionalString = Get.optional(Get.string);
      expect(optionalString.get(null)).toBe(undefined);
      expect(optionalString.get(undefined)).toBe(undefined);
      expect(optionalString.get("hello")).toBe("hello");
    });

    it("Put.nullable should encode null as null", () => {
      const nullableString = Put.nullable(Put.string);
      expect(nullableString.put(null)).toBe(null);
      expect(nullableString.put("hello")).toBe("hello");
    });

    it("Put.optional should encode undefined as null", () => {
      const optionalString = Put.optional(Put.string);
      expect(optionalString.put(undefined)).toBe(null);
      expect(optionalString.put("hello")).toBe("hello");
    });

    it("Meta.nullable should round-trip null correctly", () => {
      const nullableMeta = Meta.nullable(Meta.string);

      expect(nullableMeta.get(null)).toBe(null);
      expect(nullableMeta.put(null)).toBe(null);
      expect(nullableMeta.get("test")).toBe("test");
      expect(nullableMeta.put("test")).toBe("test");
    });
  });

  // ==========================================================================
  // Attack 5: Type Mapping Edge Cases
  // ==========================================================================
  describe("Type Mapping Edge Cases", () => {
    describe("Date handling", () => {
      it("Get.date should handle ISO string", () => {
        const result = Get.date.get("2024-01-15T12:30:00Z");
        expect(result).toBeInstanceOf(Date);
        expect(result?.toISOString()).toBe("2024-01-15T12:30:00.000Z");
      });

      it("Get.date should handle Unix timestamp", () => {
        const timestamp = 1705321800000; // 2024-01-15T12:30:00Z
        const result = Get.date.get(timestamp);
        expect(result).toBeInstanceOf(Date);
      });

      it("Get.date should return null for invalid date string", () => {
        expect(Get.date.get("not-a-date")).toBe(null);
        expect(Get.date.get("")).toBe(null);
      });

      it("Get.dateOnly should handle date-only strings", () => {
        const result = Get.dateOnly.get("2024-01-15");
        expect(result).toBeInstanceOf(Date);
        // Should be at midnight UTC
        expect(result?.getUTCHours()).toBe(0);
      });

      it("Put.date should serialize to ISO string with timezone", () => {
        const date = new Date("2024-01-15T12:30:00Z");
        expect(Put.date.put(date)).toBe("2024-01-15T12:30:00.000Z");
      });

      it("Put.dateOnly should serialize to date-only string", () => {
        const date = new Date("2024-01-15T12:30:00Z");
        expect(Put.dateOnly.put(date)).toBe("2024-01-15");
      });
    });

    describe("BigInt handling", () => {
      it("Get.bigint should handle bigint input", () => {
        expect(Get.bigint.get(123n)).toBe(123n);
      });

      it("Get.bigint should convert number to bigint", () => {
        expect(Get.bigint.get(123)).toBe(123n);
      });

      it("Get.bigint should convert string to bigint", () => {
        expect(Get.bigint.get("9007199254740993")).toBe(9007199254740993n);
      });

      it("Get.bigint should truncate floats when converting from number", () => {
        expect(Get.bigint.get(123.7)).toBe(123n);
      });

      it("Put.bigint should serialize to string", () => {
        expect(Put.bigint.put(9007199254740993n)).toBe("9007199254740993");
      });
    });

    describe("Integer handling", () => {
      it("Get.int should truncate floats", () => {
        expect(Get.int.get(3.14)).toBe(3);
        expect(Get.int.get(-3.14)).toBe(-3);
        expect(Get.int.get(3.9999)).toBe(3);
      });

      it("Put.int should truncate floats", () => {
        expect(Put.int.put(3.14)).toBe(3);
        expect(Put.int.put(-3.9)).toBe(-3);
      });
    });

    describe("Boolean handling", () => {
      it("Get.boolean should handle PostgreSQL boolean literals", () => {
        expect(Get.boolean.get("t")).toBe(true);
        expect(Get.boolean.get("f")).toBe(false);
        expect(Get.boolean.get("true")).toBe(true);
        expect(Get.boolean.get("false")).toBe(false);
      });

      it("Get.boolean should handle numeric booleans", () => {
        expect(Get.boolean.get(1)).toBe(true);
        expect(Get.boolean.get(0)).toBe(false);
      });
    });

    describe("UUID handling", () => {
      it("Get.uuid should accept valid UUIDs", () => {
        const uuid = "123e4567-e89b-12d3-a456-426614174000";
        expect(Get.uuid.get(uuid)).toBe(uuid);
      });

      it("Get.uuid should accept lowercase UUIDs", () => {
        const uuid = "123e4567-e89b-12d3-a456-426614174000";
        expect(Get.uuid.get(uuid)).toBe(uuid);
      });

      it("Get.uuid should accept uppercase UUIDs", () => {
        const uuid = "123E4567-E89B-12D3-A456-426614174000";
        expect(Get.uuid.get(uuid)).toBe(uuid);
      });

      it("Get.uuid should reject invalid UUIDs", () => {
        expect(Get.uuid.get("not-a-uuid")).toBe(null);
        expect(Get.uuid.get("123e4567-e89b-12d3-a456")).toBe(null);
        expect(Get.uuid.get("")).toBe(null);
      });
    });

    describe("JSON handling", () => {
      it("Get.json should parse JSON string", () => {
        expect(Get.json.get('{"key": "value"}')).toEqual({ key: "value" });
      });

      it("Get.json should return object as-is", () => {
        const obj = { key: "value" };
        expect(Get.json.get(obj)).toEqual(obj);
      });

      it("Get.json should return null for invalid JSON string", () => {
        expect(Get.json.get("{invalid}")).toBe(null);
      });

      it("Put.json should serialize object to JSON string", () => {
        expect(Put.json.put({ key: "value" })).toBe('{"key":"value"}');
      });

      it("Get.jsonAs should type the result", () => {
        interface Config {
          host: string;
          port: number;
        }
        const typedJson = Get.jsonAs<Config>();
        const result = typedJson.get('{"host": "localhost", "port": 5432}');
        expect(result).toEqual({ host: "localhost", port: 5432 });
      });
    });

    describe("Buffer handling", () => {
      it("Get.buffer should parse hex string from PostgreSQL", () => {
        const result = Get.buffer.get("\\xdeadbeef");
        expect(result).toBeInstanceOf(Buffer);
        expect(result?.toString("hex")).toBe("deadbeef");
      });

      it("Get.buffer should return Buffer as-is", () => {
        const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        expect(Get.buffer.get(buf)).toBe(buf);
      });
    });

    describe("Array handling", () => {
      it("Get.array should decode array of primitives", () => {
        const intArray = Get.array(Get.int);
        expect(intArray.get([1, 2, 3])).toEqual([1, 2, 3]);
      });

      it("Get.array should filter out null elements", () => {
        const intArray = Get.array(Get.int);
        expect(intArray.get([1, null, 3])).toEqual([1, 3]);
      });

      it("Get.array should return null for non-array input", () => {
        const intArray = Get.array(Get.int);
        expect(intArray.get("not an array")).toBe(null);
      });

      it("Put.array should encode array of primitives", () => {
        const intArray = Put.array(Put.int);
        expect(intArray.put([1, 2, 3])).toEqual([1, 2, 3]);
      });
    });
  });

  // ==========================================================================
  // Attack 6: ConnectionIO Monad Behavior
  // ==========================================================================
  describe("ConnectionIO Monad Behavior", () => {
    it("ConnectionIO.pure should lift a value", () => {
      const cio = ConnectionIO.pure(42);
      expect(cio.op._tag).toBe("Pure");
      expect((cio.op as { _tag: "Pure"; value: number }).value).toBe(42);
    });

    it("ConnectionIO.unit should be pure undefined", () => {
      const cio = ConnectionIO.unit;
      expect(cio.op._tag).toBe("Pure");
      expect((cio.op as { _tag: "Pure"; value: undefined }).value).toBe(undefined);
    });

    it("ConnectionIO.delay should wrap a thunk", () => {
      let called = false;
      const cio = ConnectionIO.delay(() => {
        called = true;
        return 42;
      });

      expect(cio.op._tag).toBe("Delay");
      // Thunk should not be called until interpretation
      expect(called).toBe(false);
    });

    it("attempt should wrap operation for error handling", () => {
      const cio = ConnectionIO.pure(42).attempt();
      expect(cio.op._tag).toBe("Attempt");
    });

    it("handleError should provide fallback operation", () => {
      const original = ConnectionIO.pure(42);
      const withHandler = original.handleError(() => ConnectionIO.pure(0));

      expect(withHandler.op._tag).toBe("HandleError");
    });

    it("orElse should be sugar for handleError", () => {
      const primary = ConnectionIO.pure(42);
      const fallback = ConnectionIO.pure(0);
      const combined = primary.orElse(fallback);

      expect(combined.op._tag).toBe("HandleError");
    });

    it("transact should wrap operation for transaction", () => {
      const cio = ConnectionIO.pure(42).transact();
      expect(cio.op._tag).toBe("Transact");
    });

    it("raw should create Raw operation", () => {
      const cio = ConnectionIO.raw("SELECT 1", []);
      expect(cio.op._tag).toBe("Raw");
    });
  });

  // ==========================================================================
  // Attack 7: ConnectionIO Combinators
  // ==========================================================================
  describe("ConnectionIO Combinators", () => {
    it("sequence should combine multiple operations", () => {
      const ops = [ConnectionIO.pure(1), ConnectionIO.pure(2), ConnectionIO.pure(3)];

      const combined = sequence(ops);
      // The result is a chain of flatMaps which appear as Pure nodes
      // (the actual chaining happens during interpretation)
      expect(combined.op._tag).toBe("Pure");
    });

    it("traverse should map and sequence", () => {
      const items = [1, 2, 3];
      const result = traverse(items, (n) => ConnectionIO.pure(n * 2));

      expect(result.op._tag).toBe("Pure");
    });

    it("when should conditionally include operation", () => {
      const op = ConnectionIO.pure(undefined as void);

      const included = when(true, op);
      const excluded = when(false, op);

      // Both create ConnectionIO, but excluded returns unit
      expect(included.op._tag).toBe("Pure");
      expect(excluded.op._tag).toBe("Pure");
    });

    it("whenA should conditionally include operation with result", () => {
      const op = ConnectionIO.pure(42);

      const included = whenA(true, op);
      const excluded = whenA(false, op);

      // excluded should return null
      expect((excluded.op as { value: null }).value).toBe(null);
    });
  });

  // ==========================================================================
  // Attack 8: TypedFragment Edge Cases
  // ==========================================================================
  describe("TypedFragment Edge Cases", () => {
    it("emptyTyped should have empty segments and params", () => {
      expect(emptyTyped.segments).toEqual([""]);
      expect(emptyTyped.params).toEqual([]);
    });

    it("andTyped should handle single fragment", () => {
      const frag = new TypedFragment<[number], void>(["x = ", ""], [1]);
      const result = andTyped(frag);

      expect(result.params).toEqual([1]);
    });

    it("orTyped should handle single fragment", () => {
      const frag = new TypedFragment<[number], void>(["x = ", ""], [1]);
      const result = orTyped(frag);

      expect(result.params).toEqual([1]);
    });

    it("inListTyped should handle empty array", () => {
      const result = inListTyped<number>("id", []);

      // Empty IN should be false
      expect(result.segments).toEqual(["1 = 0"]);
      expect(result.params).toEqual([]);
    });

    it("inListTyped should handle single element", () => {
      const result = inListTyped<number>("id", [42]);

      expect(result.segments).toContain("id IN (?)");
      expect(result.params).toEqual([42]);
    });

    it("whenTyped should return empty for false condition", () => {
      const frag = new TypedFragment<[number], void>(["x = ", ""], [1]);
      const result = whenTyped(false, frag);

      expect(result).toBe(emptyTyped);
    });

    it("whereAndTyped should handle all falsy conditions", () => {
      const result = whereAndTyped(null, undefined, false);

      expect(result.segments.join("")).toBe("");
    });

    it("TypedFragment.append should concatenate params correctly", () => {
      const a = new TypedFragment<[number], void>(["a = ", ""], [1]);
      const b = new TypedFragment<[string], void>(["b = ", ""], ["two"]);
      const combined = a.append(b);

      expect(combined.params).toEqual([1, "two"]);
    });
  });

  // ==========================================================================
  // Attack 9: Read/Write Derivation Edge Cases
  // ==========================================================================
  describe("Read/Write Derivation Edge Cases", () => {
    it("toSnakeCase should handle camelCase", () => {
      expect(toSnakeCase("createdAt")).toBe("created_at");
      expect(toSnakeCase("userId")).toBe("user_id");
      expect(toSnakeCase("XMLParser")).toBe("_x_m_l_parser");
    });

    it("toSnakeCase should handle already snake_case", () => {
      expect(toSnakeCase("already_snake")).toBe("already_snake");
    });

    it("toSnakeCase should handle single word", () => {
      expect(toSnakeCase("name")).toBe("name");
    });

    it("deriveRead should create Read from config", () => {
      const ReadUser = deriveRead<{ id: number; name: string }>({
        id: { field: "id", meta: Meta.number },
        name: { field: "name", meta: Meta.string },
      });

      expect(ReadUser.columns).toContain("id");
      expect(ReadUser.columns).toContain("name");
    });

    it("deriveRead should handle nullable fields", () => {
      const ReadUser = deriveRead<{ id: number; nickname: string | null }>({
        id: { field: "id", meta: Meta.number },
        nickname: { field: "nickname", meta: Meta.string, nullable: true },
      });

      const result = ReadUser.read({ id: 1, nickname: null });
      expect(result).toEqual({ id: 1, nickname: null });
    });

    it("deriveRead should return null for missing required field", () => {
      const ReadUser = deriveRead<{ id: number; name: string }>({
        id: { field: "id", meta: Meta.number },
        name: { field: "name", meta: Meta.string },
      });

      const result = ReadUser.read({ id: 1, name: null });
      expect(result).toBe(null);
    });

    it("deriveWrite should create Write from config", () => {
      const WriteUser = deriveWrite<{ id: number; name: string }>({
        id: { field: "id", meta: Meta.number },
        name: { field: "name", meta: Meta.string },
      });

      expect(WriteUser.columns).toContain("id");
      expect(WriteUser.columns).toContain("name");
    });

    it("deriveWrite should encode values in column order", () => {
      const WriteUser = deriveWrite<{ id: number; name: string }>({
        id: { field: "id", meta: Meta.number },
        name: { field: "name", meta: Meta.string },
      });

      const result = WriteUser.write({ id: 1, name: "Alice" });
      expect(result).toEqual([1, "Alice"]);
    });
  });

  // ==========================================================================
  // Attack 10: VALUES Clause Edge Cases
  // ==========================================================================
  describe("VALUES Clause Edge Cases", () => {
    it("Fragment.values should handle single row", () => {
      const frag = Fragment.values([["Alice", 30]]);

      expect(frag.text).toBe("VALUES ($1, $2)");
      expect(frag.values).toEqual(["Alice", 30]);
    });

    it("Fragment.values should handle multiple rows", () => {
      const frag = Fragment.values([
        ["Alice", 30],
        ["Bob", 25],
      ]);

      expect(frag.text).toBe("VALUES ($1, $2), ($3, $4)");
      expect(frag.values).toEqual(["Alice", 30, "Bob", 25]);
    });

    it("Fragment.values should handle empty rows", () => {
      const frag = Fragment.values([]);

      expect(frag.text).toBe("VALUES ");
      expect(frag.values).toEqual([]);
    });

    it("Fragment.set should create SET clause", () => {
      const frag = Fragment.set({ name: "Bob", age: 31 });

      expect(frag.text).toContain("SET");
      expect(frag.text).toContain("name = $");
      expect(frag.text).toContain("age = $");
    });
  });

  // ==========================================================================
  // Attack 11: Either Type Correctness
  // ==========================================================================
  describe("Either Type Correctness", () => {
    it("Left should create left variant", () => {
      const left = Left<Error, number>(new Error("test"));

      expect(left._tag).toBe("Left");
      expect(left.left).toBeInstanceOf(Error);
    });

    it("Right should create right variant", () => {
      const right = Right<Error, number>(42);

      expect(right._tag).toBe("Right");
      expect(right.right).toBe(42);
    });
  });

  // ==========================================================================
  // Attack 12: Codec Composition
  // ==========================================================================
  describe("Codec Composition", () => {
    it("Codec.fromReadWrite should combine Read and Write", () => {
      const read = Read.column("value", Get.number);
      const write = Write.column("value", Put.number);
      const codec = Codec.fromReadWrite(read, write);

      expect(codec._tag).toBe("Codec");
      expect(codec.columns).toEqual(["value"]);
    });

    it("Codec.imap should transform bidirectionally", () => {
      const stringCodec = Codec.fromReadWrite(
        Read.column("value", Get.string),
        Write.column("value", Put.string)
      );

      const uppercaseCodec = Codec.imap(
        stringCodec,
        (s) => s.toUpperCase(),
        (s) => s.toLowerCase()
      );

      expect(uppercaseCodec.read({ value: "hello" })).toBe("HELLO");
      expect(uppercaseCodec.write("HELLO")).toEqual(["hello"]);
    });
  });

  // ==========================================================================
  // Attack 13: Meta Transformations
  // ==========================================================================
  describe("Meta Transformations", () => {
    it("Meta.imap should transform both directions", () => {
      // Create a UserId newtype pattern
      type UserId = string & { readonly __brand: "UserId" };
      const UserId = (s: string) => s as UserId;

      const userIdMeta = Meta.imap(Meta.string, UserId, (id) => id);

      expect(userIdMeta.get("user-123")).toBe("user-123");
      expect(userIdMeta.put(UserId("user-123"))).toBe("user-123");
    });

    it("Meta.array should handle arrays", () => {
      const intArrayMeta = Meta.array(Meta.int);

      expect(intArrayMeta.get([1, 2, 3])).toEqual([1, 2, 3]);
      expect(intArrayMeta.put([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });
});
