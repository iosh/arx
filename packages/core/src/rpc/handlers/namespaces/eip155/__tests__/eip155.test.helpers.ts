import type { ChainRef } from "../../../../../chains/ids.js";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import { type ApprovalTask, ApprovalTypes } from "../../../../../controllers/index.js";
import {
  FakeVault,
  MemoryAccountsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
} from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "../../../../../runtime/createBackgroundRuntime.js";

// Shared test constants
export const ORIGIN = "https://dapp.example";

export const ALT_CHAIN = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" as const }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

export const ADD_CHAIN_PARAMS = {
  chainId: "0x2105",
  chainName: "Base Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export const ADDED_CHAIN_REF = "eip155:8453";

export const TEST_MNEMONIC = "test test test test test test test test test test test junk";

// Helper to flush async operations
export const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

// Create mock chain registry port
export const createChainRegistryPort = () => ({
  async get() {
    return null;
  },
  async getAll() {
    return [];
  },
  async put() {},
  async putMany() {},
  async delete() {},
  async clear() {},
});

// Create test services with optional overrides
export const createRuntime = (overrides?: Partial<Parameters<typeof createBackgroundRuntime>[0]>) => {
  const { chainRegistry, session, networkPreferences, rpcEngine, ...rest } = overrides ?? {};
  const runtime = createBackgroundRuntime({
    chainRegistry: {
      port: createChainRegistryPort(),
      ...(chainRegistry ?? {}),
    },
    rpcEngine:
      rpcEngine ??
      ({
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      } as const),
    networkPreferences: networkPreferences ?? { port: new MemoryNetworkPreferencesPort() },
    settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    store: {
      ports: {
        permissions: new MemoryPermissionsPort(),
        transactions: new MemoryTransactionsPort(),
        accounts: new MemoryAccountsPort(),
        keyringMetas: new MemoryKeyringMetasPort(),
      },
    },
    // Use FakeVault by default to avoid encryption overhead and warnings
    session: {
      vault: new FakeVault(() => Date.now()),
      ...(session ?? {}),
    },
    ...rest,
  });

  return runtime;
};

// Create method executor from services
export const createExecutor = (runtime: ReturnType<typeof createRuntime>) => {
  const execute = runtime.rpc.registry.createMethodExecutor(runtime.controllers, {
    rpcClientRegistry: runtime.rpc.clients,
  });
  return async (args: Parameters<typeof execute>[0]) => {
    const chainRef = args.context?.chainRef ?? runtime.controllers.network.getActiveChain().chainRef;
    const ctx = args.context ?? {};
    const context = {
      ...ctx,
      requestContext:
        ctx.requestContext ??
        ({
          transport: "provider",
          portId: "test-port",
          sessionId: crypto.randomUUID(),
          requestId: "test-request",
          origin: args.origin,
        } as const),
    };
    const result = await runtime.rpc.registry.executeWithAdapters(
      {
        surface: "dapp",
        namespace: "eip155",
        chainRef,
        origin: args.origin,
        method: args.request.method,
      },
      () => execute({ ...args, context }),
    );
    if (result.ok) return result.result;
    throw result.error;
  };
};

export const waitForChainInNetwork = async (
  runtime: ReturnType<typeof createRuntime>,
  chainRef: ChainRef,
  timeoutMs = 5000,
): Promise<ChainMetadata> => {
  const existing = runtime.controllers.network.getChain(chainRef);
  if (existing) {
    return existing;
  }

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const tryResolve = () => {
      const chain = runtime.controllers.network.getChain(chainRef);
      if (chain) {
        cleanup();
        resolve(chain);
      }
    };

    // Set timeout protection
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for chain ${chainRef} in network controller`));
    }, timeoutMs);

    unsubscribe = runtime.controllers.network.onStateChanged(() => {
      tryResolve();
    });

    tryResolve();
  });
};

export const setupApprovalResponder = (
  runtime: ReturnType<typeof createRuntime>,
  responder: (task: ApprovalTask) => Promise<boolean | undefined> | boolean | undefined,
) => {
  const unsubscribe = runtime.controllers.approvals.onRequest(({ task }) => {
    void (async () => {
      try {
        // Wait a microtask to let requestApproval() complete its setup
        await Promise.resolve();

        await responder(task);
        // If responder didn't handle the task (returned false or undefined), do nothing.
        // This matches real system behavior where unhandled approvals stay pending.
      } catch (error) {
        // Responder threw an error (e.g., assertion failure).
        // Reject the approval with this error to fail the test immediately
        // instead of letting it timeout.
        console.error("[setupApprovalResponder] Responder error:", error);
        if (runtime.controllers.approvals.has(task.id)) {
          runtime.controllers.approvals.reject(
            task.id,
            new Error("setupApprovalResponder: responder did not resolve/reject task"),
          );
        }
      }
    })();
  });

  return unsubscribe;
};

export const setupSwitchChainApprovalResponder = (runtime: ReturnType<typeof createRuntime>) => {
  return setupApprovalResponder(runtime, async (task) => {
    if (task.type !== ApprovalTypes.SwitchChain) {
      return false;
    }

    const payload = task.payload as { chainRef?: string };
    const chainRef = payload.chainRef ?? task.chainRef;
    if (!chainRef) {
      throw new Error("Switch chain approval is missing chainRef");
    }

    await runtime.controllers.approvals.resolve(task.id, async () => {
      await runtime.controllers.network.switchChain(chainRef);
      await runtime.controllers.networkPreferences.setActiveChainRef(
        chainRef as Parameters<typeof runtime.controllers.networkPreferences.setActiveChainRef>[0],
      );
      return null;
    });

    return true;
  });
};
