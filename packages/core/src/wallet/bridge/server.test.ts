import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RpcInvalidParamsError, RpcUnsupportedMethodError } from "../../rpc/errors.js";
import { createWalletOperationExecutor, type WalletOperationHandlerTree } from "../executor.js";
import { defineWalletOperation, type WalletOperationDescriptorTree } from "../operation.js";
import { createWalletBridgeServer } from "./server.js";

const createTestServer = () => {
  const operations = {
    setup: {
      getStatus: defineWalletOperation({ input: z.undefined() }),
    },
  } as const satisfies WalletOperationDescriptorTree;

  const handlers = {
    setup: {
      getStatus: () => ({ availability: "uninitialized" as const }),
    },
  } as const satisfies WalletOperationHandlerTree<undefined, typeof operations>;

  const executor = createWalletOperationExecutor({
    context: undefined,
    operations,
    handlers,
  });

  return createWalletBridgeServer({ executor });
};

describe("wallet bridge server", () => {
  it("handles valid requests through the wallet operation executor", async () => {
    const server = createTestServer();

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.getStatus",
      }),
    ).resolves.toEqual({
      type: "wallet:response",
      version: 1,
      id: "request-1",
      result: { availability: "uninitialized" },
    });
  });

  it("encodes invalid params and unsupported paths as bridge errors", async () => {
    const server = createTestServer();

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.getStatus",
        input: {},
      }),
    ).resolves.toMatchObject({
      type: "wallet:error",
      id: "request-1",
      error: { code: RpcInvalidParamsError.code },
    });

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-2",
        path: "setup.missing",
      }),
    ).resolves.toMatchObject({
      type: "wallet:error",
      id: "request-2",
      error: { code: RpcUnsupportedMethodError.code },
    });
  });
});
