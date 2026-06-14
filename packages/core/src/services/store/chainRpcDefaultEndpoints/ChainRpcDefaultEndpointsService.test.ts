import { describe, expect, it, vi } from "vitest";
import type { ChainRef } from "../../../chains/ids.js";
import type { RpcEndpoint } from "../../../chains/metadata.js";
import type { ChainRpcDefaultEndpointsRecord } from "../../../storage/records.js";
import { createChainRpcDefaultEndpointsService } from "./ChainRpcDefaultEndpointsService.js";
import type { ChainRpcDefaultEndpointsPort } from "./port.js";

type MemoryChainRpcDefaultEndpointsPort = ChainRpcDefaultEndpointsPort & {
  readRecord(chainRef: ChainRef): ChainRpcDefaultEndpointsRecord | null;
  countUpserts(): number;
  countRemovals(): number;
};

const clone = <T>(value: T): T => structuredClone(value);

const createMemoryPort = (seed: ChainRpcDefaultEndpointsRecord[] = []): MemoryChainRpcDefaultEndpointsPort => {
  const records = new Map<ChainRef, ChainRpcDefaultEndpointsRecord>();
  const upserted: ChainRpcDefaultEndpointsRecord[] = [];
  const removed: ChainRef[] = [];

  for (const record of seed) {
    records.set(record.chainRef, clone(record));
  }

  return {
    readRecord(chainRef) {
      const record = records.get(chainRef);
      return record ? clone(record) : null;
    },
    countUpserts() {
      return upserted.length;
    },
    countRemovals() {
      return removed.length;
    },
    async get(chainRef) {
      const record = records.get(chainRef);
      return record ? clone(record) : null;
    },
    async list() {
      return Array.from(records.values(), (record) => clone(record));
    },
    async upsert(record) {
      records.set(record.chainRef, clone(record));
      upserted.push(clone(record));
    },
    async remove(chainRef) {
      records.delete(chainRef);
      removed.push(chainRef);
    },
    async clear() {
      records.clear();
    },
  };
};

const endpoint = (url: string): RpcEndpoint => ({ url, type: "public" });

describe("ChainRpcDefaultEndpointsService", () => {
  it("persists default RPC endpoints and serves detached cached endpoints", async () => {
    const port = createMemoryPort();
    const service = createChainRpcDefaultEndpointsService({ port, now: () => 1_000 });
    const changed: unknown[] = [];
    service.subscribeChanged((payload) => changed.push(payload));

    const record = await service.setDefaultEndpoints("eip155:1", [endpoint("https://rpc.mainnet.example")]);

    expect(record).toEqual({
      chainRef: "eip155:1",
      rpcEndpoints: [{ url: "https://rpc.mainnet.example", type: "public" }],
      updatedAt: 1_000,
    });
    expect(port.readRecord("eip155:1")).toEqual(record);
    expect(changed).toEqual([
      {
        chainRef: "eip155:1",
        previous: null,
        next: record,
      },
    ]);

    const cached = service.readDefaultEndpoints("eip155:1");
    expect(cached).toEqual(record.rpcEndpoints);
    if (!cached) throw new Error("Expected cached endpoints");
    cached[0].url = "https://mutated.example";
    expect(service.readDefaultEndpoints("eip155:1")).toEqual(record.rpcEndpoints);
  });

  it("replaces the default access set and prunes removed chains", async () => {
    const mainnet = {
      chainRef: "eip155:1",
      rpcEndpoints: [endpoint("https://rpc.mainnet.example")],
      updatedAt: 100,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const solana = {
      chainRef: "solana:101",
      rpcEndpoints: [endpoint("https://rpc.solana.example")],
      updatedAt: 200,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const port = createMemoryPort([mainnet, solana]);
    const service = createChainRpcDefaultEndpointsService({ port, now: () => 1_000 });
    const changed: unknown[] = [];
    service.subscribeChanged((payload) => changed.push(payload));

    await service.replaceDefaultEndpoints([
      {
        chainRef: mainnet.chainRef,
        rpcEndpoints: mainnet.rpcEndpoints,
      },
      {
        chainRef: "eip155:10",
        rpcEndpoints: [endpoint("https://rpc.optimism.example")],
      },
    ]);

    expect(port.readRecord("eip155:1")).toEqual(mainnet);
    expect(port.readRecord("eip155:10")).toEqual({
      chainRef: "eip155:10",
      rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
      updatedAt: 1_000,
    });
    expect(port.readRecord("solana:101")).toBeNull();
    expect(service.readDefaultEndpoints("eip155:1")).toEqual(mainnet.rpcEndpoints);
    expect(service.readDefaultEndpoints("eip155:10")).toEqual([
      { url: "https://rpc.optimism.example", type: "public" },
    ]);
    expect(service.readDefaultEndpoints("solana:101")).toBeNull();
    expect(changed).toEqual([
      {
        chainRef: "eip155:10",
        previous: null,
        next: {
          chainRef: "eip155:10",
          rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
          updatedAt: 1_000,
        },
      },
      {
        chainRef: "solana:101",
        previous: solana,
        next: null,
      },
    ]);
  });

  it("does not rewrite or emit when endpoints are unchanged", async () => {
    const record = {
      chainRef: "eip155:1",
      rpcEndpoints: [endpoint("https://rpc.mainnet.example")],
      updatedAt: 100,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const port = createMemoryPort([record]);
    const service = createChainRpcDefaultEndpointsService({ port, now: () => 1_000 });
    const listener = vi.fn();
    service.subscribeChanged(listener);

    const next = await service.setDefaultEndpoints(record.chainRef, record.rpcEndpoints);

    expect(next).toEqual(record);
    expect(port.countUpserts()).toBe(0);
    expect(port.countRemovals()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
