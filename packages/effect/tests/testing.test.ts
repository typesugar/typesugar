/**
 * Effect Testing Utilities Tests
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockService,
  testLayer,
  combineLayers,
  succeedMock,
  failMock,
  dieMock,
  assertCalled,
  assertNotCalled,
  assertCalledTimes,
  type MockService,
} from "../src/testing.js";

// Test interface for mocking
interface TestService {
  getUser(id: string): Promise<{ id: string; name: string }>;
  saveUser(user: { id: string; name: string }): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
}

describe("mockService", () => {
  let mock: MockService<TestService>;

  beforeEach(() => {
    mock = mockService<TestService>();
  });

  it("should create a mock service with callable methods", () => {
    expect(typeof mock.getUser).toBe("function");
    expect(typeof mock.saveUser).toBe("function");
    expect(typeof mock.deleteUser).toBe("function");
  });

  it("should track calls", () => {
    mock.getUser("123");
    mock.getUser("456");

    expect(mock._calls.getUser).toHaveLength(2);
    expect(mock._calls.getUser[0]).toEqual(["123"]);
    expect(mock._calls.getUser[1]).toEqual(["456"]);
  });

  it("should support mockReturnValue", () => {
    const testUser = { id: "1", name: "Alice" };
    mock.getUser.mockReturnValue(Promise.resolve(testUser));

    const result = mock.getUser("1");
    expect(result).toBeInstanceOf(Promise);
  });

  it("should support mockImplementation", () => {
    mock.getUser.mockImplementation((id) => {
      return Promise.resolve({ id, name: `User ${id}` });
    });

    const result = mock.getUser("123");
    expect(result).toBeInstanceOf(Promise);
  });

  it("should reset all mocks with _resetAll", () => {
    mock.getUser("123");
    mock.saveUser({ id: "1", name: "Test" });

    expect(mock._calls.getUser).toHaveLength(1);
    expect(mock._calls.saveUser).toHaveLength(1);

    mock._resetAll();

    expect(mock._calls.getUser).toHaveLength(0);
    expect(mock._calls.saveUser).toHaveLength(0);
  });

  it("should support default implementations", () => {
    const mockWithDefaults = mockService<TestService>({
      getUser: (id) => Promise.resolve({ id, name: "Default User" }),
    });

    const result = mockWithDefaults.getUser("123");
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("testLayer", () => {
  it("should create a test layer object", () => {
    const mock = mockService<TestService>();
    const layer = testLayer("TestService", mock);

    expect(layer).toBeDefined();
    expect((layer as any)._tag).toBe("TestLayer");
    expect((layer as any).tag).toBe("TestService");
    expect((layer as any).service).toBe(mock);
  });

  it("should accept service tag object", () => {
    const mock = mockService<TestService>();
    const layer = testLayer({ _tag: "TestService" }, mock);

    expect((layer as any).tag).toBe("TestService");
  });
});

describe("combineLayers", () => {
  it("should combine multiple test layers", () => {
    const mock1 = mockService<TestService>();
    const mock2 = mockService<{ log(msg: string): void }>();

    const layer1 = testLayer("Service1", mock1);
    const layer2 = testLayer("Service2", mock2);

    const combined = combineLayers(layer1, layer2);

    expect(combined).toBeDefined();
    expect((combined as any)._tag).toBe("CombinedTestLayers");
    expect((combined as any).layers).toHaveLength(2);
  });
});

describe("succeedMock", () => {
  it("should create a mock that returns a success object", () => {
    const mock = succeedMock({ id: "1", name: "Alice" });
    const result = mock() as any;

    expect(result._tag).toBe("Success");
    expect(result.value).toEqual({ id: "1", name: "Alice" });
  });

  it("should track calls", () => {
    const mock = succeedMock("test");
    mock("arg1");
    mock("arg2", "arg3");

    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]).toEqual(["arg1"]);
    expect(mock.calls[1]).toEqual(["arg2", "arg3"]);
  });
});

describe("failMock", () => {
  it("should create a mock that returns a failure object", () => {
    const error = new Error("Not found");
    const mock = failMock(error);
    const result = mock() as any;

    expect(result._tag).toBe("Failure");
    expect(result.error).toBe(error);
  });
});

describe("dieMock", () => {
  it("should create a mock that returns a die object", () => {
    const defect = new Error("Unexpected");
    const mock = dieMock(defect);
    const result = mock() as any;

    expect(result._tag).toBe("Die");
    expect(result.defect).toBe(defect);
  });
});

describe("assertCalled", () => {
  it("should pass when method was called", () => {
    const mock = mockService<TestService>();
    mock.getUser("123");

    expect(() => assertCalled(mock, "getUser")).not.toThrow();
  });

  it("should fail when method was never called", () => {
    const mock = mockService<TestService>();

    expect(() => assertCalled(mock, "getUser")).toThrow(/Expected getUser to be called/);
  });

  it("should check arguments when provided", () => {
    const mock = mockService<TestService>();
    mock.getUser("123");

    expect(() => assertCalled(mock, "getUser", ["123"])).not.toThrow();
    expect(() => assertCalled(mock, "getUser", ["456"])).toThrow(/Expected getUser to be called with/);
  });
});

describe("assertNotCalled", () => {
  it("should pass when method was never called", () => {
    const mock = mockService<TestService>();

    expect(() => assertNotCalled(mock, "getUser")).not.toThrow();
  });

  it("should fail when method was called", () => {
    const mock = mockService<TestService>();
    mock.getUser("123");

    expect(() => assertNotCalled(mock, "getUser")).toThrow(/Expected getUser to not be called/);
  });
});

describe("assertCalledTimes", () => {
  it("should pass when call count matches", () => {
    const mock = mockService<TestService>();
    mock.getUser("1");
    mock.getUser("2");
    mock.getUser("3");

    expect(() => assertCalledTimes(mock, "getUser", 3)).not.toThrow();
  });

  it("should fail when call count does not match", () => {
    const mock = mockService<TestService>();
    mock.getUser("1");
    mock.getUser("2");

    expect(() => assertCalledTimes(mock, "getUser", 3)).toThrow(/Expected getUser to be called 3/);
  });
});

describe("exports from main index", () => {
  it("should export all testing utilities", async () => {
    const index = await import("../src/index.js");

    expect(index.mockService).toBeDefined();
    expect(index.testLayer).toBeDefined();
    expect(index.combineLayers).toBeDefined();
    expect(index.succeedMock).toBeDefined();
    expect(index.failMock).toBeDefined();
    expect(index.dieMock).toBeDefined();
    expect(index.assertCalled).toBeDefined();
    expect(index.assertNotCalled).toBeDefined();
    expect(index.assertCalledTimes).toBeDefined();
  });
});
