import {
  toAccountKeyFromAddress,
  toCanonicalAddressFromAccountKey,
  toDisplayAddressFromAccountKey,
} from "../../../../../accounts/addressing/accountKey.js";
import { ApprovalKinds, type ApprovalRecord } from "../../../../../approvals/index.js";
import { parseChainRef } from "../../../../../chains/caip.js";
import { eip155ChainIdHexFromChainRef } from "../../../../../chains/eip155/format.js";
import type { ChainRef } from "../../../../../chains/ids.js";
import { type ChainMetadata, deriveChainMetadataFromDefinitionSeed } from "../../../../../chains/metadata.js";
import {
  FakeVault,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemorySettingsPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
  TEST_NAMESPACE_MANIFESTS,
} from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "../../../../../runtime/createBackgroundRuntime.js";
import { RpcExecutionContextKinds } from "../../../../index.js";

export const ORIGIN = "https://dapp.example";

export const ALT_CHAIN = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
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

export const createChainDefinitionsPort = () => new MemoryChainDefinitionsPort();

export const createRuntime = (overrides?: Partial<Parameters<typeof createBackgroundRuntime>[0]>) => {
  const {
    supportedChains,
    session,
    walletChainSelection,
    providerChainSelection,
    chainRpcDefaultEndpoints,
    chainRpcEndpointOverrides,
    rpcAccessPolicy,
    store,
    ...rest
  } = overrides ?? {};
  const chainDefinitionsPort = store?.ports.chainDefinitions ?? createChainDefinitionsPort();
  const storePorts = {
    chainDefinitions: chainDefinitionsPort,
    permissions: new MemoryPermissionsPort(),
    transactionAggregates: new MemoryTransactionAggregatesPort(),
    accounts: new MemoryAccountsPort(),
    keyringMetas: new MemoryKeyringMetasPort(),
    ...(store?.ports ?? {}),
  };
  const runtime = createBackgroundRuntime({
    supportedChains: {
      ...(supportedChains ?? {}),
    },
    namespaces: {
      manifests: TEST_NAMESPACE_MANIFESTS,
    },
    rpcAccessPolicy:
      rpcAccessPolicy ??
      ({
        isInternalOrigin: () => false,
        shouldRequestUnlockAttention: () => false,
      } as const),
    walletChainSelection: walletChainSelection ?? { port: new MemoryWalletChainSelectionPort() },
    providerChainSelection: providerChainSelection ?? { port: new MemoryProviderChainSelectionPort() },
    chainRpcDefaultEndpoints: chainRpcDefaultEndpoints ?? { port: new MemoryChainRpcDefaultEndpointsPort() },
    chainRpcEndpointOverrides: chainRpcEndpointOverrides ?? { port: new MemoryChainRpcEndpointOverridesPort() },
    settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    store: {
      ...(store ?? {}),
      ports: storePorts,
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
type RpcExecutorArgs = Parameters<TestRuntime["rpc"]["executeRequest"]>[0];
type TestRpcExecutorArgs = RpcExecutorArgs extends infer Args
  ? Args extends unknown
    ? Omit<Args, "executionContext"> & {
        executionContext?: RpcExecutorArgs["executionContext"];
      }
    : never
  : never;
type TestOwnedAccount = ReturnType<TestRuntime["services"]["accounts"]["getOwnedAccount"]>;
type TestAccountSelectionService = TestRuntime["services"]["accounts"] & {
  __testOwnedAccounts?: Map<string, TestOwnedAccount>;
  __originalGetOwnedAccount?: TestRuntime["services"]["accounts"]["getOwnedAccount"];
};

export const getChainMetadata = (runtime: TestRuntime, chainRef: ChainRef): ChainMetadata | null => {
  const entry = runtime.services.supportedChains.getChain(chainRef);
  if (!entry) {
    return null;
  }

  return deriveChainMetadataFromDefinitionSeed({
    seed: { definition: entry.definition },
    namespace: entry.namespace,
    chainId: eip155ChainIdHexFromChainRef(chainRef),
  });
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
  const { namespace } = parseChainRef(firstChainRef);

  await runtime.services.permissions.grantAuthorization(origin, {
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

  const accountSelectionService = runtime.services.accounts as TestAccountSelectionService;

  if (!accountSelectionService.__testOwnedAccounts) {
    accountSelectionService.__testOwnedAccounts = new Map();
  }

  if (!accountSelectionService.__originalGetOwnedAccount) {
    const original = accountSelectionService.getOwnedAccount.bind(accountSelectionService);
    accountSelectionService.__originalGetOwnedAccount = original;
    accountSelectionService.getOwnedAccount = (params) => {
      const key = `${params.chainRef}:${params.accountKey}`;
      return accountSelectionService.__testOwnedAccounts?.get(key) ?? original(params);
    };
  }

  for (const chainRef of chainRefs) {
    for (const address of addresses) {
      const accountKey = toAccountKeyFromAddress({
        chainRef,
        address,
        accountCodecs: runtime.services.accountCodecs,
      });
      accountSelectionService.__testOwnedAccounts.set(`${chainRef}:${accountKey}`, {
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
  return async (args: TestRpcExecutorArgs) => {
    const requestContext = {
      transport: "provider",
      portId: "test-port",
      sessionId: crypto.randomUUID(),
      requestId: "test-request",
      origin: args.origin,
    } as const;
    const executionContext =
      args.executionContext ??
      ({
        kind: RpcExecutionContextKinds.Provider,
        requestContext,
        providerRequestHandle: {
          id: requestContext.requestId,
          namespace: "eip155",
          signal: new AbortController().signal,
          attachBlockingApproval: async <T extends object>(
            createApproval: (reservation: { approvalId: string; createdAt: number }) => T | Promise<T>,
            reservation?: Partial<{ approvalId: string; createdAt: number }>,
          ) => {
            const approvalIdentity = {
              approvalId: reservation?.approvalId ?? "test-request-approval",
              createdAt: reservation?.createdAt ?? 0,
            };
            const approval = await createApproval(approvalIdentity);
            return {
              ...approval,
              ...approvalIdentity,
            };
          },
          fulfill: () => true,
          reject: () => true,
          cancel: async () => true,
          getTerminalError: () => null,
        } as const,
      } as const);
    if ("invocation" in args && args.invocation) {
      return await executeRequest({
        origin: args.origin,
        request: args.request,
        invocation: args.invocation,
        executionContext,
      });
    }

    return await executeRequest({
      origin: args.origin,
      request: args.request,
      ...(args.hint !== undefined ? { hint: args.hint } : {}),
      executionContext,
    });
  };
};

export const waitForChainInNetwork = async (
  runtime: ReturnType<typeof createRuntime>,
  chainRef: ChainRef,
  timeoutMs = 5000,
): Promise<ChainMetadata> => {
  const isAvailable = runtime.services.chainRpc.hasEndpoints(chainRef);
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
      const nextIsAvailable = runtime.services.chainRpc.hasEndpoints(chainRef);
      const chain = nextIsAvailable ? getChainMetadata(runtime, chainRef) : null;
      if (chain) {
        cleanup();
        resolve(chain);
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for chain ${chainRef} in chain RPC service`));
    }, timeoutMs);

    unsubscribe = runtime.services.chainRpc.onStateChanged(() => {
      tryResolve();
    });

    tryResolve();
  });
};

export const setupApprovalResponder = (
  runtime: ReturnType<typeof createRuntime>,
  responder: (record: ApprovalRecord) => Promise<boolean | undefined> | boolean | undefined,
) => {
  const unsubscribe = runtime.services.approvals.onCreated(({ record }) => {
    void (async () => {
      try {
        await Promise.resolve();
        await responder(record);
      } catch (error) {
        console.error("[setupApprovalResponder] Responder error:", error);
        if (runtime.services.approvals.has(record.approvalId)) {
          await runtime.services.approvals.cancel({
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

    await runtime.services.approvals.resolve({ approvalId: record.approvalId, action: "approve" });
    return true;
  });
};
