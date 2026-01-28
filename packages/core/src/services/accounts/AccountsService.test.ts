import { describe, expect, it } from "vitest";
import { type AccountId, type AccountRecord, AccountRecordSchema } from "../../db/records.js";
import { createAccountsService } from "./AccountsService.js";
import type { AccountsPort } from "./port.js";

const createInMemoryPort = (seed: AccountRecord[] = []) => {
  const store = new Map<AccountId, AccountRecord>(seed.map((r) => [r.accountId, r]));
  const writes: AccountRecord[] = [];

  const port: AccountsPort = {
    async get(accountId) {
      return store.get(accountId) ?? null;
    },
    async list() {
      return [...store.values()];
    },
    async upsert(record) {
      const checked = AccountRecordSchema.parse(record);
      store.set(checked.accountId, checked);
      writes.push(checked);
    },
  };

  return { port, store, writes };
};

describe("AccountsService", () => {
  it("list() filters hidden by default and sorts by createdAt asc", async () => {
    const seed = [
      AccountRecordSchema.parse({
        accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        namespace: "eip155",
        payloadHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 2000,
        hidden: true,
      }),
      AccountRecordSchema.parse({
        accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        namespace: "eip155",
        payloadHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1000,
      }),
      AccountRecordSchema.parse({
        accountId: "eip155:cccccccccccccccccccccccccccccccccccccccc",
        namespace: "eip155",
        payloadHex: "cccccccccccccccccccccccccccccccccccccccc",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1500,
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const service = createAccountsService({ port });

    const visible = await service.list();
    expect(visible.map((r) => r.accountId)).toEqual([
      "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "eip155:cccccccccccccccccccccccccccccccccccccccc",
    ]);

    const all = await service.list({ includeHidden: true });
    expect(all.map((r) => r.accountId)).toEqual([
      "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "eip155:cccccccccccccccccccccccccccccccccccccccc",
      "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("setHidden() is a no-op when account does not exist (no changed event)", async () => {
    const { port, writes } = createInMemoryPort();
    const service = createAccountsService({ port });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    await service.setHidden({
      accountId: "eip155:dddddddddddddddddddddddddddddddddddddddd",
      hidden: true,
    });

    expect(writes.length).toBe(0);
    expect(changed).toBe(0);
  });

  it("setHidden(true) sets hidden=true; setHidden(false) omits hidden field", async () => {
    const seed = [
      AccountRecordSchema.parse({
        accountId: "eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        namespace: "eip155",
        payloadHex: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1000,
      }),
    ];

    const { port } = createInMemoryPort(seed);
    const service = createAccountsService({ port });

    let changed = 0;
    service.on("changed", () => {
      changed += 1;
    });

    await service.setHidden({
      accountId: "eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      hidden: true,
    });

    const hidden = await service.get("eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(hidden?.hidden).toBe(true);

    await service.setHidden({
      accountId: "eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      hidden: false,
    });

    const visible = await service.get("eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(visible).not.toBeNull();
    expect(visible!.hidden).toBeUndefined();

    expect(changed).toBe(2);
  });
});
