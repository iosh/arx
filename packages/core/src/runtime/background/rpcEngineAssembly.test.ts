import { JsonRpcEngine } from "@metamask/json-rpc-engine";
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
import { createBackgroundRuntime } from "../createBackgroundRuntime.js";
import { createBackgroundRpcMiddlewares, createRpcEngineForBackground } from "./rpcEngineAssembly.js";

const _createNextStub = () =>
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
    const runtime = createBackgroundRuntime({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      rpcEngine: { env: { isInternalOrigin: () => false }, assemble: false },
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

    const pushSpy = vi.spyOn(runtime.rpc.engine, "push");

    createRpcEngineForBackground(runtime, {
      isInternalOrigin: () => false,
    });

    // Should push 5 middlewares: errorBoundary, requireInitialized, invocationContext, accessPolicyGuard, executor
    expect(pushSpy).toHaveBeenCalledTimes(5);

    createRpcEngineForBackground(runtime, {
      isInternalOrigin: () => false,
    });

    // Repeated call should not push again (idempotency via symbol flag)
    expect(pushSpy).toHaveBeenCalledTimes(5);
  });

  it("encodes existing res.error (error boundary)", async () => {
    const runtime = createBackgroundRuntime({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      rpcEngine: { env: { isInternalOrigin: () => false }, assemble: false },
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

    const middlewares = createBackgroundRpcMiddlewares(runtime, {
      isInternalOrigin: () => false,
    });
    const errorBoundary = middlewares[0];
    if (!errorBoundary) throw new Error("Expected errorBoundary middleware");
    const chainRef = runtime.controllers.network.getActiveChain().chainRef;

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
    const runtime = createBackgroundRuntime({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      rpcEngine: { env: { isInternalOrigin: () => false }, assemble: false },
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

    const attentionSpy = vi.spyOn(runtime.services.attention, "requestAttention");

    const middlewares = createBackgroundRpcMiddlewares(runtime, {
      isInternalOrigin: () => false,
      shouldRequestUnlockAttention: () => false,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const engine = new JsonRpcEngine();
    for (const middleware of middlewares.slice(0, 4)) {
      engine.push(middleware);
    }
    engine.push((_req, _res, _next, end) => end());

    const chainRef = runtime.controllers.network.getActiveChain().chainRef;
    await expect(
      new Promise<void>((resolve, reject) => {
        engine.handle(
          {
            id: 1,
            jsonrpc: "2.0",
            method: "eth_newFilter",
            origin: "https://dapp.example",
            arx: { namespace: "eip155", chainRef },
          },
          (error) => {
            if (!error) {
              reject(new Error("Expected error"));
              return;
            }
            resolve();
          },
        );
      }),
    ).resolves.toBeUndefined();

    expect(attentionSpy).not.toHaveBeenCalled();
  });
});
