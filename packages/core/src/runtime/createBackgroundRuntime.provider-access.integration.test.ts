import { ArxReasons, arxError, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import { ApprovalKinds } from "../controllers/approval/types.js";
import { defineNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type {
  NamespaceTransaction,
  NamespaceTransactionExecution,
  NamespaceTransactionProposal,
  NamespaceTransactionTracking,
} from "../transactions/namespace/types.js";
import { createApprovalReadService } from "../ui/server/approvals/readService.js";
import type { CreateBackgroundRuntimeResult } from "./__fixtures__/backgroundTestSetup.js";
import {
  createChainMetadata,
  flushAsync,
  MemoryAccountsPort,
  MemoryCustomChainsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkSelectionPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
  setupBackground,
  TEST_MNEMONIC,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

const PASSWORD = "secret-pass";
const ORIGIN = "https://dapp.example";
const SOLANA_CHAIN: ChainMetadata = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
};

const initializeUnlockedSession = async (runtime: CreateBackgroundRuntimeResult) => {
  await runtime.services.session.createVault({ password: PASSWORD });
  await runtime.services.session.unlock.unlock({ password: PASSWORD });
};

const deriveActiveAccount = async (runtime: CreateBackgroundRuntimeResult) => {
  const chain = runtime.services.chainViews.getSelectedChainView();
  const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
  const account = await runtime.services.keyring.deriveAccount(keyringId);

  await runtime.controllers.accounts.setActiveAccount({
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
  const chain = runtime.controllers?.supportedChains?.getChain(input.chainRef)?.metadata;
  if (!chain) {
    throw new Error(`Missing chain metadata for ${input.chainRef}`);
  }

  await runtime.controllers.permissions.grantAuthorization(input.origin, {
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
  signTransaction?: NamespaceTransactionExecution["sign"];
  broadcastTransaction?: NamespaceTransactionExecution["broadcast"];
  tracking?: NamespaceTransactionTracking;
}): NamespaceTransaction => ({
  proposal: {
    prepare: params.prepareTransaction,
  },
  execution: {
    sign: params.signTransaction ?? vi.fn(async () => ({ raw: "0x1111" })),
    broadcast:
      params.broadcastTransaction ??
      vi.fn(async (ctx, _signed, prepared) => {
        const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
        return {
          submitted: buildEip155Submitted({
            txHash,
            from: ctx.from ?? "0x0000000000000000000000000000000000000000",
            prepared: prepared as Record<string, unknown>,
          }),
          locator: {
            format: "eip155.tx_hash",
            value: txHash,
          },
        };
      }),
  },
  ...(params.tracking ? { tracking: params.tracking } : { tracking: { fetchReceipt: vi.fn(async () => null) } }),
});

const createApprovalReader = (runtime: CreateBackgroundRuntimeResult) =>
  createApprovalReadService({
    approvals: runtime.controllers.approvals,
    accounts: runtime.controllers.accounts,
    chainViews: runtime.services.chainViews,
    transactions: runtime.controllers.transactions,
  });

const buildProviderContext = (input: {
  chainRef: string;
  namespace: string;
  origin?: string;
  portId?: string;
  sessionId?: string;
}) => {
  return {
    providerNamespace: input.namespace,
    chainRef: input.chainRef,
    requestScope: {
      transport: "provider" as const,
      origin: input.origin ?? ORIGIN,
      portId: input.portId ?? "port-1",
      sessionId: input.sessionId ?? "session-1",
    },
  };
};

const createProtocolAdapter = (namespace: string): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: -32603, message: `${namespace}:dapp` }),
});

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
  protocolAdapter: createProtocolAdapter(namespace),
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
      chainSeeds: [SOLANA_CHAIN],
    },
  } satisfies NamespaceManifest);
})();

