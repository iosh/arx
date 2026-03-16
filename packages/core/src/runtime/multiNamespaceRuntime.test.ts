import { ArxReasons, type NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import { defineNamespaceManifest, eip155NamespaceManifest, type NamespaceManifest } from "../namespaces/index.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { ChainDefinitionEntity } from "../storage/index.js";
import {
  MemoryAccountsPort,
  MemoryChainDefinitionsPort,
  MemoryKeyringMetasPort,
  MemoryNetworkPreferencesPort,
  MemoryPermissionsPort,
  MemorySettingsPort,
  MemoryTransactionsPort,
} from "./__fixtures__/backgroundTestSetup.js";
import { createBackgroundRuntime } from "./createBackgroundRuntime.js";

const MAINNET_CHAIN: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.mainnet", type: "public" }],
};

const SOLANA_CHAIN: ChainMetadata = {
  chainRef: "solana:101",
  namespace: "solana",
  chainId: "101",
  displayName: "Solana",
  nativeCurrency: { name: "SOL", symbol: "SOL", decimals: 9 },
  rpcEndpoints: [{ url: "https://rpc.solana", type: "public" }],
};

const toRegistryEntity = (metadata: ChainMetadata, now: number): ChainDefinitionEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  schemaVersion: 2,
  updatedAt: now,
  source: "builtin",
});

const createProtocolAdapter = (namespace: string): NamespaceProtocolAdapter => ({
  encodeDappError: () => ({ code: -32603, message: `${namespace}:dapp` }),
  encodeUiError: () => ({ reason: ArxReasons.RpcInternal, message: `${namespace}:ui` }),
});

const createTestAccountCodec = (namespace: string): AccountCodec => ({
  namespace,
  toCanonicalAddress: () => ({ namespace, bytes: Uint8Array.from([1, 2, 3]) }),
  toCanonicalString: () => `${namespace}:canonical`,
  toDisplayAddress: () => `${namespace}:display`,
  toAccountId: () => `${namespace}:010203`,
  fromAccountId: () => ({ namespace, bytes: Uint8Array.from([1, 2, 3]) }),
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

describe("createBackgroundRuntime multi-namespace assembly", () => {
  it("assembles a second namespace without falling back to eip155 runtime defaults", async () => {
    const runtime = createBackgroundRuntime({
      chainDefinitions: {
        port: new MemoryChainDefinitionsPort([toRegistryEntity(MAINNET_CHAIN, 0), toRegistryEntity(SOLANA_CHAIN, 0)]),
        seed: [MAINNET_CHAIN, SOLANA_CHAIN],
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

    expect(runtime.rpc.registry.getRegisteredNamespaces()).toEqual(["eip155", "solana"]);
    expect(runtime.services.networkPreferences.getActiveChainByNamespace()).toEqual({
      eip155: MAINNET_CHAIN.chainRef,
      solana: SOLANA_CHAIN.chainRef,
    });
    expect(runtime.services.keyring.getNamespaces().map((entry) => entry.namespace)).toEqual(["eip155", "solana"]);
    expect(runtime.rpc.registry.resolveInvocation(runtime.controllers, "sol_getBalance", undefined)).toEqual({
      namespace: "solana",
      chainRef: SOLANA_CHAIN.chainRef,
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    expect(runtime.services.chainViews.getProviderChainView("solana").chainRef).toBe(SOLANA_CHAIN.chainRef);
    expect(runtime.services.namespaceBindings.getUi("solana")).toBeUndefined();
    expect(runtime.services.namespaceBindings.hasTransaction("solana")).toBe(false);
    expect(runtime.controllers.signers.listNamespaces()).toEqual(["eip155"]);

    runtime.lifecycle.destroy();
  });
});
