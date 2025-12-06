import type { Caip2ChainId } from "../../../chains/ids.js";
import type { ChainMetadata } from "../../../chains/metadata.js";
import type { ApprovalTask } from "../../../controllers/index.js";
import { FakeVault } from "../../../runtime/__test-utils__/backgroundTestSetup.js";
import { createBackgroundServices } from "../../../runtime/createBackgroundServices.js";
import { createMethodExecutor } from "../../index.js";

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
export const createServices = (overrides?: Parameters<typeof createBackgroundServices>[0]) => {
  const { chainRegistry, session, ...rest } = overrides ?? {};
  return createBackgroundServices({
    chainRegistry: {
      port: createChainRegistryPort(),
      ...(chainRegistry ?? {}),
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
export const createExecutor = (services: ReturnType<typeof createServices>) =>
  createMethodExecutor(services.controllers, { rpcClientRegistry: services.rpcClients });

export const waitForChainInNetwork = async (
  services: ReturnType<typeof createServices>,
  chainRef: Caip2ChainId,
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
  responder: (task: ApprovalTask<unknown>) => Promise<boolean | void> | boolean | void,
) => {
  const unsubscribe = services.controllers.approvals.onRequest((task) => {
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
