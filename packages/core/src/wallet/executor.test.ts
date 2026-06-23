import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RpcInvalidParamsError, RpcUnsupportedMethodError } from "../rpc/errors.js";
import { WalletOperationBindingInvariantError } from "./errors.js";
import { createWalletOperationExecutor, type WalletOperationHandlerTree } from "./executor.js";
import { defineWalletOperation, type WalletOperations } from "./operation.js";

describe("wallet operation executor", () => {
  it("executes a validated wallet operation path", async () => {
    const operations = {
      sample: {
        echo: defineWalletOperation({
          input: z.strictObject({ value: z.string().min(1) }),
        }),
      },
    } as const satisfies WalletOperations;
    type TestContext = { prefix: string };
    const handlers = {
      sample: {
        echo: (context: TestContext, input: { value: string }) => `${context.prefix}:${input.value}`,
      },
    } as const satisfies WalletOperationHandlerTree<TestContext, typeof operations>;
    const executor = createWalletOperationExecutor({
      context: { prefix: "wallet" },
      operations,
      handlers,
    });

    await expect(executor.executePath("sample.echo", { value: "status" })).resolves.toBe("wallet:status");
  });

  it("rejects invalid params and unsupported paths", async () => {
    const operations = {
      setup: {
        getStatus: defineWalletOperation({ input: z.undefined() }),
      },
    } as const satisfies WalletOperations;
    const handlers = {
      setup: {
        getStatus: () => ({ availability: "uninitialized" }),
      },
    } as const satisfies WalletOperationHandlerTree<undefined, typeof operations>;
    const executor = createWalletOperationExecutor({
      context: undefined,
      operations,
      handlers,
    });

    await expect(executor.executeUnknownPath("setup.getStatus", {})).rejects.toThrow(RpcInvalidParamsError);
    await expect(executor.executeUnknownPath("setup.missing", undefined)).rejects.toThrow(RpcUnsupportedMethodError);
  });
});
