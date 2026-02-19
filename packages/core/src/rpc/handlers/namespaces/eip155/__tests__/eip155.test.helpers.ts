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
import { createBackgroundServices } from "../../../../../runtime/createBackgroundServices.js";

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
export const createServices = (overrides?: Partial<Parameters<typeof createBackgroundServices>[0]>) => {
  const { chainRegistry, session, networkPreferences, ...rest } = overrides ?? {};
  return createBackgroundServices({
    chainRegistry: {
      port: createChainRegistryPort(),
      ...(chainRegistry ?? {}),
    },
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
};

// Create method executor from services
export const createExecutor = (services: ReturnType<typeof createServices>) => {
  const execute = services.rpcRegistry.createMethodExecutor(services.controllers, {
    rpcClientRegistry: services.rpcClients,
  });
  return async (args: Parameters<typeof execute>[0]) => {
    const chainRef = args.context?.chainRef ?? services.controllers.network.getActiveChain().chainRef;
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
    const result = await services.rpcRegistry.executeWithAdapters(
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
  services: ReturnType<typeof createServices>,
  chainRef: ChainRef,
  timeoutMs = 5000,
): Promise<ChainMetadata> => {
  const existing = services.controllers.network.getChain(chainRef);
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
      const chain = services.controllers.network.getChain(chainRef);
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

    unsubscribe = services.controllers.network.onStateChanged(() => {
      tryResolve();
    });

    tryResolve();
  });
};

export const setupApprovalResponder = (
  services: ReturnType<typeof createServices>,
  responder: (task: ApprovalTask) => Promise<boolean | void> | boolean | void,
) => {
  const unsubscribe = services.controllers.approvals.onRequest(({ task }) => {
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
        if (services.controllers.approvals.has(task.id)) {
          services.controllers.approvals.reject(
            task.id,
            new Error("setupApprovalResponder: responder did not resolve/reject task"),
          );
        }
      }
    })();
  });

  return unsubscribe;
};

export const setupSwitchChainApprovalResponder = (services: ReturnType<typeof createServices>) => {
  return setupApprovalResponder(services, async (task) => {
    if (task.type !== ApprovalTypes.SwitchChain) {
      return false;
    }

    const payload = task.payload as { chainRef?: string };
    const chainRef = payload.chainRef ?? task.chainRef;
    if (!chainRef) {
      throw new Error("Switch chain approval is missing chainRef");
    }

    await services.controllers.approvals.resolve(task.id, async () => {
      await services.controllers.network.switchChain(chainRef);
      await services.controllers.networkPreferences.setActiveChainRef(
        chainRef as Parameters<typeof services.controllers.networkPreferences.setActiveChainRef>[0],
      );
      return null;
    });

    return true;
  });
};
