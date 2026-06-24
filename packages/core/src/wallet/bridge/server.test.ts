import { describe, expect, it } from "vitest";
import { RpcInternalError, RpcUnsupportedMethodError } from "../../rpc/errors.js";
import { createWalletMethodExecutor, type WalletMethodHandlerTree } from "../executor.js";
import { createWalletBridgeServer } from "./server.js";

const createTestServer = () => {
  type TestApi = {
    setup: {
      getStatus(): Promise<{ availability: "uninitialized" }>;
    };
    session: {
      unlock(input: { password: string }): Promise<{ status: "unlocked"; passwordLength: number }>;
    };
  };

  const handlers = {
    setup: {
      getStatus: () => ({ availability: "uninitialized" as const }),
    },
    session: {
      unlock: (_context, input) => ({ status: "unlocked" as const, passwordLength: input.password.length }),
    },
  } as const satisfies WalletMethodHandlerTree<undefined, TestApi>;

  const executor = createWalletMethodExecutor({
    context: undefined,
    handlers,
  });

  return createWalletBridgeServer({ executor });
};

describe("wallet bridge server", () => {
  it("handles valid requests through the wallet method executor", async () => {
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

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-2",
        path: "session.unlock",
        input: { password: "secret" },
      }),
    ).resolves.toEqual({
      type: "wallet:response",
      version: 1,
      id: "request-2",
      result: { status: "unlocked", passwordLength: 6 },
    });
  });

  it("encodes unsupported paths as bridge errors", async () => {
    const server = createTestServer();

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.missing",
      }),
    ).resolves.toMatchObject({
      type: "wallet:error",
      id: "request-1",
      error: { code: RpcUnsupportedMethodError.code },
    });
  });

  it("encodes unexpected errors as internal bridge errors", async () => {
    const server = createWalletBridgeServer({
      executor: {
        executeUnknownPath: async () => {
          throw new Error("raw internal failure");
        },
      },
    });

    await expect(
      server.handleRequest({
        type: "wallet:request",
        version: 1,
        id: "request-1",
        path: "setup.getStatus",
      }),
    ).resolves.toMatchObject({
      type: "wallet:error",
      id: "request-1",
      error: {
        code: RpcInternalError.code,
        message: "Internal error.",
      },
    });
  });
});
