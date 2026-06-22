import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RpcInvalidParamsError, RpcUnsupportedMethodError } from "../rpc/errors.js";
import { createWalletOperationExecutor, type WalletOperationHandlerTree } from "./executor.js";
import { defineWalletOperation, type WalletOperationDescriptorTree } from "./operation.js";

describe("wallet operation executor", () => {
  it("executes a validated wallet operation path", () => {
    const operations = {
      sample: {
        echo: defineWalletOperation({
          input: z.strictObject({ value: z.string().min(1) }),
        }),
      },
    } as const satisfies WalletOperationDescriptorTree;
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

    expect(executor.executePath("sample.echo", { value: "status" })).toBe("wallet:status");
  });

  it("rejects invalid params and unsupported paths", () => {
    const operations = {
      setup: {
        getStatus: defineWalletOperation({ input: z.undefined() }),
      },
    } as const satisfies WalletOperationDescriptorTree;
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

    expect(() => executor.executeUnknownPath("setup.getStatus", {})).toThrow(RpcInvalidParamsError);
    expect(() => executor.executeUnknownPath("setup.missing", undefined)).toThrow(RpcUnsupportedMethodError);
  });
});
