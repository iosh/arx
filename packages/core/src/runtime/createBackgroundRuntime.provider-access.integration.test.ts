import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import { ApprovalKinds } from "../approvals/queue/types.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import { type ChainMetadata, deriveChainDefinitionFromMetadata, type RpcEndpoint } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import { defineNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import { NamespaceChainActivationReasons } from "../services/runtime/chainActivation/types.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type {
  NamespaceTransaction,
  NamespaceTransactionProposal,
  NamespaceTransactionSubmission,
  NamespaceTransactionTracking,
} from "../transactions/namespace/types.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import type { CreateBackgroundRuntimeResult } from "./__fixtures__/backgroundTestSetup.js";
import {
  createChainDefinitionSeed,
  createChainMetadata,
  flushAsync,
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
  setupBackground,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";
import type { ProviderConnectionStateChange } from "./provider/types.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";

type TestChain = ChainMetadata & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const toChainSeed = (chain: TestChain): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: deriveChainDefinitionFromMetadata(chain),
  defaultRpcEndpoints: chain.defaultRpcEndpoints,
});

const SOLANA_CHAIN: TestChain = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  defaultRpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
};
const EIP155_ALT_CHAIN = createChainMetadata({
  chainRef: "eip155:10",
  chainId: "0xa",
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
    namespace: chain.namespace,
    chainRef: chain.chainRef,
    accountKey: toAccountKeyFromAddress({
      chainRef: chain.chainRef,
      address: account.address,
      accountCodecs: runtime.services.accountCodecs,
    }),
  });

  return { chain, address: account.address };
};

