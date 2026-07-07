import { describe, expect, it } from "vitest";
import { RpcUnsupportedMethodError } from "../rpc/errors.js";
import { createMethodApiProxy, createMethodExecutor, type MethodHandlerTree } from "./methods.js";

describe("method executor", () => {
  it("dispatches a method path", async () => {
    type TestApi = {
      sample: {
        echo(input: { value: string }): Promise<string>;
      };
    };
    const prefix = "invoke";
    const handlers = {
      sample: {
        echo: (input: { value: string }) => `${prefix}:${input.value}`,
      },
    } as const satisfies MethodHandlerTree<TestApi>;
    const executor = createMethodExecutor({
      handlers,
    });

    await expect(executor.executePath("sample.echo", { value: "status" })).resolves.toBe("invoke:status");
  });

  it("rejects unsupported paths", async () => {
    type TestApi = {
      setup: {
        getStatus(): Promise<{ availability: "uninitialized" }>;
      };
    };
    const handlers = {
      setup: {
        getStatus: () => ({ availability: "uninitialized" as const }),
      },
    } as const satisfies MethodHandlerTree<TestApi>;
    const executor = createMethodExecutor({
      handlers,
    });

    await expect(executor.executePath("setup.missing", undefined)).rejects.toThrow(RpcUnsupportedMethodError);
  });

  it("creates a typed method API proxy", async () => {
    type TestApi = {
      sample: {
        echo(input: { value: string }): Promise<string>;
      };
    };
    const api = createMethodApiProxy<TestApi>(async (path, input) => {
      expect(path).toBe("sample.echo");
      expect(input).toEqual({ value: "status" });
      return "invoke:status";
    });

    await expect(api.sample.echo({ value: "status" })).resolves.toBe("invoke:status");
  });
});
