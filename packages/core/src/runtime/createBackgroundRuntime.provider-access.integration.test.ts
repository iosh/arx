import { describe, expect, it, vi } from "vitest";
import { accountIdFromChainAddress } from "../accounts/addressing/accountId.js";
import type { NamespaceAccountAddressing } from "../accounts/addressing/addressing.js";
import { createApprovalDetails } from "../approvals/approvalDetails.js";
import { ApprovalKinds } from "../approvals/queue/types.js";
import { NamespaceChainActivationReasons } from "../chains/activation/types.js";
import { getChainRefNamespace } from "../chains/caip.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import { type ChainDefinition, cloneChainDefinition, type RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import { createUnsupportedKeyringFactories } from "../keyring/index.js";
import { eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import type { ProviderConnectionStateChange } from "../provider/access/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type {
  NamespaceTransaction,
  NamespaceTransactionProposal,
  NamespaceTransactionSubmission,
  NamespaceTransactionTracking,
} from "../transactions/namespace/types.js";
import type { CreateBackgroundRuntimeResult } from "./__fixtures__/backgroundTestSetup.js";
import {
  createChainDefinition,
  createChainDefinitionSeed,
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
  setupBackground,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";

type TestChain = ChainDefinition & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const toChainSeed = (chain: TestChain): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: cloneChainDefinition(chain),
  defaultRpcEndpoints: chain.defaultRpcEndpoints,
});

const SOLANA_CHAIN: TestChain = {
  chainRef: "solana:101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  defaultRpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
};
const EIP155_ALT_CHAIN = createChainDefinition({
  chainRef: "eip155:10",
  displayName: "Optimism",
  shortName: "OP",
});

const initializeUnlockedSession = async (runtime: CreateBackgroundRuntimeResult) => {
  await runtime.services.session.createVault({ password: PASSWORD });
  await runtime.services.session.unlock.unlock({ password: PASSWORD });
};

const deriveActiveAccount = async (runtime: CreateBackgroundRuntimeResult) => {
  const chain = runtime.services.chainViews.getSelectedChainView();
  const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
  const account = await runtime.services.keyring.deriveAccount(keyringId);

  await runtime.services.accounts.setActiveAccount({
    namespace: getChainRefNamespace(chain.chainRef),
    chainRef: chain.chainRef,
    accountId: accountIdFromChainAddress({
      chainRef: chain.chainRef,
      address: account.address,
      accountAddressing: runtime.services.accountAddressing,
    }),
  });

  return { chain, address: account.address };
};

const grantProviderPermission = async (
  runtime: CreateBackgroundRuntimeResult,
  input: { origin: string; chainRef: string; address: string },
) => {
  const chain = runtime.services.chainDefinitions.getChain(input.chainRef as ChainRef);
  if (!chain) {
    throw new Error(`Missing chain definition for ${input.chainRef}`);
  }

  await runtime.services.permissions.grantAuthorization(input.origin, {
    namespace: getChainRefNamespace(chain.chainRef),
    chains: [
      {
        chainRef: input.chainRef,
        accountIds: [
          accountIdFromChainAddress({
            chainRef: input.chainRef,
            address: input.address,
            accountAddressing: runtime.services.accountAddressing,
          }),
        ],
      },
    ],
  });
};

const buildEip155Submitted = (params: {
  txHash: `0x${string}`;
  from: string;
  chainId?: `0x${string}`;
  prepared?: Record<string, unknown>;
}) => ({
  hash: params.txHash,
  chainId: params.chainId ?? "0x1",
  from: params.from,
  ...(typeof params.prepared?.nonce === "string" ? { nonce: params.prepared.nonce as `0x${string}` } : {}),
});

const createNamespaceTransactionMock = (params: {
  prepareTransaction: NamespaceTransactionProposal["prepare"];
  createBroadcastArtifact?: NamespaceTransactionSubmission["createBroadcastArtifact"];
  broadcastTransaction?: NamespaceTransactionSubmission["broadcast"];
  tracking?: NamespaceTransactionTracking;
}): NamespaceTransaction => {
  const createBroadcastArtifact =
    params.createBroadcastArtifact ??
    vi.fn(async () => ({
      kind: "test.signed_transaction",
      payload: { raw: "0x1111" },
    }));
  const broadcastTransaction =
    params.broadcastTransaction ??
    vi.fn(async (context) => {
      const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      return {
        broadcastIdentity: { hash: txHash },
        submitted: buildEip155Submitted({
          txHash,
          from: context.from,
          prepared: context.approvedPayload as Record<string, unknown>,
        }),
      };
    });

  return {
    request: {
      deriveForChain: (request, chainRef) => ({ ...request, chainRef }),
      validateRequest: () => {},
    },
    proposal: {
      prepare: params.prepareTransaction,
      buildReview: () => null,
      buildReplacementRequest: async (context) => context.targetRequest,
      deriveResourceKey: () => null,
      finalizeSubmit: async (context) => ({
        status: "approved",
        approvedPayload: context.preparedPayload,
        conflictKey: null,
      }),
    },
    submission: {
      createBroadcastArtifact,
      broadcast: broadcastTransaction,
    },
    tracking:
      params.tracking ??
      ({
        inspectSubmittedTransaction: async () => ({ trackingStatus: "pending", evidence: null }),
        getInitialInspectionDelay: () => 1_000,
        getPendingInspectionDelay: () => 1_000,
        getRetryInspectionDelay: () => 1_000,
      } satisfies NamespaceTransactionTracking),
  };
};

