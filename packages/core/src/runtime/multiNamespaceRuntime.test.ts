import { describe, expect, it } from "vitest";
import type { NamespaceAccountAddressing } from "../accounts/addressing/addressing.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import { type ChainDefinition, cloneChainDefinition, type RpcEndpoint } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import type { NamespaceChainAddressing } from "../chains/types.js";
import { eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import { listRpcNamespaces } from "../rpc/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { NamespaceTransaction } from "../transactions/index.js";
import {
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
  MemoryChainRpcEndpointOverridesPort,
  MemoryKeyringMetasPort,
  MemoryPermissionsPort,
  MemoryProviderChainSelectionPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

type TestChain = ChainDefinition & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const toChainSeed = (chain: TestChain): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: cloneChainDefinition(chain),
  defaultRpcEndpoints: chain.defaultRpcEndpoints,
});

const MAINNET_CHAIN: TestChain = {
  chainRef: "eip155:1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const SOLANA_CHAIN: TestChain = {
  chainRef: "solana:101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  defaultRpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
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
        factories: {},
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

describe("createBackgroundRuntime multi-namespace assembly", () => {
  it("assembles a second namespace without falling back to eip155 runtime defaults", async () => {
    const chainDefinitionsPort = new MemoryChainDefinitionsPort();
    const runtime = createBackgroundRuntime({
      chainDefinitions: {
        seed: [toChainSeed(MAINNET_CHAIN), toChainSeed(SOLANA_CHAIN)],
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

    expect(listRpcNamespaces(runtime.rpc.routing)).toEqual(["eip155", "solana"]);
    expect(runtime.services.walletChainSelection.getChainRefByNamespace()).toEqual({
      eip155: MAINNET_CHAIN.chainRef,
      solana: SOLANA_CHAIN.chainRef,
    });
    expect(runtime.services.keyring.getNamespaces().map((entry) => entry.namespace)).toEqual(["eip155", "solana"]);
    expect(runtime.rpc.resolveInvocation("sol_getBalance", undefined)).toEqual({
      namespace: "solana",
      chainRef: SOLANA_CHAIN.chainRef,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(runtime.services.chainViews.getActiveChainViewForNamespace("solana").chainRef).toBe(SOLANA_CHAIN.chainRef);
    expect(runtime.services.namespaceRuntime.ui.getNativeBalance).toEqual(expect.any(Function));
    runtime.lifecycle.shutdown();
  });
});
