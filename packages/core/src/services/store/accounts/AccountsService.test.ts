import { describe, expect, it } from "vitest";
import { createMessenger } from "../../../messenger/index.js";
import type { AccountId, AccountRecord, AccountSelectionStateRecord } from "../../../storage/records.js";
import { createAccountsService } from "./AccountsService.js";
import type { AccountsPort } from "./port.js";

const createInMemoryPort = (seed: AccountRecord[] = []) => {
  const store = new Map<AccountId, AccountRecord>(seed.map((r) => [r.accountId, r]));
  let selectionState: AccountSelectionStateRecord | null = null;
  const writes: AccountRecord[] = [];
  const selectionWrites: AccountSelectionStateRecord[] = [];

  const port: AccountsPort = {
    async get(accountId) {
      return store.get(accountId) ?? null;
    },
    async list() {
      return [...store.values()];
    },
    async upsert(record) {
      store.set(record.accountId, record);
      writes.push(record);
    },
    async remove(accountId) {
      store.delete(accountId);
    },
    async removeByKeyringId(keyringId) {
      for (const [id, record] of Array.from(store.entries())) {
        if (record.keyringId === keyringId) {
          store.delete(id);
        }
      }
    },
    async getSelectionState() {
      return selectionState;
    },
    async putSelectionState(record) {
      selectionState = record;
      selectionWrites.push(record);
    },
  };

  return { port, store, writes, selectionWrites };
};

const createService = (port: AccountsPort) => createAccountsService({ messenger: createMessenger(), port });

describe("AccountsService", () => {
  it("list() filters hidden by default and sorts by createdAt asc", async () => {
    const seed: AccountRecord[] = [
      {
        accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 2000,
        hidden: true,
      },
      {
        accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1000,
      },
      {
        accountId: "eip155:cccccccccccccccccccccccccccccccccccccccc",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1500,
      },
    ];

    const { port } = createInMemoryPort(seed);
    const service = createService(port);

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
    const service = createService(port);

    let changed = 0;
    service.subscribeChanged(() => {
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
    const seed: AccountRecord[] = [
      {
        accountId: "eip155:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        keyringId: "11111111-1111-4111-8111-111111111111",
        createdAt: 1000,
      },
    ];

    const { port } = createInMemoryPort(seed);
    const service = createService(port);

    let changed = 0;
    service.subscribeChanged(() => {
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
    if (!visible) throw new Error("Expected account to exist");
    expect(visible.hidden).toBeUndefined();

    expect(changed).toBe(2);
  });

  it("stores selected accounts by namespace and rejects hidden selections", async () => {
    const visible: AccountRecord = {
      accountId: "eip155:1111111111111111111111111111111111111111",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
    };
    const hidden: AccountRecord = {
      accountId: "eip155:2222222222222222222222222222222222222222",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 2000,
      hidden: true,
    };
    const { port, selectionWrites } = createInMemoryPort([visible, hidden]);
    const service = createAccountsService({ messenger: createMessenger(), port });

    await service.setSelectedAccountId({ namespace: "eip155", accountId: visible.accountId });

    expect(await service.getSelectedAccountId("eip155")).toBe(visible.accountId);
    expect(selectionWrites.at(-1)).toEqual({
      id: "account-selection",
      selectedAccountIdsByNamespace: { eip155: visible.accountId },
    });

    await expect(
      service.setSelectedAccountId({ namespace: "eip155", accountId: hidden.accountId }),
    ).rejects.toMatchObject({ code: "global.permission.denied" });
  });

  it("clears selected account when the account is hidden or removed", async () => {
    const account: AccountRecord = {
      accountId: "eip155:3333333333333333333333333333333333333333",
      keyringId: "11111111-1111-4111-8111-111111111111",
      createdAt: 1000,
    };
    const { port } = createInMemoryPort([account]);
    const service = createAccountsService({ messenger: createMessenger(), port });

    await service.setSelectedAccountId({ namespace: "eip155", accountId: account.accountId });
    await service.setHidden({ accountId: account.accountId, hidden: true });
    expect(await service.getSelectedAccountId("eip155")).toBeNull();

    await service.setHidden({ accountId: account.accountId, hidden: false });
    await service.setSelectedAccountId({ namespace: "eip155", accountId: account.accountId });
    await service.remove(account.accountId);
    expect(await service.getSelectedAccountId("eip155")).toBeNull();
  });
});