const createApprovalReader = (runtime: CreateBackgroundRuntimeResult) =>
  createApprovalDetails({
    approvals: runtime.services.approvals,
    accounts: runtime.services.accounts,
    chainViews: runtime.services.chainViews,
  });

const requestProviderRpc = (
  runtime: CreateBackgroundRuntimeResult,
  input: {
    id: string;
    method: string;
    namespace: string;
    params?: JsonRpcParams;
    origin?: string;
    portId?: string;
    sessionId?: string;
  },
) => {
  return runtime.providerAccess.request({
    scope: {
      transport: "provider" as const,
      origin: input.origin ?? ORIGIN,
      portId: input.portId ?? "port-1",
      sessionId: input.sessionId ?? "session-1",
    },
    namespace: input.namespace,
    request: {
      id: input.id,
      jsonrpc: "2.0",
      method: input.method,
      ...(input.params !== undefined ? { params: input.params } : {}),
    },
  });
};

const activateProviderConnectionScope = async (
  runtime: CreateBackgroundRuntimeResult,
  input: { origin?: string; namespace: string },
) => {
  await runtime.providerAccess.activateConnectionScope({
    origin: input.origin ?? ORIGIN,
    namespace: input.namespace,
  });
};

const createTestNamespaceAccountAddressing = (namespace: string): NamespaceAccountAddressing => ({
  namespace,
  accountIdPayloadFromAddress: () => "010203",
  canonicalAddressFromAccountIdPayload: () => `${namespace}:canonical`,
  displayAddressFromAccountIdPayload: () => `${namespace}:display`,
});

const createTestNamespaceChainAddressing = (namespace: string): NamespaceChainAddressing => ({
  namespace,
  address: {
    canonicalize: ({ value }) => ({ canonical: value }),
    format: ({ canonical }) => canonical,
  },
});

const createTestRpcModule = (namespace: string): RpcNamespaceModule => ({
  namespace,
  adapter: {
    namespace,
    methodPrefixes: ["sol_"],
    definitions: {},
  },
});

const createTestNamespaceTransaction = (): NamespaceTransaction => ({
  request: {
    deriveForChain: (request, chainRef) => ({ ...request, chainRef }),
    validateRequest: () => {},
  },
  proposal: {
    prepare: async () => ({ status: "ready", prepared: {}, reviewSnapshot: {} }),
    buildReview: () => null,
    buildReplacementRequest: async (context) => context.targetRequest,
    deriveResourceKey: () => null,
    finalizeSubmit: async (context) => ({
      status: "approved",
      approvedPayload: context.preparedPayload,
      conflictKey: null,
    }),
  },
  submission: {
    createBroadcastArtifact: async () => ({ kind: "test.raw", payload: { raw: "0x" } }),
    broadcast: async () => ({
      broadcastIdentity: { hash: "0xhash" },
      submitted: { hash: "0xhash" },
    }),
  },
  tracking: {
    inspectSubmittedTransaction: async () => ({ trackingStatus: "pending", evidence: null }),
    getInitialInspectionDelay: () => 1_000,
    getPendingInspectionDelay: () => 1_000,
    getRetryInspectionDelay: () => 1_000,
  },
});

const solanaNamespaceManifest = (() => {
  const namespace = "solana";
  const accountAddressing = createTestNamespaceAccountAddressing(namespace);

  return {
    namespace,
    core: {
      rpc: createTestRpcModule(namespace),
      chainAddressing: createTestNamespaceChainAddressing(namespace),
      accountAddressing,
      keyring: {
        namespace,
        defaultChainRef: SOLANA_CHAIN.chainRef as ChainRef,
        accountAddressing,
        factories: createUnsupportedKeyringFactories(namespace),
      },
      chainSeeds: [toChainSeed(SOLANA_CHAIN)],
    },
    runtime: {
      clientFactory: () => ({
        request: async () => null,
      }),
      createSigner: () => ({}),
      createApprovalBindings: () => ({
        signMessage: async () => "solana-signature",
        signTypedData: async () => "solana-signature",
      }),
      createUiBindings: () => ({
        getNativeBalance: async () => 0n,
      }),
      createTransaction: () => createTestNamespaceTransaction(),
    },
  } satisfies NamespaceManifest;
})();