const setupNamespaceAwareProviderRuntime = async () => {
  const mainnetChain = createChainMetadata();
  const customChainsPort = new MemoryCustomChainsPort();
  const runtime = createBackgroundRuntime({
    supportedChains: {
      port: customChainsPort,
      seed: [mainnetChain, SOLANA_CHAIN],
    },
    namespaces: {
      manifests: [eip155NamespaceManifest, solanaNamespaceManifest],
    },
    rpcEngine: {
      env: {
        isInternalOrigin: () => false,
        shouldRequestUnlockAttention: () => false,
      },
    },
    networkSelection: { port: new MemoryNetworkSelectionPort() },
    store: {
      ports: {
        customChains: customChainsPort,
        permissions: new MemoryPermissionsPort(),
        transactions: new MemoryTransactionsPort(),
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

describe("createBackgroundRuntime provider access", () => {
  it("builds namespace-scoped snapshots and hides permitted accounts while locked", async () => {
    const background = await setupBackground();

    try {
      const snapshot = background.runtime.providerAccess.buildSnapshot("eip155");

      expect(snapshot).toEqual({
        namespace: "eip155",
        chain: {
          chainId: "0x1",
          chainRef: "eip155:1",
        },
        isUnlocked: false,
        meta: {
          activeChainByNamespace: {
            eip155: "eip155:1",
          },
          supportedChains: ["eip155:1"],
        },
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

  it("builds handshake connection state from one unlock snapshot", async () => {
    const background = await setupBackground();

    try {
      const lockedState = await background.runtime.providerAccess.buildConnectionState({
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
          meta: {
            activeChainByNamespace: {
              eip155: "eip155:1",
            },
            supportedChains: ["eip155:1"],
          },
        },
        accounts: [],
      });

      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);

      await background.runtime.controllers.permissions.grantAuthorization(ORIGIN, {
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

  it("formats permitted accounts for an unlocked authorized origin and re-checks lock state on each call", async () => {
    const background = await setupBackground();

    try {
      await initializeUnlockedSession(background.runtime);
      const { chain, address } = await deriveActiveAccount(background.runtime);
      const unlockedSnapshot = background.runtime.providerAccess.buildSnapshot(chain.namespace);

      await background.runtime.controllers.permissions.grantAuthorization(ORIGIN, {
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

      await background.runtime.controllers.permissions.grantAuthorization(ORIGIN, {
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

      const response = await background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-1",
        jsonrpc: "2.0",
        method: "eth_accounts",
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: chain.namespace,
          chainRef: chain.chainRef,
        }),
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

      let approvalCreatedResolve: (() => void) | null = null;
      let capturedApprovalRequesterId: string | null = null;
      const approvalCreated = new Promise<void>((resolve) => {
        approvalCreatedResolve = resolve;
      });
      const unsubscribe = background.runtime.controllers.approvals.onCreated(({ record }) => {
        capturedApprovalRequesterId = record.requester.requestId;
        approvalCreatedResolve?.();
      });

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-2",
        jsonrpc: "2.0",
        method: "eth_requestAccounts",
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: chain.namespace,
          chainRef: chain.chainRef,
        }),
      });

      await approvalCreated;
      await flushAsync();
      expect(background.runtime.controllers.approvals.getState().pending).toHaveLength(1);
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
          code: 4900,
        },
      });
      expect(background.runtime.controllers.approvals.getState().pending).toHaveLength(0);

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

      await background.runtime.controllers.permissions.grantAuthorization(ORIGIN, {
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

      let approvalCreatedResolve: (() => void) | null = null;
      let capturedApprovalId: string | null = null;
      let capturedTransactionId: string | null = null;
      const approvalCreated = new Promise<void>((resolve) => {
        approvalCreatedResolve = resolve;
      });
      const unsubscribe = background.runtime.controllers.approvals.onCreated(({ record }) => {
        capturedApprovalId = record.approvalId;
        capturedTransactionId = record.kind === "sendTransaction" ? record.subject.transactionId : null;
        approvalCreatedResolve?.();
      });

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-3",
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: chain.namespace,
          chainRef: chain.chainRef,
        }),
      });

      await approvalCreated;
      await flushAsync();
      expect(capturedApprovalId).toBeTruthy();
      expect(background.runtime.controllers.approvals.getState().pending).toHaveLength(1);

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
          code: 4900,
        },
      });
      expect(background.runtime.controllers.approvals.getState().pending).toHaveLength(0);
      expect(
        capturedTransactionId ? background.runtime.controllers.transactions.getProposalView(capturedTransactionId) : undefined,
      ).toMatchObject({
        id: capturedTransactionId,
        phase: "failed",
        failure: {
          userRejected: false,
        },
      });

      unsubscribe();
    } finally {
      background.destroy();
    }
  });

  it("exposes eth_sendTransaction approval detail before prepare is ready and completes after ready approval", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    let releasePrepare: (() => void) | null = null;
    const prepareReleased = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => {
      await prepareReleased;
      return {
        status: "ready",
        prepared: {
          gas: "0x5208",
          nonce: "0x7",
        },
      };
    });
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({ raw: "0x1111" }));
    const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash,
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: txHash,
      },
    }));
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(
      chain.namespace,
      createNamespaceTransactionMock({
        prepareTransaction,
        signTransaction,
        broadcastTransaction,
      }),
    );
    const background = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });

    let capturedApprovalId: string | null = null;
    const approvalCreated = new Promise<void>((resolve) => {
      const unsubscribe = background.runtime.controllers.approvals.onCreated(({ record }) => {
        if (record.kind !== ApprovalKinds.SendTransaction) {
          return;
        }
        capturedApprovalId = record.approvalId;
        unsubscribe();
        resolve();
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

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-send-ready",
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: activeChain.namespace,
          chainRef: activeChain.chainRef,
        }),
      });

      await approvalCreated;
      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));

      const readApprovals = createApprovalReader(background.runtime);
      expect(capturedApprovalId).toBeTruthy();
      expect(readApprovals.getDetail(capturedApprovalId ?? "")).toMatchObject({
        kind: ApprovalKinds.SendTransaction,
        actions: {
          canApprove: false,
          canReject: true,
        },
        review: {
          prepare: {
            state: "preparing",
          },
        },
      });

      releasePrepare?.();
      await vi.waitFor(() =>
        expect(readApprovals.getDetail(capturedApprovalId ?? "")).toMatchObject({
          kind: ApprovalKinds.SendTransaction,
          actions: {
            canApprove: true,
          },
          review: {
            prepare: {
              state: "ready",
            },
          },
        }),
      );

      await background.runtime.controllers.approvals.resolve({
        approvalId: capturedApprovalId ?? "",
        action: "approve",
      });

      await expect(pendingResponse).resolves.toMatchObject({
        id: "rpc-send-ready",
        jsonrpc: "2.0",
        result: txHash,
      });
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    } finally {
      releasePrepare?.();
      background.destroy();
    }
  });

  it("keeps eth_sendTransaction successful when the provider scope is lost during broadcast", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    let releaseBroadcast: (() => void) | null = null;
    const broadcastReleased = new Promise<void>((resolve) => {
      releaseBroadcast = resolve;
    });
    const txHash = "0x1919191919191919191919191919191919191919191919191919191919191919";
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => {
      await broadcastReleased;
      return {
        submitted: buildEip155Submitted({
          txHash,
          from: ctx.from ?? "0x0000000000000000000000000000000000000000",
          prepared: prepared as Record<string, unknown>,
        }),
        locator: {
          format: "eip155.tx_hash",
          value: txHash,
        },
      };
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(
      chain.namespace,
      createNamespaceTransactionMock({
        prepareTransaction: vi.fn(async () => ({ status: "ready", prepared: { nonce: "0x9" } })),
        broadcastTransaction,
      }),
    );
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

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-send-broadcast-cancelled",
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: activeChain.namespace,
          chainRef: activeChain.chainRef,
        }),
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

      releaseBroadcast?.();

      await expect(pendingResponse).resolves.toMatchObject({
        id: "rpc-send-broadcast-cancelled",
        jsonrpc: "2.0",
        result: txHash,
      });
      await vi.waitFor(async () => {
        const records = await background.transactionsPort.list();
        expect(records).toHaveLength(1);
      });
    } finally {
      releaseBroadcast?.();
      unsubscribeAutoApproval();
      background.destroy();
    }
  });

  it("stops eth_sendTransaction before broadcast when the provider scope is lost during signing", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    let releaseSign: (() => void) | null = null;
    const signReleased = new Promise<void>((resolve) => {
      releaseSign = resolve;
    });
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => {
      await signReleased;
      return { raw: "0x1111" };
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async () => ({
      submitted: buildEip155Submitted({
        txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        from: "0x0000000000000000000000000000000000000000",
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x3333333333333333333333333333333333333333333333333333333333333333",
      },
    }));
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(
      chain.namespace,
      createNamespaceTransactionMock({
        prepareTransaction: vi.fn(async () => ({ status: "ready", prepared: { nonce: "0xa" } })),
        signTransaction,
        broadcastTransaction,
      }),
    );
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

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-send-sign-cancelled",
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: activeChain.namespace,
          chainRef: activeChain.chainRef,
        }),
      });

      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
      await expect(
        background.runtime.providerAccess.cancelRequestScope({
          transport: "provider",
          origin: ORIGIN,
          portId: "port-1",
          sessionId: "session-1",
        }),
      ).resolves.toBe(1);

      releaseSign?.();
      const response = await pendingResponse;

      expect(response).toMatchObject({
        id: "rpc-send-sign-cancelled",
        jsonrpc: "2.0",
        error: {
          code: 4900,
        },
      });
      expect(broadcastTransaction).not.toHaveBeenCalled();
    } finally {
      releaseSign?.();
      unsubscribeAutoApproval();
      background.destroy();
    }
  });

  it("returns eth_sendTransaction success after broadcast even when local transaction persistence fails", async () => {
    class FailingCreateTransactionsPort extends MemoryTransactionsPort {
      createCalls = 0;

      async create(_record: Parameters<MemoryTransactionsPort["create"]>[0]): Promise<void> {
        this.createCalls += 1;
        throw new Error("Local transaction store unavailable");
      }
    }

    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const txHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    let releaseBroadcast: (() => void) | null = null;
    const broadcastReleased = new Promise<void>((resolve) => {
      releaseBroadcast = resolve;
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => {
      await broadcastReleased;
      return {
        submitted: buildEip155Submitted({
          txHash,
          from: ctx.from ?? "0x0000000000000000000000000000000000000000",
          prepared: prepared as Record<string, unknown>,
        }),
        locator: {
          format: "eip155.tx_hash",
          value: txHash,
        },
      };
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(
      chain.namespace,
      createNamespaceTransactionMock({
        prepareTransaction: vi.fn(async () => ({ status: "ready", prepared: { nonce: "0x7" } })),
        broadcastTransaction,
      }),
    );
    const transactionsPort = new FailingCreateTransactionsPort();
    const background = await setupBackground({
      chainSeed: [chain],
      transactionsPort,
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    let capturedTransactionId: string | null = null;
    const unsubscribeApprovalCreated = background.runtime.controllers.approvals.onCreated(({ record }) => {
      capturedTransactionId = record.kind === ApprovalKinds.SendTransaction ? record.subject.transactionId : null;
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

      const pendingResponse = background.runtime.providerAccess.executeRpcRequest({
        id: "rpc-send-persist-fail",
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        ],
        origin: ORIGIN,
        context: buildProviderContext({
          namespace: activeChain.namespace,
          chainRef: activeChain.chainRef,
        }),
      });

      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));
      await flushAsync();
      releaseBroadcast?.();

      await expect(pendingResponse).resolves.toMatchObject({
        id: "rpc-send-persist-fail",
        jsonrpc: "2.0",
        result: txHash,
      });

      await vi.waitFor(() => expect(transactionsPort.createCalls).toBe(1));
      await expect(transactionsPort.list()).resolves.toEqual([]);
      expect(capturedTransactionId).toBeTruthy();
      expect(
        capturedTransactionId ? background.runtime.controllers.transactions.getProposalView(capturedTransactionId) : null,
      ).toMatchObject({
        phase: "unpersisted",
        failure: {
          error: {
            name: "TransactionPersistenceError",
            data: {
              submitted: {
                hash: txHash,
              },
              locator: {
                format: "eip155.tx_hash",
                value: txHash,
              },
            },
          },
        },
      });
      const persistenceFailureView = capturedTransactionId
        ? background.runtime.controllers.transactions.getProposalView(capturedTransactionId)
        : null;
      expect(persistenceFailureView).toBeTruthy();
    } finally {
      releaseBroadcast?.();
      unsubscribeAutoApproval();
      unsubscribeApprovalCreated();
      background.destroy();
    }
  });

  it("returns eth_sendTransaction failure when broadcast fails and does not create a success record", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async () => {
      throw new Error("RPC unavailable");
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(
      chain.namespace,
      createNamespaceTransactionMock({
        prepareTransaction: vi.fn(async () => ({ status: "ready", prepared: {} })),
        broadcastTransaction,
      }),
    );
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

      await expect(
        background.runtime.providerAccess.executeRpcRequest({
          id: "rpc-send-broadcast-fail",
          jsonrpc: "2.0",
          method: "eth_sendTransaction",
          params: [
            {
              from: address,
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0x0",
            },
          ],
          origin: ORIGIN,
          context: buildProviderContext({
            namespace: activeChain.namespace,
            chainRef: activeChain.chainRef,
          }),
        }),
      ).resolves.toMatchObject({
        id: "rpc-send-broadcast-fail",
        jsonrpc: "2.0",
        error: {
          code: -32603,
        },
      });

      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      await expect(background.transactionsPort.list()).resolves.toEqual([]);
    } finally {
      unsubscribeAutoApproval();
      background.destroy();
    }
  });

  it("encodes namespace-aware provider errors directly", async () => {
    const runtime = await setupNamespaceAwareProviderRuntime();

    try {
      expect(
        runtime.providerAccess.encodeRpcError(arxError({ reason: ArxReasons.PermissionDenied, message: "denied" }), {
          origin: ORIGIN,
          method: "sol_getBalance",
          rpcContext: buildProviderContext({
            namespace: "solana",
            chainRef: SOLANA_CHAIN.chainRef,
          }),
        }),
      ).toEqual({
        code: -32603,
        message: "solana:dapp",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("returns namespace-aware error responses when provider requests fail", async () => {
    const runtime = await setupNamespaceAwareProviderRuntime();

    try {
      await expect(
        runtime.providerAccess.executeRpcRequest({
          id: "rpc-sol-1",
          jsonrpc: "2.0",
          method: "sol_getBalance",
          origin: ORIGIN,
          context: buildProviderContext({
            namespace: "solana",
            chainRef: SOLANA_CHAIN.chainRef,
          }),
        }),
      ).resolves.toEqual({
        id: "rpc-sol-1",
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "solana:dapp",
        },
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });
});
