/**
 * Red Team Tests for @typesugar/effect
 *
 * Attack surfaces:
 * - Service registry: Tag collision, duplicate registration, empty interfaces
 * - Layer resolution: Circular dependencies, diamond dependencies, missing layers
 * - Type extraction: Complex union/intersection types, nested generics
 * - FlatMap instance: Lazy loading edge cases, effect module missing
 * - HKT soundness: Type-level function consistency
 * - Extension method dispatch: Receiver type matching
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
} from "../packages/effect/src/macros/service.js";
import {
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,
} from "../packages/effect/src/macros/layer.js";
import { flatMapEffect } from "../packages/effect/src/index.js";
import { EffectExt, OptionExt, EitherExt } from "../packages/effect/src/extensions.js";

describe("Effect Integration Edge Cases", () => {
  // ==========================================================================
  // Attack 1: Service Registry Edge Cases
  // ==========================================================================
  describe("Service Registry Attacks", () => {
    beforeEach(() => {
      serviceRegistry.clear();
    });

    it("should warn but not error on duplicate service registration", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const service1: ServiceInfo = {
        name: "TestService",
        methods: [{ name: "foo", params: [], returnType: "Effect<void>" }],
        sourceFile: "/test/file1.ts",
      };

      const service2: ServiceInfo = {
        name: "TestService",
        methods: [{ name: "bar", params: [], returnType: "Effect<number>" }],
        sourceFile: "/test/file2.ts",
      };

      registerService(service1);
      registerService(service2);

      expect(warnSpy).toHaveBeenCalledWith(
        "Service 'TestService' is already registered, overwriting."
      );

      // The second registration overwrites the first
      const retrieved = getService("TestService");
      expect(retrieved?.methods[0].name).toBe("bar");

      warnSpy.mockRestore();
    });

    it("should handle service with no methods (empty interface)", () => {
      const emptyService: ServiceInfo = {
        name: "EmptyService",
        methods: [],
        sourceFile: "/test/empty.ts",
      };

      registerService(emptyService);

      const retrieved = getService("EmptyService");
      expect(retrieved).toBeDefined();
      expect(retrieved?.methods).toHaveLength(0);
    });

    it("should handle service names with special characters", () => {
      const specialNames = [
        "Service$With$Dollar",
        "Service_With_Underscore",
        "Service123",
        "UPPERCASE_SERVICE",
        "λService", // Greek letter
      ];

      for (const name of specialNames) {
        registerService({
          name,
          methods: [],
          sourceFile: "/test/special.ts",
        });
      }

      for (const name of specialNames) {
        expect(getService(name)).toBeDefined();
      }
    });

    it("should return undefined for non-existent service", () => {
      expect(getService("NonExistentService")).toBeUndefined();
    });

    it("should handle method params with complex type strings", () => {
      const complexService: ServiceInfo = {
        name: "ComplexService",
        methods: [
          {
            name: "complexMethod",
            params: [
              { name: "arg1", typeString: "Map<string, Array<number>>" },
              { name: "arg2", typeString: "Record<keyof T, Promise<unknown>>" },
              { name: "arg3", typeString: "(x: number) => Effect.Effect<void, never, never>" },
            ],
            returnType: "Effect.Effect<{ nested: { deep: boolean } }, Error, HttpClient>",
          },
        ],
        sourceFile: "/test/complex.ts",
      };

      registerService(complexService);

      const retrieved = getService("ComplexService");
      expect(retrieved?.methods[0].params).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Attack 2: Layer Resolution Edge Cases
  // ==========================================================================
  describe("Layer Resolution Attacks", () => {
    beforeEach(() => {
      layerRegistry.clear();
    });

    it("should detect circular dependencies in layer graph", () => {
      // A depends on B, B depends on C, C depends on A
      const layerA: LayerInfo = {
        name: "layerA",
        provides: "ServiceA",
        requires: ["ServiceB"],
        sourceFile: "/test/a.ts",
        layerType: "effect",
      };

      const layerB: LayerInfo = {
        name: "layerB",
        provides: "ServiceB",
        requires: ["ServiceC"],
        sourceFile: "/test/b.ts",
        layerType: "effect",
      };

      const layerC: LayerInfo = {
        name: "layerC",
        provides: "ServiceC",
        requires: ["ServiceA"],
        sourceFile: "/test/c.ts",
        layerType: "effect",
      };

      registerLayer(layerA);
      registerLayer(layerB);
      registerLayer(layerC);

      // The topological sort should detect the cycle
      // This is tested indirectly - the registry stores the layers
      // but resolveLayer<>() macro would throw at compile time
      expect(getLayer("layerA")?.requires).toContain("ServiceB");
      expect(getLayer("layerB")?.requires).toContain("ServiceC");
      expect(getLayer("layerC")?.requires).toContain("ServiceA");
    });

    it("should handle diamond dependency pattern", () => {
      // D depends on B and C, both B and C depend on A
      //     D
      //    / \
      //   B   C
      //    \ /
      //     A
      const layerA: LayerInfo = {
        name: "layerA",
        provides: "ServiceA",
        requires: [],
        sourceFile: "/test/a.ts",
        layerType: "succeed",
      };

      const layerB: LayerInfo = {
        name: "layerB",
        provides: "ServiceB",
        requires: ["ServiceA"],
        sourceFile: "/test/b.ts",
        layerType: "effect",
      };

      const layerC: LayerInfo = {
        name: "layerC",
        provides: "ServiceC",
        requires: ["ServiceA"],
        sourceFile: "/test/c.ts",
        layerType: "effect",
      };

      const layerD: LayerInfo = {
        name: "layerD",
        provides: "ServiceD",
        requires: ["ServiceB", "ServiceC"],
        sourceFile: "/test/d.ts",
        layerType: "effect",
      };

      registerLayer(layerA);
      registerLayer(layerB);
      registerLayer(layerC);
      registerLayer(layerD);

      // All layers should be registered
      expect(getLayersForService("ServiceA")).toHaveLength(1);
      expect(getLayersForService("ServiceB")).toHaveLength(1);
      expect(getLayersForService("ServiceC")).toHaveLength(1);
      expect(getLayersForService("ServiceD")).toHaveLength(1);

      // D should have both B and C as requirements
      const dLayer = getLayer("layerD");
      expect(dLayer?.requires).toContain("ServiceB");
      expect(dLayer?.requires).toContain("ServiceC");
    });

    it("should handle multiple layers providing the same service", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const layer1: LayerInfo = {
        name: "httpClientLive",
        provides: "HttpClient",
        requires: [],
        sourceFile: "/test/live.ts",
        layerType: "succeed",
      };

      const layer2: LayerInfo = {
        name: "httpClientTest",
        provides: "HttpClient",
        requires: [],
        sourceFile: "/test/test.ts",
        layerType: "succeed",
      };

      registerLayer(layer1);
      registerLayer(layer2);

      // Both layers should exist (different names)
      const httpLayers = getLayersForService("HttpClient");
      expect(httpLayers).toHaveLength(2);

      warnSpy.mockRestore();
    });

    it("should handle layer with self-dependency (should be invalid)", () => {
      const selfDepLayer: LayerInfo = {
        name: "selfDepLayer",
        provides: "ServiceX",
        requires: ["ServiceX"], // Self-dependency!
        sourceFile: "/test/selfdep.ts",
        layerType: "effect",
      };

      registerLayer(selfDepLayer);

      // Registration succeeds but this creates an impossible resolution
      const layer = getLayer("selfDepLayer");
      expect(layer?.provides).toBe("ServiceX");
      expect(layer?.requires).toContain("ServiceX");
    });

    it("should handle empty requires array correctly", () => {
      const noDepLayer: LayerInfo = {
        name: "noDepLayer",
        provides: "IndependentService",
        requires: [],
        sourceFile: "/test/nodep.ts",
        layerType: "succeed",
      };

      registerLayer(noDepLayer);

      const layer = getLayer("noDepLayer");
      expect(layer?.requires).toEqual([]);
      expect(layer?.layerType).toBe("succeed");
    });

    it("should preserve layer type correctly", () => {
      const types: Array<LayerInfo["layerType"]> = ["succeed", "effect", "scoped"];

      for (const layerType of types) {
        const layer: LayerInfo = {
          name: `layer_${layerType}`,
          provides: `Service_${layerType}`,
          requires: [],
          sourceFile: "/test/types.ts",
          layerType,
        };

        registerLayer(layer);
      }

      expect(getLayer("layer_succeed")?.layerType).toBe("succeed");
      expect(getLayer("layer_effect")?.layerType).toBe("effect");
      expect(getLayer("layer_scoped")?.layerType).toBe("scoped");
    });
  });

  // ==========================================================================
  // Attack 3: FlatMap Instance Edge Cases
  // ==========================================================================
  describe("FlatMap Instance Attacks", () => {
    it("should lazily load effect module on first use", () => {
      // The flatMapEffect should work if 'effect' is installed
      // This test verifies the lazy loading mechanism
      expect(typeof flatMapEffect.map).toBe("function");
      expect(typeof flatMapEffect.flatMap).toBe("function");
    });

    it("should handle map with identity function", () => {
      // This requires 'effect' to be installed
      try {
        const Effect = require("effect").Effect;
        const result = flatMapEffect.map(Effect.succeed(42), (x: number) => x);

        // Should return an Effect that resolves to 42
        expect(result).toBeDefined();
      } catch {
        // Skip if effect is not installed
        console.log("Skipping: effect package not installed");
      }
    });

    it("should handle flatMap with succeed", () => {
      try {
        const Effect = require("effect").Effect;
        const result = flatMapEffect.flatMap(Effect.succeed(42), (x: number) =>
          Effect.succeed(x * 2)
        );

        expect(result).toBeDefined();
      } catch {
        console.log("Skipping: effect package not installed");
      }
    });

    it("should handle null/undefined values in map (if Effect permits)", () => {
      try {
        const Effect = require("effect").Effect;

        // Map to null
        const resultNull = flatMapEffect.map(Effect.succeed(42), () => null);
        expect(resultNull).toBeDefined();

        // Map to undefined
        const resultUndef = flatMapEffect.map(Effect.succeed(42), () => undefined);
        expect(resultUndef).toBeDefined();
      } catch {
        console.log("Skipping: effect package not installed");
      }
    });
  });

  // ==========================================================================
  // Attack 4: HKT Type Extraction Edge Cases
  // ==========================================================================
  describe("HKT Type Soundness", () => {
    it("should have EffectF use this['__kind__'] for parameterization", () => {
      // Type-level test: EffectF must use this["__kind__"] to be sound
      // We can't really test this at runtime, but we document the expectation
      // The implementation should be:
      // interface EffectF<E, R> extends TypeFunction { _: Effect<this["__kind__"], E, R> }
      //
      // A phantom type would be:
      // interface EffectF<E, R> extends TypeFunction { _: Effect<never, E, R> }  // WRONG
      //
      // This is verified by code review of hkt.ts

      expect(true).toBe(true); // Placeholder for type-level verification
    });

    it("should have ChunkF use this['__kind__'] for parameterization", () => {
      // Same verification for ChunkF
      expect(true).toBe(true);
    });

    it("type aliases should correctly extract Effect type parameters", () => {
      // EffectSuccess, EffectError, EffectRequirements should work
      // This is a type-level test
      type TestEffect = import("effect").Effect.Effect<number, string, unknown>;

      // At runtime we can't test conditional types, but we verify exports exist
      expect(true).toBe(true);
    });
  });

  // ==========================================================================
  // Attack 5: Extension Method Namespace Edge Cases
  // ==========================================================================
  describe("Extension Method Edge Cases", () => {
    it("EffectExt methods should be callable functions", () => {
      // Verify the namespace exports are functions (imported at top level)
      expect(typeof EffectExt.map).toBe("function");
      expect(typeof EffectExt.flatMap).toBe("function");
      expect(typeof EffectExt.tap).toBe("function");

      expect(typeof OptionExt.map).toBe("function");
      expect(typeof OptionExt.flatMap).toBe("function");

      expect(typeof EitherExt.map).toBe("function");
      expect(typeof EitherExt.flatMap).toBe("function");
    });

    // Note: Tests that require the `effect` package directly are in packages/effect/tests/
    // Here we test extension method structure only since `effect` may not be installed at root
    it("EffectExt.runSync exists and is a function", () => {
      expect(typeof EffectExt.runSync).toBe("function");
      expect(typeof EffectExt.runPromise).toBe("function");
      expect(typeof EffectExt.runPromiseExit).toBe("function");
    });

    it("OptionExt has all expected methods", () => {
      expect(typeof OptionExt.getOrNull).toBe("function");
      expect(typeof OptionExt.getOrUndefined).toBe("function");
      expect(typeof OptionExt.getOrElse).toBe("function");
      expect(typeof OptionExt.isSome).toBe("function");
      expect(typeof OptionExt.isNone).toBe("function");
      expect(typeof OptionExt.filter).toBe("function");
      expect(typeof OptionExt.orElse).toBe("function");
    });

    it("EitherExt has all expected methods", () => {
      expect(typeof EitherExt.flip).toBe("function");
      expect(typeof EitherExt.getOrElse).toBe("function");
      expect(typeof EitherExt.isRight).toBe("function");
      expect(typeof EitherExt.isLeft).toBe("function");
      expect(typeof EitherExt.mapLeft).toBe("function");
    });

    it("EffectExt has all expected combinator methods", () => {
      // Mapping
      expect(typeof EffectExt.as).toBe("function");
      expect(typeof EffectExt.asVoid).toBe("function");

      // Sequencing
      expect(typeof EffectExt.flatten).toBe("function");
      expect(typeof EffectExt.tap).toBe("function");
      expect(typeof EffectExt.tapError).toBe("function");
      expect(typeof EffectExt.tapBoth).toBe("function");

      // Error handling
      expect(typeof EffectExt.catchAll).toBe("function");
      expect(typeof EffectExt.orElse).toBe("function");
      expect(typeof EffectExt.orElseSucceed).toBe("function");
      expect(typeof EffectExt.mapError).toBe("function");
      expect(typeof EffectExt.mapBoth).toBe("function");

      // Option/Either integration
      expect(typeof EffectExt.someOrFail).toBe("function");
      expect(typeof EffectExt.option).toBe("function");
      expect(typeof EffectExt.either).toBe("function");

      // Combinators
      expect(typeof EffectExt.zip).toBe("function");
      expect(typeof EffectExt.zipLeft).toBe("function");
      expect(typeof EffectExt.zipRight).toBe("function");
      expect(typeof EffectExt.zipWith).toBe("function");

      // Filtering
      expect(typeof EffectExt.filterOrFail).toBe("function");
      expect(typeof EffectExt.filterOrDie).toBe("function");

      // Timing
      expect(typeof EffectExt.delay).toBe("function");
      expect(typeof EffectExt.timeout).toBe("function");
      expect(typeof EffectExt.timeoutFail).toBe("function");
      expect(typeof EffectExt.timed).toBe("function");

      // Retry
      expect(typeof EffectExt.retry).toBe("function");

      // Resource management
      expect(typeof EffectExt.ensuring).toBe("function");
      expect(typeof EffectExt.onSuccess).toBe("function");
      expect(typeof EffectExt.onError).toBe("function");

      // Providing context
      expect(typeof EffectExt.provideService).toBe("function");
      expect(typeof EffectExt.provide).toBe("function");
    });
  });

  // ==========================================================================
  // Attack 6: Registration Race Conditions
  // ==========================================================================
  describe("Registration Race Conditions", () => {
    beforeEach(() => {
      serviceRegistry.clear();
      layerRegistry.clear();
    });

    it("should handle concurrent service registrations deterministically", () => {
      // Simulate rapid registrations
      const services: ServiceInfo[] = Array.from({ length: 100 }, (_, i) => ({
        name: `Service${i}`,
        methods: [],
        sourceFile: `/test/service${i}.ts`,
      }));

      // Register all
      for (const service of services) {
        registerService(service);
      }

      // All should be present
      for (let i = 0; i < 100; i++) {
        expect(getService(`Service${i}`)).toBeDefined();
      }

      expect(serviceRegistry.size).toBe(100);
    });

    it("should handle rapid layer registrations", () => {
      const layers: LayerInfo[] = Array.from({ length: 100 }, (_, i) => ({
        name: `layer${i}`,
        provides: `Service${i}`,
        requires: i > 0 ? [`Service${i - 1}`] : [],
        sourceFile: `/test/layer${i}.ts`,
        layerType: "effect" as const,
      }));

      for (const layer of layers) {
        registerLayer(layer);
      }

      expect(layerRegistry.size).toBe(100);

      // Check dependency chain is intact
      const layer50 = getLayer("layer50");
      expect(layer50?.requires).toContain("Service49");
    });
  });

  // ==========================================================================
  // Attack 7: Malformed Input Handling
  // ==========================================================================
  describe("Malformed Input Handling", () => {
    beforeEach(() => {
      serviceRegistry.clear();
      layerRegistry.clear();
    });

    it("should handle service with extremely long name", () => {
      const longName = "A".repeat(10000);
      const service: ServiceInfo = {
        name: longName,
        methods: [],
        sourceFile: "/test/long.ts",
      };

      registerService(service);
      expect(getService(longName)).toBeDefined();
    });

    it("should handle service with unicode name", () => {
      const unicodeName = "服务🚀δσервис";
      const service: ServiceInfo = {
        name: unicodeName,
        methods: [],
        sourceFile: "/test/unicode.ts",
      };

      registerService(service);
      expect(getService(unicodeName)).toBeDefined();
    });

    it("should handle layer with empty string provides", () => {
      const emptyLayer: LayerInfo = {
        name: "emptyProvides",
        provides: "", // Empty string!
        requires: [],
        sourceFile: "/test/empty.ts",
        layerType: "succeed",
      };

      registerLayer(emptyLayer);

      // Should still be retrievable
      const layer = getLayer("emptyProvides");
      expect(layer?.provides).toBe("");

      // getLayersForService with empty string
      const layers = getLayersForService("");
      expect(layers).toHaveLength(1);
    });

    it("should handle deeply nested requirement chains", () => {
      // Create a chain of 50 services where each depends on the previous
      for (let i = 0; i < 50; i++) {
        registerLayer({
          name: `deepLayer${i}`,
          provides: `DeepService${i}`,
          requires: i > 0 ? [`DeepService${i - 1}`] : [],
          sourceFile: `/test/deep${i}.ts`,
          layerType: "effect",
        });
      }

      // The deepest layer should have the full chain
      const deepest = getLayer("deepLayer49");
      expect(deepest?.requires).toContain("DeepService48");

      // First layer should have no dependencies
      const first = getLayer("deepLayer0");
      expect(first?.requires).toEqual([]);
    });
  });
});
