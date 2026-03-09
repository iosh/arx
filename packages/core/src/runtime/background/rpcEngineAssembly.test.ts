import { ArxReasons, arxError } from "@arx/errors";
import { JsonRpcEngine } from "@metamask/json-rpc-engine";
import type { Json, PendingJsonRpcResponse } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
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

type PendingResWithUnknownError = Omit<PendingJsonRpcResponse<Json>, "error"> & { error?: unknown };

describe("background rpc engine assembly", () => {
  it("assembles engine only once (symbol idempotency)", () => {
    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: new MemoryChainDefinitionsPort() },
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
      chainDefinitions: { port: new MemoryChainDefinitionsPort() },
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
    const chainRef = runtime.controllers.network.getState().activeChainRef;

    const req = {
      method: "eth_chainId",
      origin: "https://dapp.example",
      arx: { namespace: "eip155", chainRef },
    } as unknown as Parameters<typeof errorBoundary>[0];

    const res = createPendingRes() as unknown as PendingResWithUnknownError;
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
    expect(typeof res?.error?.code).toBe("number");
    expect(typeof res?.error?.message).toBe("string");
  });

  it("does not consult global active chain when namespace cannot be inferred", async () => {
    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: new MemoryChainDefinitionsPort() },
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

    const getStateSpy = vi.spyOn(runtime.controllers.network, "getState");

    const middlewares = createBackgroundRpcMiddlewares(runtime, {
      isInternalOrigin: () => false,
    });
    const errorBoundary = middlewares[0];
    if (!errorBoundary) throw new Error("Expected errorBoundary middleware");

    const req = {
      method: "custom_ping",
      origin: "https://dapp.example",
    } as unknown as Parameters<typeof errorBoundary>[0];

    const res = createPendingRes() as unknown as PendingResWithUnknownError;
    const next = createNextStubWithSideEffect(() => {
      res.error = arxError({ reason: ArxReasons.RpcInvalidRequest, message: "Missing namespace context" });
    });

    await errorBoundary(
      req,
      res,
      next as unknown as Parameters<typeof errorBoundary>[2],
      vi.fn() as unknown as Parameters<typeof errorBoundary>[3],
    );

    expect(getStateSpy).not.toHaveBeenCalled();
    expect(res.error).toBeTruthy();
    expect(typeof res?.error?.code).toBe("number");
    expect(typeof res?.error?.message).toBe("string");
  });

  it("uses provider binding for best-effort namespace encoding when explicit namespace is absent", async () => {
    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: new MemoryChainDefinitionsPort() },
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

    const encodeSpy = vi.spyOn(runtime.rpc.registry, "encodeErrorWithAdapters");
    const middlewares = createBackgroundRpcMiddlewares(runtime, {
      isInternalOrigin: () => false,
    });
    const errorBoundary = middlewares[0];
    if (!errorBoundary) throw new Error("Expected errorBoundary middleware");

    const req = {
      method: "custom_ping",
      origin: "https://dapp.example",
      arx: { providerNamespace: "eip155" },
    } as unknown as Parameters<typeof errorBoundary>[0];

    const res = createPendingRes() as unknown as PendingResWithUnknownError;
    const next = createNextStubWithSideEffect(() => {
      res.error = new Error("boom");
    });

    await errorBoundary(
      req,
      res,
      next as unknown as Parameters<typeof errorBoundary>[2],
      vi.fn() as unknown as Parameters<typeof errorBoundary>[3],
    );

    expect(encodeSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        namespace: "eip155",
        chainRef: "eip155:1",
        method: "custom_ping",
      }),
    );
  });

  it("respects shouldRequestUnlockAttention hook", async () => {
    const runtime = createBackgroundRuntime({
      chainDefinitions: { port: new MemoryChainDefinitionsPort() },
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

    const chainRef = runtime.controllers.network.getState().activeChainRef;
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
