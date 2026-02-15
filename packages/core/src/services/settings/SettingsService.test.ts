import { describe, expect, it } from "vitest";

import type { SettingsRecord } from "../../db/records.js";
import type { SettingsPort } from "./port.js";
import { createSettingsService } from "./SettingsService.js";

const createInMemoryPort = () => {
  let record: SettingsRecord | null = null;
  const port: SettingsPort = {
    async get() {
      return record;
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
    const service = createSettingsService({ port });
    expect(await service.get()).toBeNull();
  });

  it("upserts settings when missing", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, now: () => 123 });

    const next = await service.upsert({ selectedAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(next).toEqual({
      id: "settings",
      selectedAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      updatedAt: 123,
    });
  });

  it("merges updates and preserves unset fields", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, now: () => 500 });

    const after = await service.upsert({ selectedAccountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });

    expect(after.selectedAccountId).toBe("eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(after.updatedAt).toBe(500);
  });
});
