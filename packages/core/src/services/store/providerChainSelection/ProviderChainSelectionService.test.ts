import { describe, expect, it } from "vitest";
import type { ProviderChainSelectionRecord } from "../../../storage/records.js";
import { createProviderChainSelectionService } from "./ProviderChainSelectionService.js";
import type { ProviderChainSelectionPort } from "./port.js";

type MemoryProviderChainSelectionPort = ProviderChainSelectionPort & {
  readRecord(params: { origin: string; namespace: string }): ProviderChainSelectionRecord | null;
  countRecords(): number;
  seed(record: ProviderChainSelectionRecord): void;
  listRecords(): ProviderChainSelectionRecord[];
};

const createMemoryPort = (): MemoryProviderChainSelectionPort => {
  const records = new Map<string, Map<string, ProviderChainSelectionRecord>>();

  const writeRecord = (record: ProviderChainSelectionRecord) => {
    let recordsByNamespace = records.get(record.origin);
    if (!recordsByNamespace) {
      recordsByNamespace = new Map();
      records.set(record.origin, recordsByNamespace);
    }
    recordsByNamespace.set(record.namespace, structuredClone(record));
  };

  const deleteRecord = (params: { origin: string; namespace: string }) => {
    const recordsByNamespace = records.get(params.origin);
    recordsByNamespace?.delete(params.namespace);
    if (recordsByNamespace?.size === 0) {
      records.delete(params.origin);
    }
  };

  const listRecords = () => {
    const all: ProviderChainSelectionRecord[] = [];
    for (const recordsByNamespace of records.values()) {
      all.push(...recordsByNamespace.values());
    }
    return all;
  };

  return {
    readRecord(params) {
      const record = records.get(params.origin)?.get(params.namespace) ?? null;
      return record ? structuredClone(record) : null;
    },
    countRecords() {
      return listRecords().length;
    },
    seed(record) {
      writeRecord(record);
    },
    listRecords() {
      return listRecords().map((record) => structuredClone(record));
    },
    async get(params) {
      return records.get(params.origin)?.get(params.namespace) ?? null;
    },
    async listAll() {
      return listRecords();
    },
    async upsert(record) {
      writeRecord(record);
    },
    async remove(params) {
      deleteRecord(params);
    },
  };
};

describe("ProviderChainSelectionService", () => {
  it("rejects empty and whitespace-padded origins", async () => {
    const port = createMemoryPort();
    const service = createProviderChainSelectionService({ port, now: () => 1_000 });

    await expect(
      service.setSelectedChainRef({
        origin: "",
        namespace: "eip155",
        chainRef: "eip155:1",
      }),
    ).rejects.toMatchObject({
      code: "provider_chain_selection.invalid_key",
      details: { field: "origin", value: "" },
    });

    await expect(
      service.setSelectedChainRef({
        origin: " https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
      }),
    ).rejects.toMatchObject({
      code: "provider_chain_selection.invalid_key",
      details: { field: "origin", value: " https://dapp.example" },
    });

    expect(port.countRecords()).toBe(0);
  });

  it("rejects empty namespaces", async () => {
    const port = createMemoryPort();
    const service = createProviderChainSelectionService({ port, now: () => 1_000 });

    await expect(
      service.setSelectedChainRef({
        origin: "https://dapp.example",
        namespace: " ",
        chainRef: "eip155:1",
      }),
    ).rejects.toMatchObject({
      code: "provider_chain_selection.invalid_key",
      details: { field: "namespace", value: " " },
    });

    expect(port.countRecords()).toBe(0);
  });

  it("uses the exact origin and a trimmed namespace key", async () => {
    const port = createMemoryPort();
    const service = createProviderChainSelectionService({ port, now: () => 1_000 });

    await service.setSelectedChainRef({
      origin: "https://dapp.example",
      namespace: " eip155 ",
      chainRef: "eip155:1",
    });

    expect(service.getSelectedChainRef({ origin: "https://dapp.example", namespace: "eip155" })).toBe("eip155:1");
    expect(port.listRecords()).toEqual([
      {
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        updatedAt: 1_000,
      },
    ]);
  });

  it("rejects chainRefs outside the selected namespace", async () => {
    const port = createMemoryPort();
    const service = createProviderChainSelectionService({ port, now: () => 1_000 });

    await expect(
      service.setSelectedChainRef({
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "solana:101",
      }),
    ).rejects.toMatchObject({
      code: "chain.namespace_mismatch",
    });

    expect(port.countRecords()).toBe(0);
  });

  it("clear deletes a selected provider chain and emits the previous record", async () => {
    const port = createMemoryPort();
    port.seed({
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      updatedAt: 1_000,
    });
    port.seed({
      origin: "https://other.example",
      namespace: "eip155",
      chainRef: "eip155:10",
      updatedAt: 2_000,
    });
    const service = createProviderChainSelectionService({ port, now: () => 3_000 });
    const changed: unknown[] = [];
    service.subscribeChanged((payload) => changed.push(payload));

    await service.clear({ origin: "https://dapp.example", namespace: "eip155" });

    expect(port.readRecord({ origin: "https://dapp.example", namespace: "eip155" })).toBeNull();
    expect(port.readRecord({ origin: "https://other.example", namespace: "eip155" })).toEqual({
      origin: "https://other.example",
      namespace: "eip155",
      chainRef: "eip155:10",
      updatedAt: 2_000,
    });
    expect(changed).toEqual([
      {
        origin: "https://dapp.example",
        namespace: "eip155",
        previous: {
          origin: "https://dapp.example",
          namespace: "eip155",
          chainRef: "eip155:1",
          updatedAt: 1_000,
        },
        next: null,
      },
    ]);
  });
});
