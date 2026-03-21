/**
 * Playground Runtime Entry
 *
 * Bundles @typesugar runtime packages and registers them on globalThis
 * so user code in the sandbox iframe can import from them.
 *
 * Built as IIFE → injected into the sandbox iframe before user code.
 *
 * TypeScript is stubbed out (see esbuild-ts-stub-plugin) so macro expand()
 * functions don't work, but runtime APIs (constructors, guards, etc.) do.
 *
 * Packages with heavy macro-only deps (effect) are excluded.
 */

const modules: Record<string, Record<string, unknown>> = {};

function register(name: string, loader: () => Record<string, unknown>) {
  try {
    modules[name] = loader();
  } catch (e) {
    console.warn(`[playground-runtime] Failed to load ${name}:`, (e as Error).message);
    modules[name] = {};
  }
}

import * as core from "@typesugar/core";
register("typesugar", () => core);
register("@typesugar/core", () => core);

import * as typeSystem from "@typesugar/type-system";
register("@typesugar/type-system", () => typeSystem);

import * as typeclass from "@typesugar/typeclass";
register("@typesugar/typeclass", () => typeclass);

import * as fp from "@typesugar/fp";
import * as fpOption from "../../fp/src/data/option.js";
import * as fpEither from "../../fp/src/data/either.js";
register("@typesugar/fp", () => fp);
register("@typesugar/fp/data/option", () => fpOption as unknown as Record<string, unknown>);
register("@typesugar/fp/data/either", () => fpEither as unknown as Record<string, unknown>);

import * as std from "@typesugar/std";
register("@typesugar/std", () => std);

import * as collections from "@typesugar/collections";
register("@typesugar/collections", () => collections);

import * as contracts from "@typesugar/contracts";
register("@typesugar/contracts", () => contracts);

import * as validate from "@typesugar/validate";
register("@typesugar/validate", () => validate);

import * as codec from "@typesugar/codec";
register("@typesugar/codec", () => codec);

import * as graph from "@typesugar/graph";
register("@typesugar/graph", () => graph);

import * as units from "@typesugar/units";
register("@typesugar/units", () => units);

import * as parser from "@typesugar/parser";
register("@typesugar/parser", () => parser);

import * as symbolic from "@typesugar/symbolic";
register("@typesugar/symbolic", () => symbolic);

import * as testing from "@typesugar/testing";
register("@typesugar/testing", () => testing);

import * as mapper from "@typesugar/mapper";
register("@typesugar/mapper", () => mapper);

import * as math from "@typesugar/math";
register("@typesugar/math", () => math);

(globalThis as Record<string, unknown>).__typesugar_modules = modules;
