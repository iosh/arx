import { describe, expect, it } from "vitest";
import { RpcUnsupportedMethodError } from "../rpc/errors.js";
import { createWalletMethodExecutor, type WalletMethodHandlerTree } from "./executor.js";

describe("wallet method executor", () => {
  it("dispatches a trusted wallet method path", async () => {
    type TestApi = {
      sample: {
        echo(input: { value: string }): Promise<string>;
      };
    };
    type TestContext = { prefix: string };
    const handlers = {
      sample: {
        echo: (context: TestContext, input: { value: string }) => `${context.prefix}:${input.value}`,
      },
    } as const satisfies WalletMethodHandlerTree<TestContext, TestApi>;
    const executor = createWalletMethodExecutor({
      context: { prefix: "wallet" },
      handlers,
    });

    await expect(executor.executeUnknownPath("sample.echo", { value: "status" })).resolves.toBe("wallet:status");
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
    } as const satisfies WalletMethodHandlerTree<undefined, TestApi>;
    const executor = createWalletMethodExecutor({
      context: undefined,
      handlers,
    });

    await expect(executor.executeUnknownPath("setup.missing", undefined)).rejects.toThrow(RpcUnsupportedMethodError);
  });
});
