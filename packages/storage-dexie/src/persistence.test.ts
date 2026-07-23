import "fake-indexeddb/auto";

import {
  type AccountRecord,
  AUTO_LOCK_SETTING_KEY,
  type Bip39KeySourceRecord,
  type CustomNetworkRecord,
  type DappNetworkSelectionRecord,
  type HdKeyringRecord,
  type NetworkRpcOverrideRecord,
  type NetworkSelectionRecord,
  type PermissionRecord,
  PersistenceCommitError,
  PersistenceReadError,
  persistenceChange,
  persistenceTypes,
  type TransactionRecord,
} from "@arx/core/persistence";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDexiePersistence } from "./createDexiePersistence.js";
import { ArxPersistenceDatabase, createDexiePersistenceContext } from "./database.js";
import { createAccountsReader } from "./readers/accounts.js";
import { createPersistenceWriter } from "./writer.js";

const databaseConnections: Array<{ close(): void | Promise<void> }> = [];
let nextDatabaseId = 0;

const createDatabaseName = (): string => `arx-persistence-test-${nextDatabaseId++}`;

const createTestPersistence = (): ReturnType<typeof createDexiePersistence> => {
  const persistence = createDexiePersistence({ databaseName: createDatabaseName() });
  databaseConnections.push(persistence);
  return persistence;
};

const hdAccount = (params: {
  accountId: string;
  hdKeyringId: string;
  createdAt: number;
  hidden?: boolean;
}): AccountRecord => ({
  accountId: params.accountId,
  origin: {
    type: "hd",
    hdKeyringId: params.hdKeyringId,
    derivationIndex: 0,
  },
  hidden: params.hidden ?? false,
  createdAt: params.createdAt,
});

const transaction = (params: {
  transactionId: string;
  chainRef: string;
  accountId: string;
  createdAt: number;
  status: "pending" | "confirmed";
}): TransactionRecord => {
  const base = {
    transactionId: params.transactionId,
    namespace: "eip155" as const,
    chainRef: params.chainRef,
    accountId: params.accountId,
    initiator: { type: "wallet" } as const,
    transaction: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x0",
      data: "0x",
      gas: "0x5208",
      nonce: "0x1",
      fee: { type: "legacy", gasPrice: "0x1" },
    },
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };

  if (params.status === "confirmed") {
    return {
      ...base,
      state: {
        status: "confirmed",
        confirmation: {
          blockHash: "0xabc",
          blockNumber: "0x1",
          transactionIndex: "0x0",
          gasUsed: "0x5208",
        },
      },
    };
  }

  return {
    ...base,
    state: { status: "pending" },
    recovery: { rawTransaction: "0xdeadbeef" },
  };
};

afterEach(async () => {
  for (const connection of databaseConnections.splice(0)) {
    await connection.close();
  }
});

