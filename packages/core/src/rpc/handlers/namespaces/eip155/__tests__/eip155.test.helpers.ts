import type { ChainRef } from "../../../../../chains/ids.js";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import { ApprovalKinds, type ApprovalRecord } from "../../../../../controllers/index.js";
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

export const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

export const createChainDefinitionsPort = () => ({
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

export const createRuntime = (overrides?: Partial<Parameters<typeof createBackgroundRuntime>[0]>) => {
  const { chainDefinitions, session, networkPreferences, rpcEngine, ...rest } = overrides ?? {};
  const runtime = createBackgroundRuntime({
    chainDefinitions: {
      port: createChainDefinitionsPort(),
      ...(chainDefinitions ?? {}),
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
    session: {
      vault: new FakeVault(() => Date.now()),
      ...(session ?? {}),
    },
    ...rest,
  });

  return runtime;
};

type TestRuntime = ReturnType<typeof createRuntime>;

export const getChainMetadata = (runtime: TestRuntime, chainRef: ChainRef): ChainMetadata | null => {
  return runtime.controllers.chainDefinitions.getChain(chainRef)?.metadata ?? null;
};

export const getActiveChainMetadata = (runtime: TestRuntime): ChainMetadata => {
  const chainRef = runtime.controllers.network.getState().activeChainRef;
  const chain = getChainMetadata(runtime, chainRef);
  if (!chain) {
    throw new Error(`Missing chain metadata for active chain ${chainRef}`);
  }
  return chain;
};

export const createExecutor = (runtime: ReturnType<typeof createRuntime>) => {
  const execute = runtime.rpc.registry.createMethodExecutor(runtime.controllers, {
    rpcClientRegistry: runtime.rpc.clients,
    services: {
      chainViews: runtime.services.chainViews,
    },
  });
  return async (args: Parameters<typeof execute>[0]) => {
    const chainRef = args.context?.chainRef ?? runtime.controllers.network.getState().activeChainRef;
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
  const isAvailable = runtime.controllers.network.getState().availableChainRefs.includes(chainRef);
  const existing = isAvailable ? getChainMetadata(runtime, chainRef) : null;
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
      const nextIsAvailable = runtime.controllers.network.getState().availableChainRefs.includes(chainRef);
      const chain = nextIsAvailable ? getChainMetadata(runtime, chainRef) : null;
      if (chain) {
        cleanup();
        resolve(chain);
      }
    };

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
  responder: (task: ApprovalRecord) => Promise<boolean | undefined> | boolean | undefined,
) => {
  const unsubscribe = runtime.controllers.approvals.onCreated(({ record }) => {
    void (async () => {
      try {
        await Promise.resolve();
        await responder(record);
      } catch (error) {
        console.error("[setupApprovalResponder] Responder error:", error);
        if (runtime.controllers.approvals.has(record.id)) {
          await runtime.controllers.approvals.cancel({
            id: record.id,
            reason: "internal_error",
            error: new Error("setupApprovalResponder: responder did not resolve/reject task"),
          });
        }
      }
    })();
  });

  return unsubscribe;
};

export const setupSwitchChainApprovalResponder = (runtime: ReturnType<typeof createRuntime>) => {
  return setupApprovalResponder(runtime, async (task) => {
    if (task.kind !== ApprovalKinds.SwitchChain) {
      return false;
    }

    const payload = task.request as { chainRef?: string };
    const chainRef = payload.chainRef ?? task.chainRef;
    if (!chainRef) {
      throw new Error("Switch chain approval is missing chainRef");
    }

    await runtime.controllers.network.switchChain(chainRef);
    await runtime.controllers.networkPreferences.setActiveChainRef(
      chainRef as Parameters<typeof runtime.controllers.networkPreferences.setActiveChainRef>[0],
    );
    await runtime.controllers.approvals.resolve({ id: task.id, action: "approve", result: null });

    return true;
  });
};
