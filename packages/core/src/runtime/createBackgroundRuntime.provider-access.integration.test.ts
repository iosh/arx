import { ArxReasons, arxError, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import { defineNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { CreateBackgroundRuntimeResult } from "./__fixtures__/backgroundTestSetup.js";
import {
  createChainMetadata,
  flushAsync,
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
  setupBackground,
  TEST_MNEMONIC,
  toRegistryEntity,
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

const buildProviderContext = (input: {
  chainRef: string;
  namespace: string;
  origin?: string;
  portId?: string;
  sessionId?: string;
  requestId?: string;
}) => {
  return {
    providerNamespace: input.namespace,
    chainRef: input.chainRef,
    requestContext: {
      transport: "provider" as const,
      origin: input.origin ?? ORIGIN,
      portId: input.portId ?? "port-1",
      sessionId: input.sessionId ?? "session-1",
      requestId: input.requestId ?? "request-1",
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
  const runtime = createBackgroundRuntime({
    chainDefinitions: {
      port: new MemoryChainDefinitionsPort([toRegistryEntity(mainnetChain, 0), toRegistryEntity(SOLANA_CHAIN, 0)]),
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
    networkPreferences: { port: new MemoryNetworkPreferencesPort() },
    store: {
      ports: {
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
          requestId: "rpc-1",
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

      const connection = background.runtime.services.permissionViews.getConnectionSnapshot(ORIGIN, {
        chainRef: chain.chainRef,
      });
      expect(connection.isConnected).toBe(true);
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
      const approvalCreated = new Promise<void>((resolve) => {
        approvalCreatedResolve = resolve;
      });
      const unsubscribe = background.runtime.controllers.approvals.onCreated(() => {
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
          requestId: "rpc-2",
        }),
      });

      await approvalCreated;
      await flushAsync();
      expect(background.runtime.controllers.approvals.getState().pending).toHaveLength(1);

      await expect(
        background.runtime.providerAccess.cancelSessionApprovals({
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
            requestId: "rpc-sol-encode",
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
            requestId: "rpc-sol-1",
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
