import { describe, expect, it } from "vitest";

import type { NetworkPreferencesRecord } from "../../../storage/records.js";
import { createNetworkPreferencesService } from "./NetworkPreferencesService.js";
import type { NetworkPreferencesPort } from "./port.js";

const createInMemoryPort = () => {
  let record: NetworkPreferencesRecord | null = null;
  const port: NetworkPreferencesPort = {
    async get() {
      return record;
    },
    async put(next) {
      record = next;
    },
  };
  return { port, getRaw: () => record };
};

describe("NetworkPreferencesService", () => {
  it("returns null when preferences are missing", async () => {
    const { port } = createInMemoryPort();
    const service = createNetworkPreferencesService({
      port,
      defaults: { selectedChainRef: "eip155:1", activeChainByNamespace: { eip155: "eip155:1" } },
    });
    expect(await service.get()).toBeNull();
    expect(service.getSelectedChainRef()).toBe("eip155:1");
    expect(service.getActiveChainRef("eip155")).toBe("eip155:1");
  });

  it("upserts with defaults when missing", async () => {
    const { port } = createInMemoryPort();
    const service = createNetworkPreferencesService({
      port,
      defaults: { selectedChainRef: "eip155:1", activeChainByNamespace: { eip155: "eip155:1" } },
      now: () => 123,
    });

    const next = await service.update({
      selectedChainRef: "eip155:10",
      activeChainByNamespacePatch: { eip155: "eip155:10" },
      rpcPatch: {
        "eip155:10": { activeIndex: 0, strategy: { id: "sticky" } },
      },
    });

    expect(next).toEqual({
      id: "network-preferences",
      selectedChainRef: "eip155:10",
      activeChainByNamespace: { eip155: "eip155:10" },
      rpc: { "eip155:10": { activeIndex: 0, strategy: { id: "sticky" } } },
      updatedAt: 123,
    });
  });

  it("patches rpc preferences and supports removals", async () => {
    const { port } = createInMemoryPort();
    const service = createNetworkPreferencesService({
      port,
      defaults: { selectedChainRef: "eip155:1", activeChainByNamespace: { eip155: "eip155:1" } },
      now: () => 500,
    });

    await service.setRpcPreferences({
      "eip155:1": { activeIndex: 0, strategy: { id: "round-robin" } },
      "eip155:10": { activeIndex: 1, strategy: { id: "sticky" } },
    });

    const after = await service.update({
      rpcPatch: {
        "eip155:10": null,
        "eip155:1": { activeIndex: 2, strategy: { id: "failover", options: { order: "strict" } } },
      },
    });

    expect(after.rpc["eip155:10"]).toBeUndefined();
    expect(after.rpc["eip155:1"]).toMatchObject({ activeIndex: 2, strategy: { id: "failover" } });
    expect(after.selectedChainRef).toBe("eip155:1");
    expect(after.updatedAt).toBe(500);
  });

  it("updates selectedChainRef independently from provider active chain selection", async () => {
    const { port } = createInMemoryPort();
    const service = createNetworkPreferencesService({
      port,
      defaults: { selectedChainRef: "eip155:1", activeChainByNamespace: { eip155: "eip155:1" } },
      now: () => 999,
    });

    const next = await service.setSelectedChainRef("eip155:10");

    expect(next.selectedChainRef).toBe("eip155:10");
    expect(next.activeChainByNamespace).toEqual({ eip155: "eip155:1" });
  });
});
