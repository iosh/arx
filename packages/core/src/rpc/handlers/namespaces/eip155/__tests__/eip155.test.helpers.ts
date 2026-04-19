import {
  toAccountKeyFromAddress,
  toCanonicalAddressFromAccountKey,
  toDisplayAddressFromAccountKey,
} from "../../../../../accounts/addressing/accountKey.js";
import type { ChainRef } from "../../../../../chains/ids.js";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import { ApprovalKinds, type ApprovalRecord } from "../../../../../controllers/index.js";
import {
  FakeVault,
  MemoryAccountsPort,
  MemoryCustomChainsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkSelectionPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
  TEST_NAMESPACE_MANIFESTS,
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

export const createCustomChainsPort = () => new MemoryCustomChainsPort();

export const createRuntime = (overrides?: Partial<Parameters<typeof createBackgroundRuntime>[0]>) => {
  const { supportedChains, session, networkSelection, rpcEngine, store, ...rest } = overrides ?? {};
  const customChainsPort = supportedChains?.port ?? store?.ports.customChains ?? createCustomChainsPort();
  const runtime = createBackgroundRuntime({
    supportedChains: {
      port: customChainsPort,
      ...(supportedChains ?? {}),
    },
    namespaces: {
      manifests: TEST_NAMESPACE_MANIFESTS,
    },
    rpcEngine:
      rpcEngine ??
      ({
        env: {
          isInternalOrigin: () => false,
          shouldRequestUnlockAttention: () => false,
        },
      } as const),
    networkSelection: networkSelection ?? { port: new MemoryNetworkSelectionPort() },
    settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    store: {
      ports: {
        customChains: customChainsPort,
        permissions: new MemoryPermissionsPort(),
        transactions: new MemoryTransactionsPort(),
        accounts: new MemoryAccountsPort(),
        keyringMetas: new MemoryKeyringMetasPort(),
        ...(store?.ports ?? {}),
      },
      ...(store ? { ...store, ports: { customChains: customChainsPort, ...store.ports } } : {}),
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
type TestOwnedAccount = ReturnType<TestRuntime["controllers"]["accounts"]["getOwnedAccount"]>;
type TestAccountsController = TestRuntime["controllers"]["accounts"] & {
  __testOwnedAccounts?: Map<string, TestOwnedAccount>;
  __originalGetOwnedAccount?: TestRuntime["controllers"]["accounts"]["getOwnedAccount"];
};

export const getChainMetadata = (runtime: TestRuntime, chainRef: ChainRef): ChainMetadata | null => {
  return runtime.controllers.supportedChains.getChain(chainRef)?.metadata ?? null;
};

export const getActiveChainMetadata = (runtime: TestRuntime): ChainMetadata => {
  const chainRef = runtime.services.chainViews.getSelectedChainView().chainRef;
  const chain = getChainMetadata(runtime, chainRef);
  if (!chain) {
    throw new Error(`Missing chain metadata for selected chain ${chainRef}`);
  }
  return chain;
};

export const connectOrigin = async (args: {
  runtime: TestRuntime;
  origin?: string;
  chainRefs: [ChainRef, ...ChainRef[]];
  addresses: [string, ...string[]];
}) => {
  const { runtime, origin = ORIGIN, chainRefs, addresses } = args;
  const [firstChainRef] = chainRefs;
  const [namespace] = firstChainRef.split(":");

  await runtime.controllers.permissions.grantAuthorization(origin, {
    namespace,
    chains: chainRefs.map((chainRef, index) => ({
      chainRef,
      accountKeys:
        index === 0
          ? (addresses.map((address) =>
              toAccountKeyFromAddress({
                chainRef,
                address,
                accountCodecs: runtime.services.accountCodecs,
              }),
            ) as [string, ...string[]])
          : [],
    })) as [
      { chainRef: ChainRef; accountKeys: [string, ...string[]] },
      ...Array<{ chainRef: ChainRef; accountKeys: string[] }>,
    ],
  });

  const accountsController = runtime.controllers.accounts as TestAccountsController;

  if (!accountsController.__testOwnedAccounts) {
    accountsController.__testOwnedAccounts = new Map();
  }

  if (!accountsController.__originalGetOwnedAccount) {
    const original = accountsController.getOwnedAccount.bind(accountsController);
    accountsController.__originalGetOwnedAccount = original;
    accountsController.getOwnedAccount = (params) => {
      const key = `${params.chainRef}:${params.accountKey}`;
      return accountsController.__testOwnedAccounts?.get(key) ?? original(params);
    };
  }

  for (const chainRef of chainRefs) {
    for (const address of addresses) {
      const accountKey = toAccountKeyFromAddress({
        chainRef,
        address,
        accountCodecs: runtime.services.accountCodecs,
      });
      accountsController.__testOwnedAccounts.set(`${chainRef}:${accountKey}`, {
        accountKey,
        namespace,
        canonicalAddress: toCanonicalAddressFromAccountKey({
          accountKey,
          accountCodecs: runtime.services.accountCodecs,
        }),
        displayAddress: toDisplayAddressFromAccountKey({
          chainRef,
          accountKey,
          accountCodecs: runtime.services.accountCodecs,
        }),
      });
    }
  }
};

export const createExecutor = (runtime: ReturnType<typeof createRuntime>) => {
  const executeRequest = runtime.rpc.executeRequest;
  return async (args: Parameters<typeof executeRequest>[0]) => {
    const chainRef =
      args.context?.chainRef ??
      runtime.services.networkSelection.getSelectedChainRef("eip155") ??
      runtime.services.chainViews.getSelectedChainView().chainRef;
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
      providerRequestHandle:
        ctx.providerRequestHandle ??
        ({
          id: (ctx.requestContext?.requestId ?? "test-request") as string,
          providerNamespace: "eip155",
          attachBlockingApproval: <T>(
            createApproval: (reservation: { id: string; createdAt: number }) => T,
            reservation?: Partial<{ id: string; createdAt: number }>,
          ) =>
            createApproval({
              id: reservation?.id ?? "test-request-approval",
              createdAt: reservation?.createdAt ?? 0,
            }),
          fulfill: () => true,
          reject: () => true,
          cancel: async () => true,
          getTerminalError: () => null,
        } as const),
    };
    const result = await runtime.surfaceErrors.executeWithEncoding(
      {
        surface: "dapp",
        namespace: "eip155",
        chainRef,
        origin: args.origin,
        method: args.request.method,
      },
      () => executeRequest({ ...args, context }),
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
  responder: (record: ApprovalRecord) => Promise<boolean | undefined> | boolean | undefined,
) => {
  const unsubscribe = runtime.controllers.approvals.onCreated(({ record }) => {
    void (async () => {
      try {
        await Promise.resolve();
        await responder(record);
      } catch (error) {
        console.error("[setupApprovalResponder] Responder error:", error);
        if (runtime.controllers.approvals.has(record.approvalId)) {
          await runtime.controllers.approvals.cancel({
            approvalId: record.approvalId,
            reason: "internal_error",
            error: new Error("setupApprovalResponder: responder did not resolve/reject approval"),
          });
        }
      }
    })();
  });

  return unsubscribe;
};

export const setupSwitchChainApprovalResponder = (runtime: ReturnType<typeof createRuntime>) => {
  return setupApprovalResponder(runtime, async (record) => {
    if (record.kind !== ApprovalKinds.SwitchChain) {
      return false;
    }

    await runtime.controllers.approvals.resolve({ approvalId: record.approvalId, action: "approve" });
    return true;
  });
};
