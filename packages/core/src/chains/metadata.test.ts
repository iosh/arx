import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { DEFAULT_CHAIN_DEFINITION_SEEDS, DEFAULT_CHAIN_METADATA } from "./chains.seed.js";
import {
  createChainMetadataListSchema,
  deriveChainDefinitionSeedFromMetadata,
  isSameAddChainComparableMetadata,
  validateChainMetadata,
  validateChainMetadataList,
} from "./metadata.js";

const baseEip155Metadata = {
  chainRef: "eip155:1",
  namespace: "eip155",
  chainId: "0x1",
  displayName: "Ethereum Mainnet",
  shortName: "eth",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [
    { url: "https://mainnet.infura.io/v3/123..", type: "public" },
    { url: "https://eth-mainnet.g.alchemy.com/v2/234..", type: "authenticated", weight: 2 },
  ],
  blockExplorers: [{ type: "default", url: "https://etherscan.io" }],
  icon: { url: "https://assets.example.com/icons/ethereum.svg", width: 64, height: 64, format: "svg" },
};

describe("metadata", () => {
  it("accepts a valid eip155 metadata object", () => {
    const value = validateChainMetadata(baseEip155Metadata);
    expect(value.namespace).toBe("eip155");
    expect(value.rpcEndpoints).toHaveLength(2);
    expect(value.nativeCurrency.symbol).toBe("ETH");
  });

  it("derives a chain definition seed from legacy metadata", () => {
    const metadata = validateChainMetadata(baseEip155Metadata);

    const seed = deriveChainDefinitionSeedFromMetadata(metadata);

    expect(seed.definition).toEqual({
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
      shortName: "eth",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://etherscan.io" }],
      icon: { url: "https://assets.example.com/icons/ethereum.svg", width: 64, height: 64, format: "svg" },
    });
    expect(seed.definition).not.toHaveProperty("namespace");
    expect(seed.definition).not.toHaveProperty("chainId");
    expect(seed.definition).not.toHaveProperty("rpcEndpoints");
    expect(seed.defaultRpcEndpoints).toEqual(metadata.rpcEndpoints);
    expect(seed.defaultRpcEndpoints).not.toBe(metadata.rpcEndpoints);
    expect(seed.defaultRpcEndpoints?.[0]).not.toBe(metadata.rpcEndpoints[0]);
  });

  it("exposes legacy builtin metadata derived from chain definition seeds", () => {
    const firstSeed = DEFAULT_CHAIN_DEFINITION_SEEDS[0];
    if (!firstSeed) {
      throw new Error("DEFAULT_CHAIN_DEFINITION_SEEDS must include at least one chain");
    }

    expect(DEFAULT_CHAIN_DEFINITION_SEEDS).toHaveLength(DEFAULT_CHAIN_METADATA.length);
    expect(DEFAULT_CHAIN_METADATA[0]).toMatchObject({
      chainRef: firstSeed.definition.chainRef,
      namespace: "eip155",
      chainId: "0x1",
      displayName: firstSeed.definition.displayName,
      rpcEndpoints: firstSeed.defaultRpcEndpoints,
    });
  });

  it("rejects namespace mismatches", () => {
    const candidate = { ...baseEip155Metadata, namespace: "conflux" };

    try {
      validateChainMetadata(candidate);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues[0];
      expect(issue?.path).toEqual(["namespace"]);
      expect(issue?.message).toBe('Chain namespace "conflux" does not match CAIP-2 namespace "eip155"');
    }
  });

  it("rejects eip155 metadata when chainId is missing", () => {
    const candidate = { ...baseEip155Metadata };
    delete (candidate as Partial<typeof candidate>).chainId;

    try {
      validateChainMetadata(candidate);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues[0];
      expect(issue?.path).toEqual(["chainId"]);
      expect(issue?.message).toBe("Chain metadata must include chainId");
    }
  });

  it("rejects eip155 metadata when chainId does not match the CAIP-2 reference", () => {
    const candidate = { ...baseEip155Metadata, chainId: "0x2" };

    try {
      validateChainMetadata(candidate);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues[0];
      expect(issue?.path).toEqual(["chainId"]);
      expect(issue?.message).toBe("chainId (0x2) does not match CAIP-2 reference (1)");
    }
  });

  it("rejects duplicate RPC endpoints", () => {
    const candidate = {
      ...baseEip155Metadata,
      rpcEndpoints: [{ url: "https://duplicate.endpoint" }, { url: "https://duplicate.endpoint" }],
    };

    try {
      validateChainMetadata(candidate);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues[0];
      expect(issue?.path).toEqual(["rpcEndpoints"]);
      expect(issue?.message).toBe("Duplicate RPC endpoint URL: https://duplicate.endpoint");
    }
  });

  it("rejects duplicate chainRef entries in metadata list", () => {
    const duplicated = [
      baseEip155Metadata,
      { ...baseEip155Metadata, displayName: "Ethereum Mainnet Mirror", rpcEndpoints: [{ url: "https://mirror.rpc" }] },
    ];

    try {
      validateChainMetadataList(duplicated);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues.find(({ path }) => path[0] === 1 && path[1] === "chainRef");
      expect(issue?.message).toBe("Duplicate chainRef detected: eip155:1");
    }
  });

  it("rejects duplicate shortName entries (case-insensitive)", () => {
    const duplicateShortNames = [
      baseEip155Metadata,
      {
        ...baseEip155Metadata,
        chainRef: "eip155:10",
        chainId: "0xa",
        displayName: "Optimism",
        shortName: "ETH",
        rpcEndpoints: [{ url: "https://optimism.rpc" }],
        blockExplorers: [{ type: "default", url: "https://optimism.explorer" }],
      },
    ];

    try {
      validateChainMetadataList(duplicateShortNames);
      throw new Error("Expected validation to fail");
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const issue = error.issues.find(({ path }) => path[0] === 1 && path[1] === "shortName");
      expect(issue?.message).toBe("Duplicate shortName detected: ETH");
    }
  });

  it("allows duplicate short names when explicitly enabled", () => {
    const schema = createChainMetadataListSchema({ allowDuplicateShortNames: true });

    const list = [
      baseEip155Metadata,
      {
        ...baseEip155Metadata,
        chainRef: "eip155:10",
        chainId: "0xa",
        displayName: "Optimism",
        shortName: "ETH",
        rpcEndpoints: [{ url: "https://optimism.rpc" }],
        blockExplorers: [{ type: "default", url: "https://optimism.explorer" }],
      },
    ];

    expect(() => schema.parse(list)).not.toThrow();
  });

  it("accepts default chain seed", () => {
    expect(() => validateChainMetadataList(DEFAULT_CHAIN_METADATA)).not.toThrow();
  });

  it("treats add-chain comparable metadata as equal across ordering and extra fields", () => {
    const existing = validateChainMetadata({
      chainRef: "eip155:8453",
      namespace: "eip155",
      chainId: "0X2105",
      displayName: "Base Mainnet",
      shortName: "base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [
        {
          url: "https://secondary.base.org/",
          type: "authenticated",
          headers: { Authorization: "Bearer token" },
        },
        { url: "https://mainnet.base.org", type: "public" },
      ],
      blockExplorers: [
        { type: "secondary", url: "https://basescan.org/", title: "BaseScan" },
        { type: "default", url: "https://www.base.org" },
      ],
      icon: { url: "https://assets.example.com/base.svg", format: "svg" },
    });

    const requested = validateChainMetadata({
      chainRef: "eip155:8453",
      namespace: "eip155",
      chainId: "0x2105",
      displayName: "Base Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [{ url: "https://mainnet.base.org/" }, { url: "https://secondary.base.org" }],
      blockExplorers: [
        { type: "default", url: "https://www.base.org/" },
        { type: "default", url: "https://basescan.org" },
      ],
    });

    expect(isSameAddChainComparableMetadata(existing, requested)).toBe(true);
  });

  it("detects add-chain comparable metadata differences", () => {
    const existing = validateChainMetadata({
      chainRef: "eip155:8453",
      namespace: "eip155",
      chainId: "0x2105",
      displayName: "Base Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [{ url: "https://mainnet.base.org" }],
    });

    const changed = validateChainMetadata({
      chainRef: "eip155:8453",
      namespace: "eip155",
      chainId: "0x2105",
      displayName: "Base Mainnet",
      nativeCurrency: { name: "Base Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [{ url: "https://mainnet.base.org" }],
    });

    expect(isSameAddChainComparableMetadata(existing, changed)).toBe(false);
  });
});