const setupNamespaceAwareProviderAccess = async () => {
  const chainDefinitionsPort = new MemoryChainDefinitionsPort();
  const runtime = createBackgroundRuntime({
    chainDefinitions: {
      seed: [createChainDefinitionSeed(), toChainSeed(SOLANA_CHAIN)],
    },
    namespaces: {
      manifests: [eip155NamespaceManifest, solanaNamespaceManifest],
    },
    rpcAccessPolicy: {
      isInternalOrigin: () => false,
      shouldRequestUnlockAttention: () => false,
    },
    walletChainSelection: { port: new MemoryWalletChainSelectionPort() },
    providerChainSelection: { port: new MemoryProviderChainSelectionPort() },
    chainRpcDefaultEndpoints: { port: new MemoryChainRpcDefaultEndpointsPort() },
    chainRpcEndpointOverrides: { port: new MemoryChainRpcEndpointOverridesPort() },
    store: {
      ports: {
        chainDefinitions: chainDefinitionsPort,
        permissions: new MemoryPermissionsPort(),
        transactionAggregates: new MemoryTransactionAggregatesPort(),
        accounts: new MemoryAccountsPort(),
        keyringMetas: new MemoryKeyringMetasPort(),
      },
    },
  });

  await runtime.lifecycle.initialize();
  runtime.lifecycle.start();

  return runtime;
};

const setupProviderConnectionStateRuntime = async () => {
  const background = await setupBackground({
    chainSeed: [createChainDefinition(), EIP155_ALT_CHAIN],
    walletChainSelectionSeed: {
      id: "wallet-chain-selection",
      selectedNamespace: "eip155",
      chainRefByNamespace: { eip155: "eip155:1" },
      updatedAt: 0,
    },
  });

  return background;
};

const collectProviderConnectionChanges = (runtime: CreateBackgroundRuntimeResult) => {
  const changes: ProviderConnectionStateChange[] = [];
  const unsubscribe = runtime.providerAccess.subscribeConnectionStateChanged((change) => {
    changes.push(change);
  });

  return {
    changes,
    unsubscribe,
    clear: () => {
      changes.length = 0;
    },
  };
};

