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

const resolveProviderErrors = vi.fn(() => ({
  unauthorized: vi.fn((payload) => {
    throw Object.assign(new Error("unauthorized"), { payload });
  }),
}));

describe("createPermissionGuardMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips internal origins", async () => {
    const middleware = createPermissionGuardMiddleware({
      ensurePermission: vi.fn(),
      isInternalOrigin: () => true,
      resolveMethodDefinition: vi.fn(),
      resolveProviderErrors,
    });

    await expect(
      runMiddleware(middleware, { origin: "chrome-extension://arx", method: "eth_accounts" }),
    ).resolves.toBeUndefined();
  });

  it("allows methods without definition or scope", async () => {
    const middleware = createPermissionGuardMiddleware({
      ensurePermission: vi.fn(),
      isInternalOrigin: () => false,
      resolveMethodDefinition: vi.fn(() => undefined),
      resolveProviderErrors,
    });

    await expect(runMiddleware(middleware, { origin: UNKNOWN_ORIGIN, method: "eth_chainId" })).resolves.toBeUndefined();
  });

  it("enforces permission when scope is present", async () => {
    const ensurePermission = vi.fn(() => Promise.reject(new Error("denied")));
    const middleware = createPermissionGuardMiddleware({
      ensurePermission,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      resolveProviderErrors,
    });

    await expect(runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts" })).rejects.toThrow(
      "unauthorized",
    );
    expect(ensurePermission).toHaveBeenCalledWith("https://dapp.example", "eth_accounts", undefined);
  });
  it("skips permission check for scoped bootstrap methods", async () => {
    const ensurePermission = vi.fn(() => Promise.reject(new Error("should not run")));
    const middleware = createPermissionGuardMiddleware({
      ensurePermission,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn(), isBootstrap: true }),
      resolveProviderErrors,
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_requestAccounts" }),
    ).resolves.toBeUndefined();
    expect(ensurePermission).not.toHaveBeenCalled();
  });
  it("passes rpcContext to ensurePermission", async () => {
    const ensurePermission = vi.fn(() => Promise.reject(new Error("denied")));
    const rpcContext: RpcInvocationContext = { namespace: "eip155", chainRef: "eip155:1" };
    const middleware = createPermissionGuardMiddleware({
      ensurePermission,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      resolveProviderErrors,
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts", context: rpcContext }),
    ).rejects.toThrow("unauthorized");
    expect(ensurePermission).toHaveBeenCalledWith("https://dapp.example", "eth_accounts", rpcContext);
  });
  it("allows requests when ensurePermission succeeds", async () => {
    const ensurePermission = vi.fn(() => Promise.resolve());
    const middleware = createPermissionGuardMiddleware({
      ensurePermission,
      isInternalOrigin: () => false,
      resolveMethodDefinition: () => ({ scope: "wallet_accounts", handler: vi.fn() }),
      resolveProviderErrors,
    });

    await expect(
      runMiddleware(middleware, { origin: "https://dapp.example", method: "eth_accounts" }),
    ).resolves.toBeUndefined();
    expect(ensurePermission).toHaveBeenCalled();
  });
});