describe("createDexiePersistence", () => {
  it("converts database opening failures to PersistenceReadError", async () => {
    const failure = new Error("database open failed");
    const open = vi.spyOn(ArxPersistenceDatabase.prototype, "open").mockRejectedValueOnce(failure);
    const context = createDexiePersistenceContext(createDatabaseName());
    databaseConnections.push(context.db);
    const reader = createAccountsReader(context);

    try {
      const read = reader.listRecords();
      await expect(read).rejects.toBeInstanceOf(PersistenceReadError);
      await expect(read).rejects.toMatchObject({ code: PersistenceReadError.code });
      await expect(read).rejects.toHaveProperty("cause", failure);
    } finally {
      open.mockRestore();
    }
  });

  it("converts raw reader failures and preserves ArxBaseError instances", async () => {
    const context = createDexiePersistenceContext(createDatabaseName());
    databaseConnections.push(context.db);
    const reader = createAccountsReader(context);
    await context.ready;
    const failure = new Error("account read failed");
    const existingError = new PersistenceCommitError(new Error("owner read error"));
    const toArray = vi
      .spyOn(context.db.accounts, "toArray")
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(existingError);

    try {
      const rawRead = reader.listRecords();
      await expect(rawRead).rejects.toBeInstanceOf(PersistenceReadError);
      await expect(rawRead).rejects.toMatchObject({ code: PersistenceReadError.code });
      await expect(rawRead).rejects.toHaveProperty("cause", failure);
      await expect(reader.listRecords()).rejects.toBe(existingError);
    } finally {
      toArray.mockRestore();
    }
  });

  it("commits canonical records across stores and maps physical rows back", async () => {
    const persistence = createTestPersistence();
    const source: Bip39KeySourceRecord = {
      keySourceId: "source-1",
      type: "bip39",
      backupStatus: "pending",
      createdAt: 1,
    };
    const hdKeyring: HdKeyringRecord = {
      hdKeyringId: "hd-keyring-1",
      keySourceId: source.keySourceId,
      namespace: "eip155",
      nextDerivationIndex: 1,
      createdAt: 1,
    };
    const account = hdAccount({
      accountId: "eip155:01",
      hdKeyringId: hdKeyring.hdKeyringId,
      createdAt: 1,
    });
    const permission = {
      origin: "https://dapp.example",
      namespace: "eip155",
      accountIds: [account.accountId],
    } satisfies PermissionRecord;
    const encryptedVault = {
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      iv: "EBESExQVFhcYGRob",
      ciphertext: "zp/Hc7X9pGfcMMMdmr+Fmv+RHSNqR5YnwEDSEQ==",
    } as const;
    const autoLock = { key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 } as const;

    await persistence.writer.commit([
      persistenceChange.put(persistenceTypes.encryptedVault, encryptedVault),
      persistenceChange.put(persistenceTypes.setting, autoLock),
      persistenceChange.put(persistenceTypes.keySource, source),
      persistenceChange.put(persistenceTypes.hdKeyring, hdKeyring),
      persistenceChange.put(persistenceTypes.account, account),
      persistenceChange.put(persistenceTypes.permission, permission),
    ]);

    expect(await persistence.readers.encryptedVault.get()).toEqual(encryptedVault);
    expect(await persistence.readers.settings.get(AUTO_LOCK_SETTING_KEY)).toEqual(autoLock);
    expect(await persistence.readers.keySources.listAll()).toEqual([source]);
    expect(await persistence.readers.hdKeyrings.listAll()).toEqual([hdKeyring]);
    expect(await persistence.readers.accounts.listRecords()).toEqual([account]);
    expect(await persistence.readers.permissions.listAll()).toEqual([permission]);
  });

  it("uses the target HD keyring primary key without secondary query indexes", async () => {
    const context = createDexiePersistenceContext(createDatabaseName());
    databaseConnections.push(context.db);
    await context.ready;

    expect(context.db.hdKeyrings.schema.primKey.keyPath).toBe("hdKeyringId");
    expect(context.db.hdKeyrings.schema.indexes).toEqual([]);
  });

  it("uses the account identity primary key without owner-specific query indexes", async () => {
    const context = createDexiePersistenceContext(createDatabaseName());
    databaseConnections.push(context.db);
    await context.ready;

    expect(context.db.accounts.schema.primKey.keyPath).toBe("accountId");
    expect(context.db.accounts.schema.indexes).toEqual([]);
  });

  it("removes legacy transaction rows during the schema upgrade", async () => {
    const databaseName = createDatabaseName();
    const legacy = new Dexie(databaseName);
    databaseConnections.push(legacy);
    legacy.version(1).stores({
      transactions:
        "&transactionId, [createAt+transactionId], [chainRef+createAt+transactionId], [accountId+createAt+transactionId], status, [chainRef+conflictKey.kind+conflictKey.value]",
    });
    await legacy.open();
    await legacy.table("transactions").put({ transactionId: "legacy-transaction", createAt: 1, status: "submitted" });
    await legacy.close();

    const context = createDexiePersistenceContext(databaseName);
    databaseConnections.push(context.db);
    await context.ready;

    expect(await context.db.transactions.count()).toBe(0);
  });

  it("rolls back earlier writes when a later store operation fails", async () => {
    const context = createDexiePersistenceContext(createDatabaseName());
    databaseConnections.push(context.db);
    const writer = createPersistenceWriter(context);
    await context.ready;
    const failure = new Error("account write failed");
    const putAccount = vi.spyOn(context.db.accounts, "put").mockRejectedValueOnce(failure);

    const commit = writer.commit([
      persistenceChange.put(persistenceTypes.setting, {
        key: AUTO_LOCK_SETTING_KEY,
        durationMs: 60_000,
      }),
      persistenceChange.put(
        persistenceTypes.account,
        hdAccount({ accountId: "eip155:02", hdKeyringId: "keyring-1", createdAt: 2 }),
      ),
    ]);

    await expect(commit).rejects.toBeInstanceOf(PersistenceCommitError);
    await expect(commit).rejects.toMatchObject({ code: PersistenceCommitError.code });
    await expect(commit).rejects.toHaveProperty("cause", failure);
    putAccount.mockRestore();
    expect(await context.db.settings.get(AUTO_LOCK_SETTING_KEY)).toBeUndefined();
  });

  it("loads account records and selections independently for Accounts bootstrap", async () => {
    const persistence = createTestPersistence();
    const first = hdAccount({ accountId: "eip155:01", hdKeyringId: "keyring-1", createdAt: 1 });
    const second = hdAccount({
      accountId: "eip155:02",
      hdKeyringId: "keyring-1",
      createdAt: 2,
      hidden: true,
    });
    const selection = {
      namespace: "eip155",
      accountId: first.accountId,
    } as const;

    await persistence.writer.commit([
      persistenceChange.put(persistenceTypes.account, first),
      persistenceChange.put(persistenceTypes.account, second),
      persistenceChange.put(persistenceTypes.accountSelection, selection),
    ]);

    expect(await persistence.readers.accounts.listRecords()).toEqual(expect.arrayContaining([first, second]));
    expect(await persistence.readers.accounts.listSelections()).toEqual([selection]);
  });

  it("round-trips network records", async () => {
    const persistence = createTestPersistence();
    const customNetwork: CustomNetworkRecord = {
      definition: {
        chainRef: "eip155:10",
        name: "Optimism",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      defaultRpcEndpoints: ["https://optimism.example"],
    };
    const rpcOverride: NetworkRpcOverrideRecord = {
      chainRef: "eip155:1",
      endpoints: ["https://override.example"],
    };
    const selection: NetworkSelectionRecord = {
      selectedNamespace: "eip155",
      selectedChainRefByNamespace: { eip155: "eip155:10" },
    };
    const dappSelection: DappNetworkSelectionRecord = {
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:10",
    };

    await persistence.writer.commit([
      persistenceChange.put(persistenceTypes.customNetwork, customNetwork),
      persistenceChange.put(persistenceTypes.networkRpcOverride, rpcOverride),
      persistenceChange.put(persistenceTypes.networkSelection, selection),
      persistenceChange.put(persistenceTypes.dappNetworkSelection, dappSelection),
    ]);

    expect(await persistence.readers.customNetworks.listAll()).toEqual([customNetwork]);
    expect(await persistence.readers.networkRpcOverrides.listAll()).toEqual([rpcOverride]);
    expect(await persistence.readers.networkSelection.get()).toEqual(selection);
    expect(await persistence.readers.dappNetworkSelections.listAll()).toEqual([dappSelection]);

    await persistence.writer.commit([persistenceChange.remove(persistenceTypes.dappNetworkSelection, dappSelection)]);
    expect(await persistence.readers.dappNetworkSelections.listAll()).toEqual([]);
  });

  it("queries public transaction history without exposing pending recovery artifacts", async () => {
    const persistence = createTestPersistence();
    const first = transaction({
      transactionId: "transaction-a",
      chainRef: "eip155:1",
      accountId: "eip155:01",
      createdAt: 100,
      status: "pending",
    });
    const second = transaction({
      transactionId: "transaction-b",
      chainRef: "eip155:1",
      accountId: "eip155:01",
      createdAt: 100,
      status: "confirmed",
    });
    const third = transaction({
      transactionId: "transaction-c",
      chainRef: "eip155:10",
      accountId: "eip155:02",
      createdAt: 200,
      status: "confirmed",
    });

    await persistence.writer.commit(
      [first, second, third].map((record) => persistenceChange.put(persistenceTypes.transaction, record)),
    );

    const firstPage = await persistence.readers.transactions.list({ limit: 2 });
    expect(firstPage.transactions.map((record) => record.transactionId)).toEqual(["transaction-c", "transaction-b"]);
    expect(firstPage.nextCursor).toEqual({ createdAt: 100, transactionId: "transaction-b" });
    expect(
      await persistence.readers.transactions.list({
        limit: 2,
        cursor: firstPage.nextCursor,
      }),
    ).toMatchObject({ transactions: [{ transactionId: "transaction-a" }] });
    expect(await persistence.readers.transactions.get(first.transactionId)).not.toHaveProperty("recovery");
    expect(
      await persistence.readers.transactions.list({
        accountId: "eip155:01",
        chainRef: "eip155:1",
        statuses: ["pending"],
        limit: 10,
      }),
    ).toMatchObject({ transactions: [{ transactionId: "transaction-a" }] });
    expect(await persistence.readers.transactions.listPending()).toEqual(expect.arrayContaining([first]));
  });
});
