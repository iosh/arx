import { describe, expect, it } from "vitest";
import type { ChainDefinitionsPort, ChainMetadata } from "../../chains/index.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { ChainDefinitionEntity } from "../../storage/index.js";
import { InMemoryChainDefinitionsController } from "./ChainDefinitionsController.js";
import { CHAIN_DEFINITIONS_TOPICS } from "./topics.js";
import type { ChainDefinitionsState, ChainDefinitionsUpdate } from "./types.js";

const createEip155Metadata = (reference: number, overrides: Partial<ChainMetadata> = {}): ChainMetadata => {
  return {
    chainRef: `eip155:${reference}`,
    namespace: "eip155",
    chainId: `0x${reference.toString(16)}`,
    displayName: `EIP155 ${reference}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcEndpoints: [{ url: `https://rpc-${reference}.example`, type: "public" }],
    ...overrides,
  };
};

class MemoryChainDefinitionsPort implements ChainDefinitionsPort {
  private readonly entries = new Map<string, ChainDefinitionEntity>();
  public deleted: string[] = [];

  constructor(seed?: ChainDefinitionEntity[]) {
    seed?.forEach((entity) => {
      this.entries.set(entity.chainRef, {
        ...entity,
        metadata: { ...entity.metadata, rpcEndpoints: [...entity.metadata.rpcEndpoints] },
      });
    });
  }

  async get(chainRef: string): Promise<ChainDefinitionEntity | null> {
    return this.entries.get(chainRef) ?? null;
  }

  async getAll(): Promise<ChainDefinitionEntity[]> {
    return Array.from(this.entries.values());
  }

  async put(entity: ChainDefinitionEntity): Promise<void> {
    this.entries.set(entity.chainRef, entity);
  }