const grantProviderPermission = async (
  runtime: CreateBackgroundRuntimeResult,
  input: { origin: string; chainRef: string; address: string },
) => {
  const chain = runtime.services.supportedChains.getChain(input.chainRef as ChainRef);
  if (!chain) {
    throw new Error(`Missing chain definition for ${input.chainRef}`);
  }

  await runtime.services.permissions.grantAuthorization(input.origin, {
    namespace: chain.namespace,
    chains: [
      {
        chainRef: input.chainRef,
        accountKeys: [
          toAccountKeyFromAddress({
            chainRef: input.chainRef,
            address: input.address,
            accountCodecs: runtime.services.accountCodecs,
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
    proposal: {
      prepare: params.prepareTransaction,
    },
    submission: {
      createBroadcastArtifact,
      broadcast: broadcastTransaction,
    },
    ...(params.tracking ? { tracking: params.tracking } : {}),
  };
};

const createApprovalReader = (runtime: CreateBackgroundRuntimeResult) =>
  createApprovalReadService({
    approvals: runtime.services.approvals,
    accounts: runtime.services.accounts,
    chainViews: runtime.services.chainViews,
    transactionApprovals: runtime.transactions,
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

const createTestAccountCodec = (namespace: string): AccountCodec => ({
  namespace,
  toCanonicalAddress: () => ({ namespace, bytes: Uint8Array.from([1, 2, 3]) }),
  toCanonicalString: () => `${namespace}:canonical`,
  toDisplayAddress: () => `${namespace}:display`,
  toAccountKey: () => `${namespace}:010203`,
  fromAccountKey: () => ({ namespace, bytes: Uint8Array.from([1, 2, 3]) }),
});

const createTestChainAddressCodec = (namespace: string): ChainAddressCodec => ({
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

const solanaNamespaceManifest = (() => {
  const namespace = "solana";
  const codec = createTestAccountCodec(namespace);

  return defineNamespaceManifest({
    namespace,
    core: {
      namespace,
      rpc: createTestRpcModule(namespace),
      chainAddressCodec: createTestChainAddressCodec(namespace),
      accountCodec: codec,
      keyring: {
        namespace,
        defaultChainRef: SOLANA_CHAIN.chainRef as ChainRef,
        codec,
        factories: {},
      },
      chainSeeds: [toChainSeed(SOLANA_CHAIN)],
    },
  } satisfies NamespaceManifest);
})();

const setupNamespaceAwareProviderRuntime = async () => {
  const chainDefinitionsPort = new MemoryChainDefinitionsPort();
  const runtime = createBackgroundRuntime({
    supportedChains: {
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
    settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
  });

  await runtime.lifecycle.initialize();
  runtime.lifecycle.start();

  return runtime;
};

const setupProviderConnectionStateRuntime = async () => {
  const background = await setupBackground({
    chainSeed: [createChainMetadata(), EIP155_ALT_CHAIN],
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

    try {
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
    } finally {
      background.destroy();
    }
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

    try {
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
    } finally {
      background.destroy();
    }
  });

  it("initializes provider chain selection on connection activation, not provider request execution", async () => {
    const background = await setupBackground({
      chainSeed: [createChainMetadata(), EIP155_ALT_CHAIN],
      walletChainSelectionSeed: {
        id: "wallet-chain-selection",
        selectedNamespace: "eip155",
        chainRefByNamespace: { eip155: EIP155_ALT_CHAIN.chainRef },
        updatedAt: 0,
      },
    });

    try {
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
    } finally {
      background.destroy();
    }
  });

  it("builds handshake connection state from one unlock snapshot", async () => {
    const background = await setupBackground();

    try {
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
        namespace: chain.namespace,
        chains: [
          {
            chainRef: chain.chainRef,
            accountKeys: [
              toAccountKeyFromAddress({
                chainRef: chain.chainRef,
                address,
                accountCodecs: background.runtime.services.accountCodecs,
              }),
            ],
          },
        ],
      });

      const unlockedState = await background.runtime.providerAccess.buildConnectionState({
        namespace: chain.namespace,
        origin: ORIGIN,
      });
      expect(unlockedState.snapshot.isUnlocked).toBe(true);
      expect(unlockedState.accounts.map((value) => value.toLowerCase())).toEqual([address.toLowerCase()]);
    } finally {
      background.destroy();
    }
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
      background.destroy();
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
      background.destroy();
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
      background.destroy();
    }
  });

  it("formats permitted accounts for an unlocked authorized origin and re-checks lock state on each call", async () => {
    const background = await setupBackground();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);
      await background.runtime.providerAccess.activateConnectionScope({
        origin: ORIGIN,
        namespace: chain.namespace,
      });
      const unlockedSnapshot = background.runtime.providerAccess.buildSnapshot({
        origin: ORIGIN,
        namespace: chain.namespace,
      });

      await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
        namespace: chain.namespace,
        chains: [
          {
            chainRef: chain.chainRef,
            accountKeys: [
              toAccountKeyFromAddress({
                chainRef: chain.chainRef,
                address,
                accountCodecs: background.runtime.services.accountCodecs,
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
    } finally {
      background.destroy();
    }
  });

  it("dispatches provider requests through the runtime pipeline", async () => {
    const background = await setupBackground();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);

      await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
        namespace: chain.namespace,
        chains: [
          {
            chainRef: chain.chainRef,
            accountKeys: [
              toAccountKeyFromAddress({
                chainRef: chain.chainRef,
                address,
                accountCodecs: background.runtime.services.accountCodecs,
              }),
            ],
          },
        ],
      });
      await activateProviderConnectionScope(background.runtime, { namespace: chain.namespace });

      const response = await requestProviderRpc(background.runtime, {
        id: "rpc-1",
        method: "eth_accounts",
        namespace: chain.namespace,
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
      expect(connection.accounts.map((account) => account.displayAddress.toLowerCase())).toContain(
        address.toLowerCase(),
      );
    } finally {
      background.destroy();
    }
  });

  it("cancels provider-scoped approvals via session scope", async () => {
    const background = await setupBackground();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain } = await deriveActiveAccount(background.runtime);
      await activateProviderConnectionScope(background.runtime, { namespace: chain.namespace });

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
        namespace: chain.namespace,
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
    } finally {
      background.destroy();
    }
  });

  it("cancels eth_sendTransaction approvals together with the provider request scope", async () => {
    const background = await setupBackground();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);

      await background.runtime.services.permissions.grantAuthorization(ORIGIN, {
        namespace: chain.namespace,
        chains: [
          {
            chainRef: chain.chainRef,
            accountKeys: [
              toAccountKeyFromAddress({
                chainRef: chain.chainRef,
                address,
                accountCodecs: background.runtime.services.accountCodecs,
              }),
            ],
          },
        ],
      });
      await activateProviderConnectionScope(background.runtime, { namespace: chain.namespace });

      let capturedApprovalId: string | null = null;
      const approvalCreated = new Promise<void>((resolve) => {
        const unsubscribeApprovalChange = background.runtime.transactions.onTransactionApprovalsChanged(
          (approvalIds) => {
            for (const approvalId of approvalIds) {
              const approval = background.runtime.transactions.getTransactionApproval(approvalId);
              if (!approval) {
                continue;
              }
              capturedApprovalId = approval.approvalId;
              unsubscribeApprovalChange();
              resolve();
              return;
            }
          },
        );
      });

      const pendingResponse = requestProviderRpc(background.runtime, {
        id: "rpc-3",
        method: "eth_sendTransaction",
        namespace: chain.namespace,
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
      expect(background.runtime.transactions.getTransactionApproval(capturedApprovalId ?? "")).toBeTruthy();

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
      expect(background.runtime.transactions.getTransactionApproval(capturedApprovalId ?? "")).toBeNull();
      await expect(background.runtime.transactions.listTransactions()).resolves.toEqual([]);
    } finally {
      background.destroy();
    }
  });

  it("exposes eth_sendTransaction approval detail and completes after ready approval", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
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
        chain.namespace,
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
      const unsubscribe = background.runtime.transactions.onTransactionApprovalsChanged((approvalIds) => {
        for (const approvalId of approvalIds) {
          const approval = background.runtime.transactions.getTransactionApproval(approvalId);
          if (!approval) {
            continue;
          }
          capturedApprovalId = approval.approvalId;
          unsubscribe();
          resolve();
          return;
        }
      });
    });

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

      const approval = background.runtime.transactions.getTransactionApproval(capturedApprovalId ?? "");
      if (!approval) {
        throw new Error("Missing transaction approval.");
      }

      await background.runtime.transactions.approveAndSubmitTransaction({
        approvalId: capturedApprovalId ?? "",
        expectedPrepareId: approval.prepare.id,
      });

      await expect(pendingResponse).resolves.toMatchObject({
        id: "rpc-send-ready",
        jsonrpc: "2.0",
        result: txHash,
      });
      expect(createBroadcastArtifact).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    } finally {
      background.destroy();
    }
  });

  it("keeps eth_sendTransaction lifecycle running when the provider scope is lost during broadcast", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
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
        chain.namespace,
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
      background.destroy();
    }
  });

  it("keeps eth_sendTransaction lifecycle running when the provider scope is lost during broadcast artifact creation", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
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
        chain.namespace,
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
      background.destroy();
    }
  });

  it("returns eth_sendTransaction failure when broadcast fails and does not create a success record", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionSubmission["broadcast"]>(async () => {
      throw new Error("RPC unavailable");
    });
    const namespaceTransactions = new NamespaceTransactions([
      [
        chain.namespace,
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
      background.destroy();
    }
  });

  it("returns internal core error envelopes when provider requests fail", async () => {
    const runtime = await setupNamespaceAwareProviderRuntime();

    try {
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
    } finally {
      runtime.lifecycle.shutdown();
    }
  });
});
