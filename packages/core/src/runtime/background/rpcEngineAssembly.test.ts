import type { Json, PendingJsonRpcResponse } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import type { VaultCiphertext, VaultService } from "../../vault/types.js";
import {
  MemoryAccountsPort,
  MemoryApprovalsPort,
  MemoryChainRegistryPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
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
const createUnlockedVault = (): VaultService => {
  const encoder = new TextEncoder();
  const secret = encoder.encode(JSON.stringify({ keyrings: [] }));

  const ciphertext: VaultCiphertext = {
    version: 1,
    algorithm: "pbkdf2-sha256",
    salt: "salt-base64",
    iterations: 1,
    iv: "iv-base64",
    cipher: "cipher-1",
    createdAt: Date.now(),
  };

  return {
    async initialize() {
      return ciphertext;
    },
    async unlock() {
      return new Uint8Array(secret);
    },
    lock() {},
    exportKey() {
      return new Uint8Array(secret);
    },
    async seal() {
      return ciphertext;
    },
    async reseal() {
      return ciphertext;
    },
    importCiphertext() {},
    async verifyPassword() {},
    getCiphertext() {
      return ciphertext;
    },
    getStatus() {
      return { isUnlocked: true, hasCiphertext: true };
    },
    isUnlocked() {
      return true;
    },
  };
};

describe("background rpc engine assembly", () => {
  it("assembles engine only once (symbol idempotency)", () => {
    const services = createBackgroundServices({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      store: {
        ports: {
          approvals: new MemoryApprovalsPort(),
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

    // Should push 5 middlewares: resolveInvocation, errorBoundary, lockedGuard, permissionGuard, executor
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
      store: {
        ports: {
          approvals: new MemoryApprovalsPort(),
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
    const errorBoundary = middlewares[1]!;
    const chainRef = services.controllers.network.getActiveChain().chainRef;

    const req = {
      method: "eth_chainId",
      origin: "https://dapp.example",
      arx: { namespace: "eip155", chainRef },
    } as any;

    const res = createPendingRes() as any;
    const next = createNextStubWithSideEffect(() => {
      res.error = new Error("boom");
    });

    await errorBoundary(req, res, next as any, vi.fn() as any);

    expect(res.error).toBeTruthy();
    expect(res.error).not.toBeInstanceOf(Error);
    expect(typeof res.error.code).toBe("number");
    expect(typeof res.error.message).toBe("string");
  });

  it("respects shouldRequestUnlockAttention hook", async () => {
    const services = createBackgroundServices({
      chainRegistry: { port: new MemoryChainRegistryPort() },
      networkPreferences: { port: new MemoryNetworkPreferencesPort() },
      store: {
        ports: {
          approvals: new MemoryApprovalsPort(),
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
    const lockedGuard = middlewares[2]!;

    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const req = {
      method: "wallet_switchEthereumChain",
      origin: "https://dapp.example",
      arx: { namespace: "eip155", chainRef },
    } as any;

    const res = createPendingRes();
    const end = vi.fn();

    await lockedGuard(req, res as any, createNextStub() as any, end as any);
    expect(end).toHaveBeenCalledTimes(1);
    const [error] = end.mock.calls[0] ?? [];
    expect(error).toBeTruthy();
    expect(attentionSpy).not.toHaveBeenCalled();
  });
});
