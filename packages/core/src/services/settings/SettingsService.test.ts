import { describe, expect, it } from "vitest";

import type { SettingsRecord } from "../../storage/records.js";
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

    const next = await service.upsert({
      selectedAccountIdsByNamespace: { eip155: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });

    expect(next).toEqual({
      id: "settings",
      selectedAccountIdsByNamespace: { eip155: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      updatedAt: 123,
    });
  });

  it("merges updates and preserves unset fields", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, now: () => 500 });

    const after = await service.upsert({
      selectedAccountIdsByNamespace: { eip155: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });

    expect(after.selectedAccountIdsByNamespace).toEqual({
      eip155: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(after.updatedAt).toBe(500);
  });

  it("patches per-namespace selected account ids", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, now: () => 1 });

    const first = await service.upsert({
      selectedAccountIdsByNamespace: {
        eip155: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    expect(first.selectedAccountIdsByNamespace).toEqual({
      eip155: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const second = await service.upsert({
      selectedAccountIdsByNamespace: {
        eip155: null,
      },
    });

    expect(second.selectedAccountIdsByNamespace).toBeUndefined();
  });

  it("trims namespace keys on write", async () => {
    const { port } = createInMemoryPort();
    const service = createSettingsService({ port, now: () => 10 });

    const first = await service.upsert({
      selectedAccountIdsByNamespace: { " eip155 ": "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });

    expect(first.selectedAccountIdsByNamespace).toEqual({
      eip155: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const second = await service.upsert({
      selectedAccountIdsByNamespace: { " eip155 ": null },
    });

    expect(second.selectedAccountIdsByNamespace).toBeUndefined();
  });
});
