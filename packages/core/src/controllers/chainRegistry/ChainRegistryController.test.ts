import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata, ChainRegistryPort } from "../../chains/index.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import type { ChainRegistryEntity } from "../../storage/index.js";
import { InMemoryChainRegistryController } from "./ChainRegistryController.js";
import type { ChainRegistryMessengerTopics, ChainRegistryState, ChainRegistryUpdate } from "./types.js";

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

class MemoryChainRegistryPort implements ChainRegistryPort {
  private readonly entries = new Map<string, ChainRegistryEntity>();
  public deleted: string[] = [];

  constructor(seed?: ChainRegistryEntity[]) {
    seed?.forEach((entity) => {
      this.entries.set(entity.chainRef, {
        ...entity,
        metadata: { ...entity.metadata, rpcEndpoints: [...entity.metadata.rpcEndpoints] },
      });
    });
  }

  async get(chainRef: string): Promise<ChainRegistryEntity | null> {
    return this.entries.get(chainRef) ?? null;
  }

  async getAll(): Promise<ChainRegistryEntity[]> {
    return Array.from(this.entries.values());
  }

  async put(entity: ChainRegistryEntity): Promise<void> {
    this.entries.set(entity.chainRef, entity);
  }

  async putMany(entities: ChainRegistryEntity[]): Promise<void> {
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

describe("InMemoryChainRegistryController", () => {
  it("loads seed when storage is empty", async () => {
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const port = new MemoryChainRegistryPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1), createEip155Metadata(10)];

    const controller = new InMemoryChainRegistryController({
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
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const existingMetadata = createEip155Metadata(1);
    const existingEntity: ChainRegistryEntity = {
      chainRef: existingMetadata.chainRef,
      namespace: existingMetadata.namespace,
      metadata: existingMetadata,
      schemaVersion: 1,
      updatedAt: 500,
    };
    const port = new MemoryChainRegistryPort([existingEntity]);

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    const updates: ChainRegistryUpdate[] = [];
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
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const metadata = createEip155Metadata(137);
    const entity: ChainRegistryEntity = {
      chainRef: metadata.chainRef,
      namespace: metadata.namespace,
      metadata,
      schemaVersion: 1,
      updatedAt: 600,
    };
    const port = new MemoryChainRegistryPort([entity]);

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    const events: ChainRegistryUpdate[] = [];
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
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const invalid: ChainRegistryEntity = {
      chainRef: "eip155:1",
      namespace: "eip155",
      metadata: {
        ...createEip155Metadata(1),
        chainRef: "eip155:999",
      },
      schemaVersion: 1,
      updatedAt: 400,
    };
    const port = new MemoryChainRegistryPort([invalid]);

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed: [],
    });

    await controller.whenReady();

    expect(controller.getChains()).toHaveLength(0);
    expect(port.deleted).toContain("eip155:1");
  });

  it("publishes state changes and dedupes identical snapshots", async () => {
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const port = new MemoryChainRegistryPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1)];

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed,
      now,
    });

    const states: ChainRegistryState[] = [];
    const updates: ChainRegistryUpdate[] = [];

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
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const port = new MemoryChainRegistryPort();
    const now = () => 1_000;
    const seed = [createEip155Metadata(1)];

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed,
      now,
    });

    await controller.whenReady();

    const states: ChainRegistryState[] = [];
    const updates: ChainRegistryUpdate[] = [];
    controller.onStateChanged((state) => states.push(state));
    controller.onChainUpdated((update) => updates.push(update));

    const before = await port.getAll();
    expect(before).toHaveLength(1);

    const result = await controller.upsertChain(seed[0]!, { updatedAt: 2_000 });
    expect(result.kind).toBe("noop");

    const after = await port.getAll();
    expect(after).toHaveLength(1);
    expect(after[0]?.updatedAt).toBe(1_000);
    expect(states).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("returns removed false when chain is missing", async () => {
    const messenger = new ControllerMessenger<ChainRegistryMessengerTopics>({});
    const port = new MemoryChainRegistryPort();

    const controller = new InMemoryChainRegistryController({
      messenger,
      port,
      seed: [],
    });

    const states: ChainRegistryState[] = [];
    const updates: ChainRegistryUpdate[] = [];

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
