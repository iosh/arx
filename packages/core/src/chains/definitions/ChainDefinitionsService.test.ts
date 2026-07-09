import { describe, expect, it } from "vitest";
import type { ChainDefinitionsPort } from "../../index.js";
import { createMessenger } from "../../messenger/index.js";
import {
  CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  type ChainDefinitionEntity,
  type ChainDefinitionSource,
} from "../../storage/index.js";
import { getChainRefNamespace } from "../caip.js";
import type { ChainDefinition } from "../definition.js";
import { InMemoryChainDefinitionsService } from "./ChainDefinitionsService.js";
import type { ChainDefinitionsState, ChainDefinitionsUpdate } from "./types.js";

const createEip155Definition = (reference: number, overrides: Partial<ChainDefinition> = {}): ChainDefinition => {
  return {
    chainRef: `eip155:${reference}`,
    displayName: `EIP155 ${reference}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    ...overrides,
  };
};

const toEntity = (
  definition: ChainDefinition,
  source: ChainDefinitionSource,
  updatedAt = 0,
  createdByOrigin?: string,
): ChainDefinitionEntity => ({
  chainRef: definition.chainRef,
  namespace: getChainRefNamespace(definition.chainRef),
  definition,
  schemaVersion: CHAIN_DEFINITION_ENTITY_SCHEMA_VERSION,
  updatedAt,
  source,
  ...(createdByOrigin ? { createdByOrigin } : {}),
});

class MemoryChainDefinitionsPort implements ChainDefinitionsPort {
  private readonly entries = new Map<string, ChainDefinitionEntity>();
  public deleted: string[] = [];

  constructor(seed?: ChainDefinitionEntity[]) {
    seed?.forEach((entity) => {
      this.entries.set(entity.chainRef, structuredClone(entity));
    });
  }

  async get(chainRef: string): Promise<ChainDefinitionEntity | null> {
    const entry = this.entries.get(chainRef);
    return entry ? structuredClone(entry) : null;
  }

  async getAll(): Promise<ChainDefinitionEntity[]> {
    return Array.from(this.entries.values(), (entry) => structuredClone(entry));
  }

  async put(entity: ChainDefinitionEntity): Promise<void> {
    this.entries.set(entity.chainRef, structuredClone(entity));
  }

  async putMany(entities: ChainDefinitionEntity[]): Promise<void> {
    for (const entity of entities) {
      this.entries.set(entity.chainRef, structuredClone(entity));
    }
  }

  async delete(chainRef: string): Promise<void> {
    this.entries.delete(chainRef);
    this.deleted.push(chainRef);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

describe("InMemoryChainDefinitionsService", () => {
  it("reconciles builtin seed on startup and prunes stale builtin entries", async () => {
    const messenger = createMessenger();
    const mainnet = createEip155Definition(1, { displayName: "Ethereum" });
    const optimism = createEip155Definition(10, { displayName: "Optimism" });
    const custom = createEip155Definition(8453, { displayName: "Base" });
    const staleBuiltin = createEip155Definition(9999, { displayName: "Stale" });

    const port = new MemoryChainDefinitionsPort([
      toEntity({ ...mainnet, displayName: "Old Ethereum" }, "builtin", 10),
      toEntity(staleBuiltin, "builtin", 11),
      toEntity(custom, "custom", 12, "https://dapp.example"),
    ]);

    const chainDefinitions = new InMemoryChainDefinitionsService({
      messenger,
      port,
      seed: [mainnet, optimism],
      now: () => 1_000,
    });

    await chainDefinitions.whenReady();

    expect(chainDefinitions.getChains()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainRef: mainnet.chainRef,
          source: "builtin",
          definition: expect.objectContaining({ displayName: "Ethereum" }),
        }),
        expect.objectContaining({ chainRef: optimism.chainRef, source: "builtin" }),
        expect.objectContaining({
          chainRef: custom.chainRef,
          source: "custom",
          createdByOrigin: "https://dapp.example",
        }),
      ]),
    );
    expect(chainDefinitions.getChain(staleBuiltin.chainRef)).toBeNull();
    expect(port.deleted).toContain(staleBuiltin.chainRef);
  });

  it("upserts custom chains, preserves origin, and emits updates", async () => {
    const messenger = createMessenger();
    const port = new MemoryChainDefinitionsPort();
    const chainDefinitions = new InMemoryChainDefinitionsService({ messenger, port, seed: [], now: () => 2_000 });

    await chainDefinitions.whenReady();

    const updates: ChainDefinitionsUpdate[] = [];
    chainDefinitions.onChainUpdated((update) => updates.push(update));

    const base = createEip155Definition(8453, { displayName: "Base" });
    const added = await chainDefinitions.upsertCustomChain(base, { createdByOrigin: "https://dapp.example" });
    expect(added).toMatchObject({
      kind: "added",
      chain: { source: "custom", createdByOrigin: "https://dapp.example" },
    });

    const updated = await chainDefinitions.upsertCustomChain(
      { ...base, displayName: "Base Mainnet" },
      { updatedAt: 3_000, createdByOrigin: "https://other.example" },
    );
    expect(updated).toMatchObject({
      kind: "updated",
      chain: { definition: { displayName: "Base Mainnet" }, createdByOrigin: "https://dapp.example" },
      previous: { definition: { displayName: "Base" } },
    });

    expect(updates.map((entry) => entry.kind)).toEqual(["added", "updated"]);
    await expect(port.get(base.chainRef)).resolves.toMatchObject({
      source: "custom",
      createdByOrigin: "https://dapp.example",
      definition: { displayName: "Base Mainnet" },
    });
  });

  it("dedupes idempotent custom upserts", async () => {
    const messenger = createMessenger();
    const port = new MemoryChainDefinitionsPort();
    const chainDefinitions = new InMemoryChainDefinitionsService({ messenger, port, seed: [], now: () => 1_000 });

    const states: ChainDefinitionsState[] = [];
    const updates: ChainDefinitionsUpdate[] = [];
    chainDefinitions.onStateChanged((state) => states.push(state));
    chainDefinitions.onChainUpdated((update) => updates.push(update));

    await chainDefinitions.whenReady();

    const optimism = createEip155Definition(10);
    await chainDefinitions.upsertCustomChain(optimism, { createdByOrigin: "https://dapp.example" });
    states.length = 0;
    updates.length = 0;

    const result = await chainDefinitions.upsertCustomChain(optimism, { createdByOrigin: "https://dapp.example" });
    expect(result).toMatchObject({ kind: "noop", chain: { source: "custom" } });
    expect(states).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("returns noop for builtin-equivalent custom upserts and rejects builtin conflicts", async () => {
    const messenger = createMessenger();
    const mainnet = createEip155Definition(1, { displayName: "Ethereum" });
    const chainDefinitions = new InMemoryChainDefinitionsService({
      messenger,
      port: new MemoryChainDefinitionsPort(),
      seed: [mainnet],
      now: () => 1_000,
    });

    await chainDefinitions.whenReady();

    const equivalent = await chainDefinitions.upsertCustomChain(mainnet);
    expect(equivalent).toMatchObject({ kind: "noop", chain: { source: "builtin", chainRef: mainnet.chainRef } });

    await expect(
      chainDefinitions.upsertCustomChain({
        ...mainnet,
        displayName: "Fake Ethereum",
      }),
    ).rejects.toMatchObject({ code: "chain.definition_conflict" });
  });

  it("removes only custom chains", async () => {
    const messenger = createMessenger();
    const mainnet = createEip155Definition(1);
    const base = createEip155Definition(8453);
    const port = new MemoryChainDefinitionsPort([
      toEntity(mainnet, "builtin", 10),
      toEntity(base, "custom", 11, "https://dapp.example"),
    ]);

    const chainDefinitions = new InMemoryChainDefinitionsService({ messenger, port, seed: [mainnet] });
    await chainDefinitions.whenReady();

    await expect(chainDefinitions.removeCustomChain(mainnet.chainRef)).resolves.toMatchObject({
      removed: false,
      previous: { source: "builtin" },
    });
    await expect(chainDefinitions.removeCustomChain(base.chainRef)).resolves.toMatchObject({
      removed: true,
      previous: { source: "custom" },
    });
    await expect(chainDefinitions.removeCustomChain("eip155:999")).resolves.toEqual({ removed: false });
  });
});
