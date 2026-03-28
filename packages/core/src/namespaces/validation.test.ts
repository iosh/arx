import type { NamespaceProtocolAdapter } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { AccountCodec } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainMetadata } from "../chains/metadata.js";
import type { ChainAddressCodec } from "../chains/types.js";
import type { RpcNamespaceModule } from "../rpc/namespaces/types.js";
import type { NamespaceManifest } from "./types.js";
import { assertValidNamespaceManifest, defineNamespaceManifest } from "./validation.js";

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
    methodPrefixes: [`${namespace}_`],
    definitions: {},
  },
  protocolAdapter: createProtocolAdapter(namespace),
});

const createTestChainMetadata = (namespace: string, chainRef: ChainRef): ChainMetadata => ({
  chainRef,
  namespace,
  chainId: "101",
  displayName: `${namespace} Testnet`,
  nativeCurrency: { name: "Unit", symbol: "UNIT", decimals: 9 },
  rpcEndpoints: [{ url: `https://${namespace}.rpc.local` }],
});

const createTestManifest = (namespace = "solana"): NamespaceManifest => {
  const codec = createTestAccountCodec(namespace);
  const chainRef = `${namespace}:101` as ChainRef;

  return {
    namespace,
    core: {
      namespace,
      rpc: createTestRpcModule(namespace),
      chainAddressCodec: createTestChainAddressCodec(namespace),
      accountCodec: codec,
      keyring: {
        namespace,
        defaultChainRef: chainRef,
        codec,
        factories: {},
      },
      chainSeeds: [createTestChainMetadata(namespace, chainRef)],
    },
  };
};

describe("namespace manifest validation", () => {
  it("accepts aligned namespace manifests", () => {
    const manifest = createTestManifest("solana");

    expect(() => defineNamespaceManifest(manifest)).not.toThrow();
    expect(() => assertValidNamespaceManifest(manifest)).not.toThrow();
  });

  it("rejects rpc namespace drift inside a manifest", () => {
    const manifest = createTestManifest("solana");
    manifest.core.rpc = {
      ...manifest.core.rpc,
      namespace: "eip155",
    };

    expect(() => assertValidNamespaceManifest(manifest)).toThrow(/core\.rpc\.namespace/);
  });

  it("rejects keyring defaultChainRef drift inside a manifest", () => {
    const manifest = createTestManifest("solana");
    manifest.core.keyring = {
      ...manifest.core.keyring,
      defaultChainRef: "eip155:1",
    };

    expect(() => assertValidNamespaceManifest(manifest)).toThrow(/core\.keyring\.defaultChainRef/);
  });

  it("rejects chain seed drift inside a manifest", () => {
    const manifest = createTestManifest("solana");
    manifest.core.chainSeeds = [createTestChainMetadata("eip155", "eip155:1")];

    expect(() => assertValidNamespaceManifest(manifest)).toThrow(/core\.chainSeeds\[0\]\.namespace/);
  });
});
