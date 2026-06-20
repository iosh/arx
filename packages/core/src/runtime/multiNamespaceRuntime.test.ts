import { describe, expect, it } from "vitest";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainDefinitionSeed } from "../chains/definition.js";
import type { ChainRef } from "../chains/ids.js";
import { type ChainMetadata, deriveChainDefinitionFromMetadata, type RpcEndpoint } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import { defineNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
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
  MemorySettingsPort,
  MemoryTransactionAggregatesPort,
  MemoryWalletChainSelectionPort,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

type TestChain = ChainMetadata & {
  defaultRpcEndpoints: readonly RpcEndpoint[];
};

const toChainSeed = (chain: TestChain): ChainDefinitionSeed<RpcEndpoint> => ({
  definition: deriveChainDefinitionFromMetadata(chain),
  defaultRpcEndpoints: chain.defaultRpcEndpoints,
});

const MAINNET_CHAIN: TestChain = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  defaultRpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const SOLANA_CHAIN: TestChain = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  defaultRpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
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

const createTestNamespaceTransaction = (): NamespaceTransaction => ({
  proposal: {
    prepare: async () => ({ status: "ready", prepared: {} }),
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
    runtime: {
      createSigner: () => ({}),
      createTransaction: () => createTestNamespaceTransaction(),
    },
  } satisfies NamespaceManifest);
})();

describe("createBackgroundRuntime multi-namespace assembly", () => {
  it("assembles a second namespace without falling back to eip155 runtime defaults", async () => {
    const chainDefinitionsPort = new MemoryChainDefinitionsPort();
    const runtime = createBackgroundRuntime({
      supportedChains: {
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
      settings: { port: new MemorySettingsPort({ id: "settings", updatedAt: 0 }) },
    });

    expect(runtime.rpc.registry.getRegisteredNamespaces()).toEqual(["eip155", "solana"]);
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
    expect(runtime.services.namespaceRuntimeSupport.get("eip155")).toMatchObject({
      namespace: "eip155",
      hasRpcClient: true,
      hasSigner: true,
      hasApprovalBindings: true,
      hasUiBindings: true,
      hasTransactionReceiptTracking: true,
    });
    expect(runtime.services.namespaceRuntimeSupport.get("solana")).toMatchObject({
      namespace: "solana",
      hasRpcClient: false,
      hasSigner: true,
      hasApprovalBindings: false,
      hasUiBindings: false,
      hasTransactionReceiptTracking: false,
    });
    expect(runtime.services.namespaceBindings.getUi("solana")).toBeUndefined();
    runtime.lifecycle.shutdown();
  });
});
