import { ArxReasons } from "@arx/errors";
import { JsonRpcEngine } from "@metamask/json-rpc-engine";
import type { JsonRpcParams } from "@metamask/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";
import { createPermissionGuardMiddleware } from "./permissionGuard.js";

const runMiddleware = async (
  middleware: ReturnType<typeof createPermissionGuardMiddleware>,
  {
    origin,
    method,
    params,
    context,
  }: { origin?: string; method: string; params?: JsonRpcParams; context?: RpcInvocationContext },
) => {
  const engine = new JsonRpcEngine();

  engine.push(middleware);
  engine.push((_req, res, _next, end) => {
    res.result = null;
    end();
  });

  return new Promise<void>((resolve, reject) => {
    engine.handle({ id: 1, jsonrpc: "2.0", method, params, origin, arx: context } as any, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe("createPermissionGuardMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips internal origins", async () => {
    const middleware = createPermissionGuardMiddleware({
      assertPermission: vi.fn(),
      isInternalOrigin: () => true,
      findMethodDefinition: vi.fn(),
      isConnected: vi.fn(() => false),
    });

    await expect(
      runMiddleware(middleware, { origin: "chrome-extension://arx", method: "eth_accounts" }),
    ).resolves.toBeUndefined();
  });

  it("allows methods without definition or scope", async () => {
    const middleware = createPermissionGuardMiddleware({
      assertPermission: vi.fn(),
      isInternalOrigin: () => false,
      findMethodDefinition: vi.fn(() => undefined),
      isConnected: vi.fn(() => false),
    });

    await expect(runMiddleware(middleware, { origin: UNKNOWN_ORIGIN, method: "eth_chainId" })).resolves.toBeUndefined();
  });

  it("allows methods with definition but without permission check", async () => {
    const assertPermission = vi.fn(() => Promise.reject(new Error("should not run")));
    const middleware = createPermissionGuardMiddleware({
      assertPermission,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ handler: vi.fn(), permissionCheck: "none" }),
      isConnected: vi.fn(() => false),
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts" }),
    ).resolves.toBeUndefined();
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("enforces permission when scope is present", async () => {
    const assertPermission = vi.fn(() => Promise.reject(new Error("denied")));
    const middleware = createPermissionGuardMiddleware({
      assertPermission,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      isConnected: vi.fn(() => false),
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts" }),
    ).rejects.toMatchObject({
      reason: ArxReasons.PermissionDenied,
    });
    expect(assertPermission).toHaveBeenCalledWith("https://dapp.example", "eth_accounts", undefined);
  });

  it("enforces connected check when permissionCheck is connected", async () => {
    const isConnected = vi.fn(() => false);
    const middleware = createPermissionGuardMiddleware({
      assertPermission: vi.fn(),
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: "wallet_sign", handler: vi.fn(), permissionCheck: "connected" }),
      isConnected,
    });

    const rpcContext: RpcInvocationContext = { namespace: "eip155", chainRef: "eip155:1" };
    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "personal_sign", context: rpcContext }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionNotConnected });
    expect(isConnected).toHaveBeenCalled();
  });

  it("allows connected requests when permissionCheck is connected", async () => {
    const isConnected = vi.fn(() => true);
    const middleware = createPermissionGuardMiddleware({
      assertPermission: vi.fn(),
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: "wallet_sign", handler: vi.fn(), permissionCheck: "connected" }),
      isConnected,
    });

    const rpcContext: RpcInvocationContext = { namespace: "eip155", chainRef: "eip155:1" };
    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "personal_sign", context: rpcContext }),
    ).resolves.toBeUndefined();
    expect(isConnected).toHaveBeenCalled();
  });

  it("passes rpcContext to assertPermission", async () => {
    const assertPermission = vi.fn(() => Promise.reject(new Error("denied")));
    const rpcContext: RpcInvocationContext = { namespace: "eip155", chainRef: "eip155:1" };
    const middleware = createPermissionGuardMiddleware({
      assertPermission,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      isConnected: vi.fn(() => false),
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts", context: rpcContext }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionDenied });
    expect(assertPermission).toHaveBeenCalledWith("https://dapp.example", "eth_accounts", rpcContext);
  });
  it("allows requests when assertPermission succeeds", async () => {
    const assertPermission = vi.fn(() => Promise.resolve());
    const middleware = createPermissionGuardMiddleware({
      assertPermission,
      isInternalOrigin: () => false,
      findMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      isConnected: vi.fn(() => false),
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts" }),
    ).resolves.toBeUndefined();
    expect(assertPermission).toHaveBeenCalled();
  });
});
