import { describe, expect, it } from "vitest";

import type { SettingsPort } from "./port.js";
import { createSettingsService } from "./SettingsService.js";

const createInMemoryPort = () => {
  let record: unknown | null = null;
  const port: SettingsPort = {
    async get() {
      return (record as any) ?? null;
    },
    async put(next) {
      record = next;
    },
  };
  return { port, getRaw: () => record };
};

describe("SettingsService", () => {
  it("returns null when settings are missing", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, defaults: { activeChainRef: "eip155:1" } });
    expect(await service.get()).toBeNull();
  });

  it("upserts settings with defaults when missing", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, defaults: { activeChainRef: "eip155:1" }, now: () => 123 });

    const next = await service.upsert({ selectedAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(next).toEqual({
      id: "settings",
      activeChainRef: "eip155:1",
      selectedAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      updatedAt: 123,
    });
  });

  it("merges updates and preserves unset fields", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, defaults: { activeChainRef: "eip155:1" }, now: () => 500 });

    await service.upsert({ activeChainRef: "eip155:10" });
    const after = await service.upsert({ selectedAccountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });

    expect(after.activeChainRef).toBe("eip155:10");
    expect(after.selectedAccountId).toBe("eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(after.updatedAt).toBe(500);
  });
});
