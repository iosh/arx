import {
  accountIdFromChainAddress,
  canonicalChainAddressFromAccountId,
  displayChainAddressFromAccountId,
} from "../../../../../accounts/addressing/accountId.js";
import { ApprovalKinds, type ApprovalRecord } from "../../../../../approvals/index.js";
import { parseChainRef } from "../../../../../chains/caip.js";
import { type ChainDefinition, cloneChainDefinition } from "../../../../../chains/definition.js";
import { eip155ChainIdHexFromChainRef } from "../../../../../chains/eip155/format.js";
import type { ChainRef } from "../../../../../chains/ids.js";
import {
  FakeVault,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
  TEST_NAMESPACE_MANIFESTS,
} from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "../../../../../runtime/createBackgroundRuntime.js";
import { RpcExecutionContextKinds } from "../../../../index.js";

export const ORIGIN = "https://dapp.example";

export type Eip155TestChainDefinition = ChainDefinition & {
  namespace: "eip155";
  chainId: string;
};

export const ALT_CHAIN: Eip155TestChainDefinition = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} satisfies Eip155TestChainDefinition;

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
    chainDefinitions,
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
    chainDefinitions: {
      ...(chainDefinitions ?? {}),
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

export const getChainDefinition = (runtime: TestRuntime, chainRef: ChainRef): Eip155TestChainDefinition | null => {
  const entry = runtime.services.chainDefinitions.getChain(chainRef);
  if (!entry) {
    return null;
  }

  return {
    ...cloneChainDefinition(entry.definition),
    namespace: entry.namespace,
    chainId: eip155ChainIdHexFromChainRef(chainRef),
  } as Eip155TestChainDefinition;
};

export const getActiveChainDefinition = (runtime: TestRuntime): Eip155TestChainDefinition => {
  const chainRef = runtime.services.chainViews.getSelectedChainView().chainRef;
  const chain = getChainDefinition(runtime, chainRef);
  if (!chain) {
    throw new Error(`Missing chain definition for selected chain ${chainRef}`);
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
      accountIds:
        index === 0
          ? (addresses.map((address) =>
              accountIdFromChainAddress({
                chainRef,
                address,
                accountAddressing: runtime.services.accountAddressing,
              }),
            ) as [string, ...string[]])
          : [],
    })) as [
      { chainRef: ChainRef; accountIds: [string, ...string[]] },
      ...Array<{ chainRef: ChainRef; accountIds: string[] }>,
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
      const key = `${params.chainRef}:${params.accountId}`;
      return accountSelectionService.__testOwnedAccounts?.get(key) ?? original(params);
    };
  }

  for (const chainRef of chainRefs) {
    for (const address of addresses) {
      const accountId = accountIdFromChainAddress({
        chainRef,
        address,
        accountAddressing: runtime.services.accountAddressing,
      });
      accountSelectionService.__testOwnedAccounts.set(`${chainRef}:${accountId}`, {
        accountId,
        namespace,
        canonicalAddress: canonicalChainAddressFromAccountId({
          chainRef,
          accountId,
          accountAddressing: runtime.services.accountAddressing,
        }),
        displayAddress: displayChainAddressFromAccountId({
          chainRef,
          accountId,
          accountAddressing: runtime.services.accountAddressing,
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
): Promise<Eip155TestChainDefinition> => {
  const isAvailable = runtime.services.chainRpc.hasEndpoints(chainRef);
  const existing = isAvailable ? getChainDefinition(runtime, chainRef) : null;
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
      const chain = nextIsAvailable ? getChainDefinition(runtime, chainRef) : null;
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
          runtime.services.approvals.cancel({
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
