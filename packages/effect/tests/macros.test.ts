/**
 * Service and Layer Registry Tests
 *
 * Note: The actual @service and @layer macro transformations happen at compile time.
 * These tests verify the runtime registry functionality used by the macros.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  serviceRegistry,
  registerService,
  getService,
  type ServiceInfo,
} from "../src/macros/service.js";
import {
  layerRegistry,
  registerLayer,
  getLayer,
  getLayersForService,
  type LayerInfo,
} from "../src/macros/layer.js";

describe("Service Registry", () => {
  beforeEach(() => {
    serviceRegistry.clear();
  });

  afterEach(() => {
    serviceRegistry.clear();
  });

  it("should register a service", () => {
    const info: ServiceInfo = {
      name: "TestService",
      tagClassName: "TestServiceTag",
      methods: [
        { name: "getData", returnType: "Effect.Effect<string>" },
        {
          name: "processData",
          returnType: "Effect.Effect<void, ProcessError>",
        },
      ],
      sourceFile: "test.ts",
    };

    registerService(info);
    expect(serviceRegistry.has("TestService")).toBe(true);
    expect(getService("TestService")).toEqual(info);
  });

  it("should return undefined for unregistered service", () => {
    expect(getService("NonExistent")).toBeUndefined();
  });

  it("should overwrite existing service on re-registration", () => {
    const info1: ServiceInfo = {
      name: "Service",
      tagClassName: "ServiceTag",
      methods: [],
      sourceFile: "file1.ts",
    };
    const info2: ServiceInfo = {
      name: "Service",
      tagClassName: "ServiceTagV2",
      methods: [{ name: "newMethod", returnType: "Effect.Effect<number>" }],
      sourceFile: "file2.ts",
    };

    registerService(info1);
    registerService(info2);

    const retrieved = getService("Service");
    expect(retrieved?.tagClassName).toBe("ServiceTagV2");
    expect(retrieved?.methods.length).toBe(1);
  });
});

describe("Layer Registry", () => {
  beforeEach(() => {
    layerRegistry.clear();
  });

  afterEach(() => {
    layerRegistry.clear();
  });

  it("should register a layer", () => {
    const info: LayerInfo = {
      name: "databaseLive",
      provides: "Database",
      requires: [],
      sourceFile: "layers.ts",
      layerType: "succeed",
    };

    registerLayer(info);
    expect(layerRegistry.size).toBe(1);
    expect(getLayer("databaseLive")).toEqual(info);
  });

  it("should register layer with dependencies", () => {
    const info: LayerInfo = {
      name: "userRepoLive",
      provides: "UserRepo",
      requires: ["Database", "Logger"],
      sourceFile: "layers.ts",
      layerType: "effect",
    };

    registerLayer(info);
    const retrieved = getLayer("userRepoLive");
    expect(retrieved?.requires).toEqual(["Database", "Logger"]);
  });

  it("should get all layers for a service", () => {
    const layer1: LayerInfo = {
      name: "dbLive",
      provides: "Database",
      requires: [],
      sourceFile: "live.ts",
      layerType: "succeed",
    };
    const layer2: LayerInfo = {
      name: "dbTest",
      provides: "Database",
      requires: [],
      sourceFile: "test.ts",
      layerType: "succeed",
    };
    const layer3: LayerInfo = {
      name: "loggerLive",
      provides: "Logger",
      requires: [],
      sourceFile: "live.ts",
      layerType: "succeed",
    };

    registerLayer(layer1);
    registerLayer(layer2);
    registerLayer(layer3);

    const dbLayers = getLayersForService("Database");
    expect(dbLayers.length).toBe(2);
    expect(dbLayers.map((l) => l.name).sort()).toEqual(["dbLive", "dbTest"]);
  });

  it("should return empty array for service with no layers", () => {
    const layers = getLayersForService("NonExistent");
    expect(layers).toEqual([]);
  });
});

describe("Layer Dependency Graph", () => {
  beforeEach(() => {
    layerRegistry.clear();
  });

  afterEach(() => {
    layerRegistry.clear();
  });

  it("should support building dependency chains", () => {
    // Database has no dependencies
    registerLayer({
      name: "databaseLive",
      provides: "Database",
      requires: [],
      sourceFile: "layers.ts",
      layerType: "succeed",
    });

    // Logger has no dependencies
    registerLayer({
      name: "loggerLive",
      provides: "Logger",
      requires: [],
      sourceFile: "layers.ts",
      layerType: "succeed",
    });

    // UserRepo depends on Database
    registerLayer({
      name: "userRepoLive",
      provides: "UserRepo",
      requires: ["Database"],
      sourceFile: "layers.ts",
      layerType: "effect",
    });

    // EmailService depends on Logger
    registerLayer({
      name: "emailServiceLive",
      provides: "EmailService",
      requires: ["Logger"],
      sourceFile: "layers.ts",
      layerType: "effect",
    });

    // AppService depends on UserRepo and EmailService
    registerLayer({
      name: "appServiceLive",
      provides: "AppService",
      requires: ["UserRepo", "EmailService"],
      sourceFile: "layers.ts",
      layerType: "effect",
    });

    // Verify the dependency chain
    const appService = getLayer("appServiceLive");
    expect(appService?.requires).toEqual(["UserRepo", "EmailService"]);

    const userRepo = getLayer("userRepoLive");
    expect(userRepo?.requires).toEqual(["Database"]);

    // Could resolve full chain: AppService -> UserRepo -> Database
    //                         -> EmailService -> Logger
    const userRepoDeps = getLayersForService("UserRepo");
    expect(userRepoDeps.length).toBe(1);
    expect(userRepoDeps[0].requires).toEqual(["Database"]);
  });
});
