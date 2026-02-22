/**
 * Tests for standalone extension methods (Scala 3-style concrete type extensions)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  getStandaloneExtensionsForType,
  getAllStandaloneExtensions,
  buildStandaloneExtensionCall,
  standaloneExtensionRegistry,
  type StandaloneExtensionInfo,
} from "@typesugar/macros";
import * as ts from "typescript";

describe("standalone extension registry", () => {
  beforeEach(() => {
    standaloneExtensionRegistry.length = 0;
  });

  describe("registerStandaloneExtensionEntry", () => {
    it("should register a standalone extension with qualifier", () => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });

      expect(standaloneExtensionRegistry).toHaveLength(1);
      expect(standaloneExtensionRegistry[0]).toEqual({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });
    });

    it("should register a standalone extension without qualifier", () => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: undefined,
      });

      expect(standaloneExtensionRegistry).toHaveLength(1);
      expect(standaloneExtensionRegistry[0].qualifier).toBeUndefined();
    });

    it("should prevent duplicate registrations", () => {
      const entry: StandaloneExtensionInfo = {
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      };

      registerStandaloneExtensionEntry(entry);
      registerStandaloneExtensionEntry(entry);

      expect(standaloneExtensionRegistry).toHaveLength(1);
    });

    it("should allow same method name for different types", () => {
      registerStandaloneExtensionEntry({
        methodName: "head",
        forType: "Array",
        qualifier: "ArrayExt",
      });
      registerStandaloneExtensionEntry({
        methodName: "head",
        forType: "string",
        qualifier: "StringExt",
      });

      expect(standaloneExtensionRegistry).toHaveLength(2);
    });
  });

  describe("findStandaloneExtension", () => {
    beforeEach(() => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });
      registerStandaloneExtensionEntry({
        methodName: "isPrime",
        forType: "number",
        qualifier: "NumberExt",
      });
      registerStandaloneExtensionEntry({
        methodName: "capitalize",
        forType: "string",
        qualifier: "StringExt",
      });
    });

    it("should find an extension by method name and type", () => {
      const ext = findStandaloneExtension("clamp", "number");
      expect(ext).toBeDefined();
      expect(ext!.methodName).toBe("clamp");
      expect(ext!.forType).toBe("number");
      expect(ext!.qualifier).toBe("NumberExt");
    });

    it("should return undefined for unknown method", () => {
      const ext = findStandaloneExtension("unknownMethod", "number");
      expect(ext).toBeUndefined();
    });

    it("should return undefined for wrong type", () => {
      const ext = findStandaloneExtension("clamp", "string");
      expect(ext).toBeUndefined();
    });

    it("should distinguish between types", () => {
      const numExt = findStandaloneExtension("clamp", "number");
      const strExt = findStandaloneExtension("capitalize", "string");

      expect(numExt?.qualifier).toBe("NumberExt");
      expect(strExt?.qualifier).toBe("StringExt");
    });
  });

  describe("getStandaloneExtensionsForType", () => {
    beforeEach(() => {
      registerStandaloneExtensionEntry({
        methodName: "clamp",
        forType: "number",
        qualifier: "NumberExt",
      });
      registerStandaloneExtensionEntry({
        methodName: "isPrime",
        forType: "number",
        qualifier: "NumberExt",
      });
      registerStandaloneExtensionEntry({
        methodName: "capitalize",
        forType: "string",
        qualifier: "StringExt",
      });
    });

    it("should return all extensions for a type", () => {
      const exts = getStandaloneExtensionsForType("number");
      expect(exts).toHaveLength(2);
      expect(exts.map((e) => e.methodName).sort()).toEqual(["clamp", "isPrime"]);
    });

    it("should return empty array for unknown type", () => {
      const exts = getStandaloneExtensionsForType("boolean");
      expect(exts).toHaveLength(0);
    });
  });

  describe("getAllStandaloneExtensions", () => {
    it("should return a copy of all registered extensions", () => {
      // Get two snapshots of the registry
      const snapshot1 = getAllStandaloneExtensions();
      const snapshot2 = getAllStandaloneExtensions();

      // They should not be the same array reference
      expect(snapshot1).not.toBe(snapshot2);

      // They should have the same contents
      expect(snapshot1).toEqual(snapshot2);

      // Mutating one should not affect the other
      // Using Array.prototype.push.call to avoid transformer rewriting
      const originalLength = snapshot1.length;
      Array.prototype.push.call(snapshot1, {
        methodName: "fake",
        forType: "fake",
        qualifier: undefined,
      });
      expect(snapshot1).toHaveLength(originalLength + 1);
      expect(snapshot2).toHaveLength(originalLength);

      // A new snapshot should also be unaffected
      const snapshot3 = getAllStandaloneExtensions();
      expect(snapshot3).toHaveLength(originalLength);
    });
  });
});

describe("buildStandaloneExtensionCall", () => {
  const factory = ts.factory;

  it("should build qualified call: Namespace.method(receiver, args)", () => {
    const ext: StandaloneExtensionInfo = {
      methodName: "clamp",
      forType: "number",
      qualifier: "NumberExt",
    };

    const receiver = factory.createNumericLiteral(42);
    const min = factory.createNumericLiteral(0);
    const max = factory.createNumericLiteral(100);

    const result = buildStandaloneExtensionCall(factory, ext, receiver, [min, max]);

    expect(ts.isCallExpression(result)).toBe(true);

    // Print to verify structure
    const printer = ts.createPrinter();
    const sourceFile = ts.createSourceFile("", "", ts.ScriptTarget.Latest);
    const text = printer.printNode(ts.EmitHint.Expression, result, sourceFile);
    expect(text).toBe("NumberExt.clamp(42, 0, 100)");
  });

  it("should build bare call: method(receiver, args)", () => {
    const ext: StandaloneExtensionInfo = {
      methodName: "clamp",
      forType: "number",
      qualifier: undefined,
    };

    const receiver = factory.createNumericLiteral(42);
    const min = factory.createNumericLiteral(0);
    const max = factory.createNumericLiteral(100);

    const result = buildStandaloneExtensionCall(factory, ext, receiver, [min, max]);

    const printer = ts.createPrinter();
    const sourceFile = ts.createSourceFile("", "", ts.ScriptTarget.Latest);
    const text = printer.printNode(ts.EmitHint.Expression, result, sourceFile);
    expect(text).toBe("clamp(42, 0, 100)");
  });

  it("should build call with no extra args: method(receiver)", () => {
    const ext: StandaloneExtensionInfo = {
      methodName: "isPrime",
      forType: "number",
      qualifier: "NumberExt",
    };

    const receiver = factory.createNumericLiteral(7);
    const result = buildStandaloneExtensionCall(factory, ext, receiver, []);

    const printer = ts.createPrinter();
    const sourceFile = ts.createSourceFile("", "", ts.ScriptTarget.Latest);
    const text = printer.printNode(ts.EmitHint.Expression, result, sourceFile);
    expect(text).toBe("NumberExt.isPrime(7)");
  });
});
