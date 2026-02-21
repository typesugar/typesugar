import { describe, it, expect } from "vitest";
import { tokenize, type Token } from "../src/scanner.js";
import * as ts from "typescript";

describe("scanner", () => {
  describe("tokenize", () => {
    it("should tokenize basic TypeScript", () => {
      const tokens = tokenize("const x = 1;");
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens[0].text).toBe("const");
      expect(tokens[0].kind).toBe(ts.SyntaxKind.ConstKeyword);
    });

    it("should merge |> from adjacent | and >", () => {
      const tokens = tokenize("x |> f");
      const pipeToken = tokens.find((t) => t.text === "|>");
      expect(pipeToken).toBeDefined();
      expect(pipeToken?.isCustomOperator).toBe(true);
    });

    it("should not merge | and > with space between", () => {
      const tokens = tokenize("x | > 5");
      const pipeToken = tokens.find((t) => t.text === "|>");
      expect(pipeToken).toBeUndefined();
    });

    it("should merge :: from adjacent : and :", () => {
      const tokens = tokenize("head :: tail");
      const consToken = tokens.find((t) => t.text === "::");
      expect(consToken).toBeDefined();
      expect(consToken?.isCustomOperator).toBe(true);
    });

    it("should not merge single : with next :", () => {
      const tokens = tokenize("x : : y");
      const consToken = tokens.find((t) => t.text === "::");
      expect(consToken).toBeUndefined();
    });

    it("should handle multiple custom operators", () => {
      const tokens = tokenize("a |> b :: c");
      const pipeToken = tokens.find((t) => t.text === "|>");
      const consToken = tokens.find((t) => t.text === "::");
      expect(pipeToken).toBeDefined();
      expect(consToken).toBeDefined();
    });

    it("should preserve positions for merged tokens", () => {
      const source = "x |> f";
      const tokens = tokenize(source);
      const pipeToken = tokens.find((t) => t.text === "|>");
      expect(pipeToken).toBeDefined();
      expect(source.slice(pipeToken!.start, pipeToken!.end)).toBe("|>");
    });

    it("should handle chained pipeline operators", () => {
      const tokens = tokenize("x |> f |> g |> h");
      const pipeTokens = tokens.filter((t) => t.text === "|>");
      expect(pipeTokens.length).toBe(3);
    });

    it("should handle cons in array literal", () => {
      const tokens = tokenize("1 :: 2 :: []");
      const consTokens = tokens.filter((t) => t.text === "::");
      expect(consTokens.length).toBe(2);
    });

    it("should not merge operators inside strings", () => {
      const tokens = tokenize("const s = '|>';");
      const pipeToken = tokens.find((t) => t.text === "|>" && t.isCustomOperator);
      expect(pipeToken).toBeUndefined();
    });

    it("should handle custom operator configuration", () => {
      const tokens = tokenize("a <| b", {
        customOperators: [{ symbol: "<|", chars: ["<", "|"] }],
      });
      const rapplyToken = tokens.find((t) => t.text === "<|");
      expect(rapplyToken).toBeDefined();
      expect(rapplyToken?.isCustomOperator).toBe(true);
    });
  });
});
