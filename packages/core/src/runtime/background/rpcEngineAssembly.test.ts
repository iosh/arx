import type { Json, PendingJsonRpcResponse } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryAccountsPort,
  MemoryChainRegistryPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
} from "../__fixtures__/backgroundTestSetup.js";
import { createBackgroundServices } from "../createBackgroundServices.js";
import { createBackgroundRpcMiddlewares, createRpcEngineForBackground } from "./rpcEngineAssembly.js";

const createNextStub = () =>
  vi.fn<(returnHandler?: (runReturnHandlers: (error?: unknown) => void) => void) => Promise<void>>((returnHandler) => {
    if (returnHandler) {
      returnHandler((error) => {
        if (error) throw error;
      });
    }
    return Promise.resolve();
  });

const createNextStubWithSideEffect = (sideEffect: () => void) =>
  vi.fn<(returnHandler?: (runReturnHandlers: (error?: unknown) => void) => void) => Promise<void>>((returnHandler) => {
    sideEffect();
    if (returnHandler) {
      returnHandler((error) => {
        if (error) throw error;
      });
    }
    return Promise.resolve();
  });

const createPendingRes = (): PendingJsonRpcResponse<Json> => ({
  id: "1",
  jsonrpc: "2.0",
});

describe("background rpc engine assembly", () => {
  it("assembles engine only once (symbol idempotency)", () => {
    const services = createBackgroundServices({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
      store: {
        ports: {
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
          permissions: new MemoryPermissionsPort(),
        },
      },
    });

    const pushSpy = vi.spyOn(services.engine, "push");

    createRpcEngineForBackground(services, {
      isInternalOrigin: () => false,
    });

    // Should push 5 middlewares: errorBoundary, resolveInvocation, lockedGuard, permissionGuard, executor
    expect(pushSpy).toHaveBeenCalledTimes(5);

    createRpcEngineForBackground(services, {
      isInternalOrigin: () => false,
    });

    // Repeated call should not push again (idempotency via symbol flag)
    expect(pushSpy).toHaveBeenCalledTimes(5);
  });

  it("encodes existing res.error (error boundary)", async () => {
    const services = createBackgroundServices({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
      store: {
        ports: {
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
          permissions: new MemoryPermissionsPort(),
        },
      },
    });

    const middlewares = createBackgroundRpcMiddlewares(services, {
      isInternalOrigin: () => false,
    });
    const errorBoundary = middlewares[0];
    if (!errorBoundary) throw new Error("Expected errorBoundary middleware");
    const chainRef = services.controllers.network.getActiveChain().chainRef;

    const req = {
      method: "eth_chainId",
      origin: "https://dapp.example",
      arx: { namespace: "eip155", chainRef },
    } as unknown as Parameters<typeof errorBoundary>[0];

    const res = createPendingRes() as unknown as PendingJsonRpcResponse<Json> & { error?: unknown };
    const next = createNextStubWithSideEffect(() => {
      res.error = new Error("boom");
    });

    await errorBoundary(
      req,
      res,
      next as unknown as Parameters<typeof errorBoundary>[2],
      vi.fn() as unknown as Parameters<typeof errorBoundary>[3],
    );

    expect(res.error).toBeTruthy();
    expect(res.error).not.toBeInstanceOf(Error);
    expect(typeof res.error.code).toBe("number");
    expect(typeof res.error.message).toBe("string");
  });

  it("respects shouldRequestUnlockAttention hook", async () => {
    const services = createBackgroundServices({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
      store: {
        ports: {
          transactions: new MemoryTransactionsPort(),
          accounts: new MemoryAccountsPort(),
          keyringMetas: new MemoryKeyringMetasPort(),
          permissions: new MemoryPermissionsPort(),
        },
      },
    });

    const attentionSpy = vi.spyOn(services.attention, "requestAttention");

    const middlewares = createBackgroundRpcMiddlewares(services, {
      isInternalOrigin: () => false,
      shouldRequestUnlockAttention: () => false,
    });
    const lockedGuard = middlewares[2];
    if (!lockedGuard) throw new Error("Expected lockedGuard middleware");

    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const req = {
      method: "eth_newFilter",
      origin: "https://dapp.example",
      arx: { namespace: "eip155", chainRef },
    } as unknown as Parameters<typeof lockedGuard>[0];

    const res = createPendingRes();
    const end = vi.fn();

    await lockedGuard(
      req,
      res,
      createNextStub() as unknown as Parameters<typeof lockedGuard>[2],
      end as unknown as Parameters<typeof lockedGuard>[3],
    );
    expect(end).toHaveBeenCalledTimes(1);
    const [error] = end.mock.calls[0] ?? [];
    expect(error).toBeTruthy();
    expect(attentionSpy).not.toHaveBeenCalled();
  });
});