  async putMany(entities: ChainDefinitionEntity[]): Promise<void> {
    for (const entity of entities) {
      this.entries.set(entity.chainRef, entity);
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

describe("InMemoryChainDefinitionsController", () => {
  it("loads seed when storage is empty", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const port = new MemoryChainDefinitionsPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1), createEip155Metadata(10)];

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed,
      now,
    });

    await controller.whenReady();

    expect(controller.getChains()).toHaveLength(seed.length);
    expect((await port.getAll()).length).toBe(seed.length);
  });

  it("upserts metadata and emits update events", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const existingMetadata = createEip155Metadata(1);
    const existingEntity: ChainDefinitionEntity = {
      chainRef: existingMetadata.chainRef,
      namespace: existingMetadata.namespace,
      metadata: existingMetadata,
      schemaVersion: 1,
      updatedAt: 500,
    };
    const port = new MemoryChainDefinitionsPort([existingEntity]);

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    const updates: ChainDefinitionsUpdate[] = [];
    const unsubscribe = controller.onChainUpdated((update) => {
      updates.push(update);
    });

    const updatedMetadata = {
      ...existingMetadata,
      displayName: "Updated Chain",
      rpcEndpoints: [{ url: "https://updated.example", type: "public" as const }],
    };

    const result = await controller.upsertChain(updatedMetadata, { updatedAt: 2_000 });

    expect(result.kind).toBe("updated");
    expect(result.chain.metadata.displayName).toBe("Updated Chain");
    if (result.kind !== "updated") {
      throw new Error("expected updated result");
    }
    expect(result.previous?.metadata.displayName).toBe(existingMetadata.displayName);

    const stored = await port.get(existingMetadata.chainRef);
    expect(stored?.metadata.displayName).toBe("Updated Chain");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.kind).toBe("updated");

    unsubscribe();
  });

  it("removes chains and publishes removal", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const metadata = createEip155Metadata(137);
    const entity: ChainDefinitionEntity = {
      chainRef: metadata.chainRef,
      namespace: metadata.namespace,
      metadata,
      schemaVersion: 1,
      updatedAt: 600,
    };
    const port = new MemoryChainDefinitionsPort([entity]);

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    const events: ChainDefinitionsUpdate[] = [];
    controller.onChainUpdated((update) => {
      events.push(update);
    });

    const outcome = await controller.removeChain(metadata.chainRef);
    expect(outcome.removed).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("removed");
    expect(await port.getAll()).toHaveLength(0);
  });

  it("drops invalid persisted entries", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const invalid: ChainDefinitionEntity = {
      chainRef: "eip155:1",
      namespace: "eip155",
      metadata: {
        ...createEip155Metadata(1),
        chainRef: "eip155:999",
      },
      schemaVersion: 1,
      updatedAt: 400,
    };
    const port = new MemoryChainDefinitionsPort([invalid]);

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    expect(controller.getChains()).toHaveLength(0);
    expect(port.deleted).toContain("eip155:1");
  });

  it("publishes state changes and dedupes identical snapshots", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const port = new MemoryChainDefinitionsPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1)];

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed,
      now,
    });

    const states: ChainDefinitionsState[] = [];
    const updates: ChainDefinitionsUpdate[] = [];

    controller.onStateChanged((state) => {
      states.push(state);
    });
    controller.onChainUpdated((update) => {
      updates.push(update);
    });

    await controller.whenReady();

    expect(states).toHaveLength(1);
    expect(states[0]?.chains).toHaveLength(1);
    expect(states[0]?.chains[0]?.chainRef).toBe("eip155:1");
    expect(states[0]?.chains[0]?.updatedAt).toBe(1_000);
    expect(updates).toHaveLength(0);

    const optimism = createEip155Metadata(10);
    const added = await controller.upsertChain(optimism, { updatedAt: 2_000 });

    const firstUpdate = updates[0];
    expect(firstUpdate?.kind).toBe("added");
    if (firstUpdate?.kind !== "added") throw new Error("expected added update");
    expect(firstUpdate.chain.chainRef).toBe(optimism.chainRef);
    expect(added.kind).toBe("added");
    expect(states).toHaveLength(2);
    expect(states[1]?.chains).toHaveLength(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.kind).toBe("added");

    const noop = await controller.upsertChain(optimism, { updatedAt: 2_000 });
    expect(noop.kind).toBe("noop");
    expect(states).toHaveLength(2);
    expect(updates).toHaveLength(1);
  });

  it("does not write or emit events for idempotent upserts", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const port = new MemoryChainDefinitionsPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1)];

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed,
      now,
    });

    await controller.whenReady();

    const states: ChainDefinitionsState[] = [];
    const updates: ChainDefinitionsUpdate[] = [];
    controller.onStateChanged((state) => states.push(state));
    controller.onChainUpdated((update) => updates.push(update));
    expect(states).toHaveLength(1);
    states.length = 0;

    const before = await port.getAll();
    expect(before).toHaveLength(1);

    const firstSeed = seed[0];
    if (!firstSeed) throw new Error("Missing seed fixture");
    const result = await controller.upsertChain(firstSeed, { updatedAt: 2_000 });
    expect(result.kind).toBe("noop");

    const after = await port.getAll();
    expect(after).toHaveLength(1);
    expect(after[0]?.updatedAt).toBe(1_000);
    expect(states).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("returns removed false when chain is missing", async () => {
    const messenger = new Messenger().scope({ publish: CHAIN_DEFINITIONS_TOPICS });
    const port = new MemoryChainDefinitionsPort();

    const controller = new InMemoryChainDefinitionsController({
      messenger,
      port,
      seed: [],
    });

    const states: ChainDefinitionsState[] = [];
    const updates: ChainDefinitionsUpdate[] = [];

    controller.onStateChanged((state) => {
      states.push(state);
    });
    controller.onChainUpdated((update) => {
      updates.push(update);
    });

    await controller.whenReady();

    const result = await controller.removeChain("eip155:999");

    expect(result).toEqual({ removed: false });
    expect(states).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
