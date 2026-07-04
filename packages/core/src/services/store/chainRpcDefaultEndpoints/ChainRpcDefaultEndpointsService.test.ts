import { describe, expect, it, vi } from "vitest";
import type { RpcEndpoint } from "../../../chains/definition.js";
import type { ChainRef } from "../../../chains/ids.js";
import { createMessenger } from "../../../messenger/index.js";
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
const createService = (params: { port: ChainRpcDefaultEndpointsPort; now?: () => number }) =>
  createChainRpcDefaultEndpointsService({ messenger: createMessenger(), ...params });

describe("ChainRpcDefaultEndpointsService", () => {
  it("persists default RPC endpoints and serves detached cached endpoints", async () => {
    const port = createMemoryPort();
    const service = createService({ port, now: () => 1_000 });
    const changed: unknown[] = [];
    service.subscribeChanged((payload) => changed.push(payload));

    const record = await service.setDefaultEndpoints("eip155:1", [endpoint("https://rpc.mainnet.example")], "request");

    expect(record).toEqual({
      chainRef: "eip155:1",
      rpcEndpoints: [{ url: "https://rpc.mainnet.example", type: "public" }],
      source: "request",
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

  it("replaces the bundle default access set without pruning request endpoints", async () => {
    const mainnet = {
      chainRef: "eip155:1",
      rpcEndpoints: [endpoint("https://rpc.mainnet.example")],
      source: "bundle",
      updatedAt: 100,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const solana = {
      chainRef: "solana:101",
      rpcEndpoints: [endpoint("https://rpc.solana.example")],
      source: "request",
      updatedAt: 200,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const port = createMemoryPort([mainnet, solana]);
    const service = createService({ port, now: () => 1_000 });
    const changed: unknown[] = [];
    service.subscribeChanged((payload) => changed.push(payload));

    await service.replaceDefaultEndpoints([
      {
        chainRef: mainnet.chainRef,
        rpcEndpoints: [endpoint("https://rpc.mainnet.v2.example")],
        source: "bundle",
      },
      {
        chainRef: "eip155:10",
        rpcEndpoints: [endpoint("https://rpc.optimism.example")],
        source: "bundle",
      },
    ]);

    expect(port.readRecord("eip155:1")).toEqual({
      chainRef: "eip155:1",
      rpcEndpoints: [{ url: "https://rpc.mainnet.v2.example", type: "public" }],
      source: "bundle",
      updatedAt: 1_000,
    });
    expect(port.readRecord("eip155:10")).toEqual({
      chainRef: "eip155:10",
      rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
      source: "bundle",
      updatedAt: 1_000,
    });
    expect(port.readRecord("solana:101")).toEqual(solana);
    expect(service.readDefaultEndpoints("eip155:1")).toEqual([
      { url: "https://rpc.mainnet.v2.example", type: "public" },
    ]);
    expect(service.readDefaultEndpoints("eip155:10")).toEqual([
      { url: "https://rpc.optimism.example", type: "public" },
    ]);
    expect(service.readDefaultEndpoints("solana:101")).toEqual([{ url: "https://rpc.solana.example", type: "public" }]);
    expect(changed).toEqual([
      {
        chainRef: "eip155:1",
        previous: mainnet,
        next: {
          chainRef: "eip155:1",
          rpcEndpoints: [{ url: "https://rpc.mainnet.v2.example", type: "public" }],
          source: "bundle",
          updatedAt: 1_000,
        },
      },
      {
        chainRef: "eip155:10",
        previous: null,
        next: {
          chainRef: "eip155:10",
          rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" }],
          source: "bundle",
          updatedAt: 1_000,
        },
      },
    ]);
  });

  it("does not rewrite or emit when endpoints are unchanged", async () => {
    const record = {
      chainRef: "eip155:1",
      rpcEndpoints: [endpoint("https://rpc.mainnet.example")],
      source: "request",
      updatedAt: 100,
    } satisfies ChainRpcDefaultEndpointsRecord;
    const port = createMemoryPort([record]);
    const service = createService({ port, now: () => 1_000 });
    const listener = vi.fn();
    service.subscribeChanged(listener);

    const next = await service.setDefaultEndpoints(record.chainRef, record.rpcEndpoints, "request");

    expect(next).toEqual(record);
    expect(port.countUpserts()).toBe(0);
    expect(port.countRemovals()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
