import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../../chains/metadata.js";
import type { ChainDefinitionEntity } from "../../../storage/index.js";
import { createChainService } from "./ChainService.js";

const MAINNET: ChainMetadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.ethereum.example", type: "public" }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const OPTIMISM: ChainMetadata = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const UNSUPPORTED: ChainMetadata = {
  chainRef: "eip155:8453",
  namespace: "eip155",
  chainId: "0x2105",
  displayName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.base.example", type: "public" }],
  features: ["eip155"],
};

const toEntity = (metadata: ChainMetadata): ChainDefinitionEntity => ({
  chainRef: metadata.chainRef,
  namespace: metadata.namespace,
  metadata,
  schemaVersion: 1,
  updatedAt: 0,
});

const setup = (params?: { known?: ChainMetadata[]; available?: ChainMetadata[]; active?: ChainMetadata }) => {
  const known = params?.known ?? [MAINNET, OPTIMISM, UNSUPPORTED];
  const available = params?.available ?? [MAINNET, OPTIMISM];
  const active = params?.active ?? MAINNET;

  return createChainService({
    chainDefinitions: {
      getState: () => ({ chains: known.map(toEntity) }),
      getChain: (chainRef: string) => known.map(toEntity).find((entry) => entry.chainRef === chainRef) ?? null,
    } as never,
    network: {
      getState: () => ({
        revision: 1,
        activeChainRef: active.chainRef,
        availableChainRefs: available.map((chain) => chain.chainRef),
        rpc: {},
      }),
      getActiveChain: () => active,
      getChain: (chainRef: string) => available.find((chain) => chain.chainRef === chainRef) ?? null,
    } as never,
  });
};

describe("ChainService", () => {
  it("builds active, known, available, and provider views", () => {
    const service = setup();

    expect(service.getActiveChainView()).toMatchObject({ chainRef: MAINNET.chainRef, chainId: MAINNET.chainId });

    expect(service.buildUiNetworksSnapshot()).toEqual({
      active: MAINNET.chainRef,
      known: expect.arrayContaining([
        expect.objectContaining({ chainRef: MAINNET.chainRef }),
        expect.objectContaining({ chainRef: OPTIMISM.chainRef }),
        expect.objectContaining({ chainRef: UNSUPPORTED.chainRef }),
      ]),
      available: expect.arrayContaining([
        expect.objectContaining({ chainRef: MAINNET.chainRef }),
        expect.objectContaining({ chainRef: OPTIMISM.chainRef }),
      ]),
    });

    expect(service.buildProviderMeta()).toEqual({
      activeChain: MAINNET.chainRef,
      activeNamespace: MAINNET.namespace,
      supportedChains: [MAINNET.chainRef, OPTIMISM.chainRef],
    });
  });

  it("resolves wallet_switchEthereumChain targets from available chains", () => {
    const service = setup();

    expect(service.resolveEip155SwitchTarget({ chainId: "0xa" })).toMatchObject({ chainRef: OPTIMISM.chainRef });
    expect(service.resolveEip155SwitchTarget({ chainRef: OPTIMISM.chainRef })).toMatchObject({
      chainId: OPTIMISM.chainId,
    });
  });

  it("rejects targets that are known but not switchable in runtime", () => {
    const service = setup({ available: [MAINNET, UNSUPPORTED] });

    try {
      service.resolveEip155SwitchTarget({ chainId: UNSUPPORTED.chainId.toLowerCase() });
      throw new Error("Expected unsupported chain target to throw");
    } catch (error) {
      expect(error).toMatchObject({ reason: ArxReasons.ChainNotSupported });
    }

    try {
      service.resolveEip155SwitchTarget({ chainId: "0x9999" });
      throw new Error("Expected unknown chain target to throw");
    } catch (error) {
      expect(error).toMatchObject({ reason: ArxReasons.ChainNotFound });
    }
  });
});