describe("createBackgroundRuntime provider access", () => {
  it("builds namespace-scoped snapshots and hides permitted accounts while locked", async () => {
    const background = await setupBackground();

    await background.runtime.providerAccess.activateConnectionScope({
      origin: ORIGIN,
      namespace: "eip155",
    });

    const snapshot = background.runtime.providerAccess.buildSnapshot({
      origin: ORIGIN,
      namespace: "eip155",
    });

    expect(snapshot).toEqual({
      namespace: "eip155",
      chain: {
        chainId: "0x1",
        chainRef: "eip155:1",
      },
      isUnlocked: false,
    });

    await expect(
      background.runtime.providerAccess.listPermittedAccounts({
        origin: ORIGIN,
        chainRef: snapshot.chain.chainRef,
      }),
    ).resolves.toEqual([]);
  });

  it("clears stale provider chain selection before defaulting to the active chain", async () => {
    const background = await setupBackground({
      providerChainSelectionSeed: [
        {
          origin: ORIGIN,
          namespace: "eip155",
          chainRef: EIP155_ALT_CHAIN.chainRef,
          updatedAt: 1,
        },
      ],
    });

    const state = await background.runtime.providerAccess.activateConnectionScope({
      origin: ORIGIN,
      namespace: "eip155",
    });

    expect(state.snapshot.chain.chainRef).toBe("eip155:1");
    expect(background.providerChainSelectionPort.removed).toEqual([{ origin: ORIGIN, namespace: "eip155" }]);
    await expect(
      background.providerChainSelectionPort.get({ origin: ORIGIN, namespace: "eip155" }),
    ).resolves.toMatchObject({
      chainRef: "eip155:1",
    });
  });

  it("initializes provider chain selection on connection activation, not provider request execution", async () => {
    const background = await setupBackground({
      chainSeed: [createChainDefinition(), EIP155_ALT_CHAIN],
      walletChainSelectionSeed: {
        id: "wallet-chain-selection",
        selectedNamespace: "eip155",
        chainRefByNamespace: { eip155: EIP155_ALT_CHAIN.chainRef },
        updatedAt: 0,
      },
    });

    await expect(
      background.runtime.providerAccess.request({
        scope: {
          transport: "provider",
          origin: ORIGIN,
          portId: "port-1",
          sessionId: "session-1",
        },
        namespace: "eip155",
        request: {
          id: "rpc-before-activation",
          jsonrpc: "2.0",
          method: "eth_chainId",
        },
      }),
    ).resolves.toMatchObject({
      id: "rpc-before-activation",
      jsonrpc: "2.0",
      error: {
        kind: "ArxError",
        code: "chain.not_supported",
      },
    });
    expect(background.providerChainSelectionPort.saved).toEqual([]);
    await expect(
      background.providerChainSelectionPort.get({ origin: ORIGIN, namespace: "eip155" }),
    ).resolves.toBeNull();

    const state = await background.runtime.providerAccess.activateConnectionScope({
      origin: ORIGIN,
      namespace: "eip155",
    });

    expect(state.snapshot.chain.chainRef).toBe(EIP155_ALT_CHAIN.chainRef);
    expect(background.providerChainSelectionPort.saved).toHaveLength(1);
    expect(background.providerChainSelectionPort.saved[0]).toMatchObject({
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: EIP155_ALT_CHAIN.chainRef,
    });
  });

  it("builds handshake connection state from one unlock snapshot", async () => {
    const background = await setupBackground();

    const lockedState = await background.runtime.providerAccess.activateConnectionScope({
      namespace: "eip155",
      origin: ORIGIN,
    });
    expect(lockedState).toEqual({
      snapshot: {
        namespace: "eip155",
        chain: {
          chainId: "0x1",
          chainRef: "eip155:1",
        },
        isUnlocked: false,
      },
      accounts: [],
    });

    await initializeUnlockedSession(background.runtime);
    const { chain, address } = await deriveActiveAccount(background.runtime);

    await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
      namespace: getChainRefNamespace(chain.chainRef),
      chains: [
        {
          chainRef: chain.chainRef,
          accountIds: [
            accountIdFromChainAddress({
              chainRef: chain.chainRef,
              address,
              accountAddressing: background.runtime.services.accountAddressing,
            }),
          ],
        },
      ],
    });

    const unlockedState = await background.runtime.providerAccess.buildConnectionState({
      namespace: getChainRefNamespace(chain.chainRef),
      origin: ORIGIN,
    });
    expect(unlockedState.snapshot.isUnlocked).toBe(true);
    expect(unlockedState.accounts.map((value) => value.toLowerCase())).toEqual([address.toLowerCase()]);
  });

  it("emits provider connection state changes only for the selected origin and namespace", async () => {
    const background = await setupProviderConnectionStateRuntime();
    const events = collectProviderConnectionChanges(background.runtime);

    try {
      const state = await background.runtime.providerAccess.activateConnectionScope({
        origin: ORIGIN,
        namespace: "eip155",
      });
      await background.runtime.providerAccess.activateConnectionScope({
        origin: "https://other.example",
        namespace: "eip155",
      });
      await flushAsync();

      expect(state.snapshot.chain.chainRef).toBe("eip155:1");
      expect(
        background.runtime.services.providerChainSelection.getSelectedChainRef({
          origin: ORIGIN,
          namespace: "eip155",
        }),
      ).toBe("eip155:1");
      expect(events.changes).toEqual([]);
      events.clear();

      await background.runtime.services.chainActivation.selectProviderChain({
        origin: ORIGIN,
        namespace: "eip155",
        chainRef: EIP155_ALT_CHAIN.chainRef,
        reason: NamespaceChainActivationReasons.SwitchChain,
      });
      await flushAsync();

      expect(events.changes).toHaveLength(1);
      expect(events.changes[0]).toMatchObject({
        scope: { origin: ORIGIN, namespace: "eip155" },
        previous: { snapshot: { chain: { chainRef: "eip155:1" } } },
        next: { snapshot: { chain: { chainRef: EIP155_ALT_CHAIN.chainRef } } },
        changed: { chain: true, accounts: false },
      });
    } finally {
      events.unsubscribe();
    }
  });

  it("keeps provider connection chains independent from later wallet chain changes", async () => {
    const background = await setupProviderConnectionStateRuntime();
    const events = collectProviderConnectionChanges(background.runtime);

    try {
      await background.runtime.providerAccess.activateConnectionScope({
        origin: ORIGIN,
        namespace: "eip155",
      });
      await background.runtime.providerAccess.activateConnectionScope({
        origin: "https://other.example",
        namespace: "eip155",
      });
      events.clear();

      await background.runtime.services.chainActivation.selectWalletChain(EIP155_ALT_CHAIN.chainRef);
      await flushAsync();

      expect(events.changes).toEqual([]);
      await expect(
        background.runtime.providerAccess.buildConnectionState({
          origin: "https://other.example",
          namespace: "eip155",
        }),
      ).resolves.toMatchObject({
        snapshot: {
          chain: { chainRef: "eip155:1", chainId: "0x1" },
        },
      });
    } finally {
      events.unsubscribe();
    }
  });

  it("emits account-only provider connection changes when permissions change", async () => {
    const background = await setupProviderConnectionStateRuntime();
    const events = collectProviderConnectionChanges(background.runtime);

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);
      await grantProviderPermission(background.runtime, {
        origin: ORIGIN,
        chainRef: chain.chainRef,
        address,
      });
      await background.runtime.providerAccess.activateConnectionScope({
        origin: ORIGIN,
        namespace: "eip155",
      });
      events.clear();

      await background.runtime.services.permissions.revokeChainAuthorization(ORIGIN, {
        namespace: "eip155",
        chainRef: chain.chainRef,
      });
      await flushAsync();

      expect(events.changes).toHaveLength(1);
      expect(events.changes[0]).toMatchObject({
        scope: { origin: ORIGIN, namespace: "eip155" },
        previous: { accounts: [expect.any(String)] },
        next: { accounts: [] },
        changed: { chain: false, accounts: true },
      });
    } finally {
      events.unsubscribe();
    }
  });

  it("formats permitted accounts for an unlocked authorized origin and re-checks lock state on each call", async () => {
    const background = await setupBackground();

    await initializeUnlockedSession(background.runtime);
    const { chain, address } = await deriveActiveAccount(background.runtime);
    await background.runtime.providerAccess.activateConnectionScope({
      origin: ORIGIN,
      namespace: getChainRefNamespace(chain.chainRef),
    });
    const unlockedSnapshot = background.runtime.providerAccess.buildSnapshot({
      origin: ORIGIN,
      namespace: getChainRefNamespace(chain.chainRef),
    });

    await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
      namespace: getChainRefNamespace(chain.chainRef),
      chains: [
        {
          chainRef: chain.chainRef,
          accountIds: [
            accountIdFromChainAddress({
              chainRef: chain.chainRef,
              address,
              accountAddressing: background.runtime.services.accountAddressing,
            }),
          ],
        },
      ],
    });

    const accounts = await background.runtime.providerAccess.listPermittedAccounts({
      origin: ORIGIN,
      chainRef: chain.chainRef,
    });
    expect(accounts.map((value) => value.toLowerCase())).toEqual([address.toLowerCase()]);

    background.runtime.services.session.unlock.lock("manual");

    await expect(
      background.runtime.providerAccess.listPermittedAccounts({
        origin: ORIGIN,
        chainRef: unlockedSnapshot.chain.chainRef,
      }),
    ).resolves.toEqual([]);
  });

  it("dispatches provider requests through the runtime pipeline", async () => {
    const background = await setupBackground();

    await initializeUnlockedSession(background.runtime);
    const { chain, address } = await deriveActiveAccount(background.runtime);

    await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
      namespace: getChainRefNamespace(chain.chainRef),
      chains: [
        {
          chainRef: chain.chainRef,
          accountIds: [
            accountIdFromChainAddress({
              chainRef: chain.chainRef,
              address,
              accountAddressing: background.runtime.services.accountAddressing,
            }),
          ],
        },
      ],
    });
    await activateProviderConnectionScope(background.runtime, { namespace: getChainRefNamespace(chain.chainRef) });

    const response = await requestProviderRpc(background.runtime, {
      id: "rpc-1",
      method: "eth_accounts",
      namespace: getChainRefNamespace(chain.chainRef),
    });

    expect(response).toMatchObject({
      id: "rpc-1",
      jsonrpc: "2.0",
    });
    expect(
      "result" in response && Array.isArray(response.result)
        ? response.result.map((value) => String(value).toLowerCase())
        : [],
    ).toEqual([address.toLowerCase()]);

    const connection = background.runtime.services.permissionViews.getAuthorizationSnapshot(ORIGIN, {
      chainRef: chain.chainRef,
    });
    expect(connection.isAuthorized).toBe(true);
    expect(connection.accounts.map((account) => account.displayAddress.toLowerCase())).toContain(address.toLowerCase());
  });

  it("cancels provider-scoped approvals via session scope", async () => {
    const background = await setupBackground();

    await initializeUnlockedSession(background.runtime);
    const { chain } = await deriveActiveAccount(background.runtime);
    await activateProviderConnectionScope(background.runtime, { namespace: getChainRefNamespace(chain.chainRef) });

    let approvalCreatedResolve: (() => void) | null = null;
    let capturedApprovalRequesterId: string | null = null;
    const approvalCreated = new Promise<void>((resolve) => {
      approvalCreatedResolve = resolve;
    });
    const unsubscribe = background.runtime.services.approvals.onCreated(({ record }) => {
      capturedApprovalRequesterId = record.requester.requestId ?? null;
      approvalCreatedResolve?.();
    });

    const pendingResponse = requestProviderRpc(background.runtime, {
      id: "rpc-2",
      method: "eth_requestAccounts",
      namespace: getChainRefNamespace(chain.chainRef),
    });

    await approvalCreated;
    await flushAsync();
    expect(background.runtime.services.approvals.getState().pending).toHaveLength(1);
    expect(capturedApprovalRequesterId).toBeTruthy();
    expect(capturedApprovalRequesterId).not.toBe("rpc-2");

    await expect(
      background.runtime.providerAccess.cancelRequestScope({
        transport: "provider",
        origin: ORIGIN,
        portId: "port-1",
        sessionId: "session-1",
      }),
    ).resolves.toBe(1);

    await expect(pendingResponse).resolves.toMatchObject({
      id: "rpc-2",
      jsonrpc: "2.0",
      error: {
        kind: "ArxError",
        code: "global.transport.disconnected",
      },
    });
    expect(background.runtime.services.approvals.getState().pending).toHaveLength(0);

    unsubscribe();
  });

  it("cancels eth_sendTransaction approvals together with the provider request scope", async () => {
    const chain = createChainDefinition({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
    });
    const namespaceTransactions = new NamespaceTransactions([
      [
        getChainRefNamespace(chain.chainRef),
        createNamespaceTransactionMock({
          prepareTransaction: vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
            status: "ready",
            prepared: { nonce: "0x7" },
          })),
        }),
      ],
    ]);
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });

    await initializeUnlockedSession(background.runtime);
    const { chain: activeChain, address } = await deriveActiveAccount(background.runtime);

    await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
      namespace: getChainRefNamespace(activeChain.chainRef),
      chains: [
        {
          chainRef: activeChain.chainRef,
          accountIds: [
            accountIdFromChainAddress({
              chainRef: activeChain.chainRef,
              address,
              accountAddressing: background.runtime.services.accountAddressing,
            }),
          ],
        },
      ],
    });
    await activateProviderConnectionScope(background.runtime, {
      namespace: getChainRefNamespace(activeChain.chainRef),
    });

    let capturedApprovalId: string | null = null;
    const approvalCreated = new Promise<void>((resolve) => {
      const unsubscribeApprovalChange = background.runtime.services.approvals.onCreated(({ record }) => {
        if (record.kind !== ApprovalKinds.SendTransaction) {
          return;
        }
        capturedApprovalId = record.approvalId;
        unsubscribeApprovalChange();
        resolve();
      });
    });

    const pendingResponse = requestProviderRpc(background.runtime, {
      id: "rpc-3",
      method: "eth_sendTransaction",
      namespace: getChainRefNamespace(activeChain.chainRef),
      params: [
        {
          from: address,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      ],
    });

    await approvalCreated;
    await flushAsync();
    expect(capturedApprovalId).toBeTruthy();
    expect(background.runtime.services.approvals.get(capturedApprovalId ?? "")).toBeTruthy();

    await expect(
      background.runtime.providerAccess.cancelRequestScope({
        transport: "provider",
        origin: ORIGIN,
        portId: "port-1",
        sessionId: "session-1",
      }),
    ).resolves.toBe(1);

    await expect(pendingResponse).resolves.toMatchObject({
      id: "rpc-3",
      jsonrpc: "2.0",
      error: {
        kind: "ArxError",
        code: "global.transport.disconnected",
      },
    });
    expect(background.runtime.services.approvals.get(capturedApprovalId ?? "")).toBeUndefined();
    await expect(background.runtime.transactions.listTransactions()).resolves.toEqual([]);
  });

  it("exposes eth_sendTransaction approval detail and completes after ready approval", async () => {
    const chain = createChainDefinition({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
    });
    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {
        gas: "0x5208",
        nonce: "0x7",
      },
    }));
    const createBroadcastArtifact = vi.fn<NamespaceTransactionSubmission["createBroadcastArtifact"]>(async () => ({
      kind: "test.signed_transaction",
      payload: { raw: "0x1111" },
    }));
    const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const broadcastTransaction = vi.fn<NamespaceTransactionSubmission["broadcast"]>(async (context) => ({
      broadcastIdentity: { hash: txHash },
      submitted: buildEip155Submitted({
        txHash,
        from: context.from,
        prepared: context.approvedPayload as Record<string, unknown>,
      }),
    }));
    const namespaceTransactions = new NamespaceTransactions([
      [
        getChainRefNamespace(chain.chainRef),
        createNamespaceTransactionMock({
          prepareTransaction,
          createBroadcastArtifact,
          broadcastTransaction,
        }),
      ],
    ]);
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });

    let capturedApprovalId: string | null = null;
    const approvalCreated = new Promise<void>((resolve) => {
      const unsubscribe = background.runtime.services.approvals.onCreated(({ record }) => {
        if (record.kind !== ApprovalKinds.SendTransaction) {
          return;
        }
        capturedApprovalId = record.approvalId;
        unsubscribe();
        resolve();
      });
    });

    await initializeUnlockedSession(background.runtime);
    const { chain: activeChain, address } = await deriveActiveAccount(background.runtime);
    await grantProviderPermission(background.runtime, {
      origin: ORIGIN,
      chainRef: activeChain.chainRef,
      address,
    });
    await activateProviderConnectionScope(background.runtime, { namespace: activeChain.namespace });

    const pendingResponse = requestProviderRpc(background.runtime, {
      id: "rpc-send-ready",
      method: "eth_sendTransaction",
      namespace: activeChain.namespace,
      params: [
        {
          from: address,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
        },
      ],
    });

    await approvalCreated;
    await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));

    const readApprovals = createApprovalReader(background.runtime);
    expect(capturedApprovalId).toBeTruthy();
    await expect(readApprovals.getDetail(capturedApprovalId ?? "")).resolves.toMatchObject({
      kind: ApprovalKinds.SendTransaction,
      actions: {
        canApprove: true,
      },
      review: {
        prepare: {
          state: "ready",
        },
      },
    });

    const approval = background.runtime.services.approvals.get(capturedApprovalId ?? "");
    if (!approval) {
      throw new Error("Missing transaction approval.");
    }

    await background.runtime.services.approvals.resolve({
      approvalId: capturedApprovalId ?? "",
      action: "approve",
    });

    await expect(pendingResponse).resolves.toMatchObject({
      id: "rpc-send-ready",
      jsonrpc: "2.0",
      result: txHash,
    });
    expect(createBroadcastArtifact).toHaveBeenCalledTimes(1);
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps eth_sendTransaction lifecycle running when the provider scope is lost during broadcast", async () => {
    const chain = createChainDefinition({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
    });
    let releaseBroadcast = () => {};
    const broadcastReleased = new Promise<void>((resolve) => {
      releaseBroadcast = resolve;
    });
    const txHash = "0x1919191919191919191919191919191919191919191919191919191919191919";
    const broadcastTransaction = vi.fn<NamespaceTransactionSubmission["broadcast"]>(async (context) => {
      await broadcastReleased;
      return {
        broadcastIdentity: { hash: txHash },
        submitted: buildEip155Submitted({
          txHash,
          from: context.from,
          prepared: context.approvedPayload as Record<string, unknown>,
        }),
      };
    });
    const namespaceTransactions = new NamespaceTransactions([
      [
        getChainRefNamespace(chain.chainRef),
        createNamespaceTransactionMock({
          prepareTransaction: vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
            status: "ready",
            prepared: { nonce: "0x9" },
          })),
          broadcastTransaction,
        }),
      ],
    ]);
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = background.enableAutoApproval();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain: activeChain, address } = await deriveActiveAccount(background.runtime);
      await grantProviderPermission(background.runtime, {
        origin: ORIGIN,
        chainRef: activeChain.chainRef,
        address,
      });
      await activateProviderConnectionScope(background.runtime, { namespace: activeChain.namespace });

      const pendingResponse = requestProviderRpc(background.runtime, {
        id: "rpc-send-broadcast-cancelled",
        method: "eth_sendTransaction",
        namespace: activeChain.namespace,
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
      });

      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));
      await expect(
        background.runtime.providerAccess.cancelRequestScope({
          transport: "provider",
          origin: ORIGIN,
          portId: "port-1",
          sessionId: "session-1",
        }),
      ).resolves.toBe(1);

      releaseBroadcast();

      await expect(pendingResponse).resolves.toMatchObject({
        id: "rpc-send-broadcast-cancelled",
        jsonrpc: "2.0",
        error: {
          kind: "ArxError",
          code: "global.transport.disconnected",
        },
      });
      await vi.waitFor(async () => {
        await expect(background.runtime.transactions.listTransactions()).resolves.toEqual([
          expect.objectContaining({
            status: "submitted",
            submitted: expect.objectContaining({
              hash: txHash,
            }),
          }),
        ]);
      });
    } finally {
      releaseBroadcast();
      unsubscribeAutoApproval();
    }
  });

  it("keeps eth_sendTransaction lifecycle running when the provider scope is lost during broadcast artifact creation", async () => {
    const chain = createChainDefinition({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
    });
    let releaseSign = () => {};
    const signReleased = new Promise<void>((resolve) => {
      releaseSign = resolve;
    });
    const createBroadcastArtifact = vi.fn<NamespaceTransactionSubmission["createBroadcastArtifact"]>(async () => {
      await signReleased;
      return {
        kind: "test.signed_transaction",
        payload: { raw: "0x1111" },
      };
    });
    const txHash = "0x3333333333333333333333333333333333333333333333333333333333333333";
    const broadcastTransaction = vi.fn<NamespaceTransactionSubmission["broadcast"]>(async (context) => ({
      broadcastIdentity: { hash: txHash },
      submitted: buildEip155Submitted({
        txHash,
        from: context.from,
        prepared: context.approvedPayload as Record<string, unknown>,
      }),
    }));
    const namespaceTransactions = new NamespaceTransactions([
      [
        getChainRefNamespace(chain.chainRef),
        createNamespaceTransactionMock({
          prepareTransaction: vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
            status: "ready",
            prepared: { nonce: "0xa" },
          })),
          createBroadcastArtifact,
          broadcastTransaction,
        }),
      ],
    ]);
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = background.enableAutoApproval();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain: activeChain, address } = await deriveActiveAccount(background.runtime);
      await grantProviderPermission(background.runtime, {
        origin: ORIGIN,
        chainRef: activeChain.chainRef,
        address,
      });
      await activateProviderConnectionScope(background.runtime, { namespace: activeChain.namespace });

      const pendingResponse = requestProviderRpc(background.runtime, {
        id: "rpc-send-sign-cancelled",
        method: "eth_sendTransaction",
        namespace: activeChain.namespace,
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
      });

      await vi.waitFor(() => expect(createBroadcastArtifact).toHaveBeenCalledTimes(1));
      await expect(
        background.runtime.providerAccess.cancelRequestScope({
          transport: "provider",
          origin: ORIGIN,
          portId: "port-1",
          sessionId: "session-1",
        }),
      ).resolves.toBe(1);

      releaseSign();
      const response = await pendingResponse;

      expect(response).toMatchObject({
        id: "rpc-send-sign-cancelled",
        jsonrpc: "2.0",
        error: {
          kind: "ArxError",
          code: "global.transport.disconnected",
        },
      });
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(async () => {
        await expect(background.runtime.transactions.listTransactions()).resolves.toEqual([
          expect.objectContaining({
            status: "submitted",
          }),
        ]);
      });
    } finally {
      releaseSign();
      unsubscribeAutoApproval();
    }
  });

  it("returns eth_sendTransaction failure when broadcast fails and does not create a success record", async () => {
    const chain = createChainDefinition({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionSubmission["broadcast"]>(async () => {
      throw new Error("RPC unavailable");
    });
    const namespaceTransactions = new NamespaceTransactions([
      [
        getChainRefNamespace(chain.chainRef),
        createNamespaceTransactionMock({
          prepareTransaction: vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
            status: "ready",
            prepared: {},
          })),
          broadcastTransaction,
        }),
      ],
    ]);
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = background.enableAutoApproval();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain: activeChain, address } = await deriveActiveAccount(background.runtime);
      await grantProviderPermission(background.runtime, {
        origin: ORIGIN,
        chainRef: activeChain.chainRef,
        address,
      });
      await activateProviderConnectionScope(background.runtime, { namespace: activeChain.namespace });

      await expect(
        requestProviderRpc(background.runtime, {
          id: "rpc-send-broadcast-fail",
          method: "eth_sendTransaction",
          namespace: activeChain.namespace,
          params: [
            {
              from: address,
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0x0",
            },
          ],
        }),
      ).resolves.toMatchObject({
        id: "rpc-send-broadcast-fail",
        jsonrpc: "2.0",
        error: {
          kind: "ArxError",
          code: "global.rpc.internal",
        },
      });

      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      await expect(background.runtime.transactions.listTransactions()).resolves.toEqual([
        expect.objectContaining({
          status: "failed",
          submitted: null,
          terminalReason: expect.objectContaining({
            kind: "broadcast_failed",
            code: "eip155.broadcast",
            message: "RPC unavailable",
          }),
        }),
      ]);
    } finally {
      unsubscribeAutoApproval();
    }
  });

  it("returns internal core error envelopes when provider requests fail", async () => {
    const runtime = await setupNamespaceAwareProviderAccess();

    await expect(
      requestProviderRpc(runtime, {
        id: "rpc-sol-1",
        method: "sol_getBalance",
        namespace: "solana",
      }),
    ).resolves.toEqual({
      id: "rpc-sol-1",
      jsonrpc: "2.0",
      error: {
        kind: "ArxError",
        code: "chain.not_supported",
      },
    });
  });
});
