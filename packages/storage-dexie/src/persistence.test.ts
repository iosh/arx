import "fake-indexeddb/auto";

import {
  type AccountRecord,
  type PermissionRecord,
  PersistenceCommitError,
  PersistenceReadError,
  persistenceChange,
  persistenceTypes,
  type TransactionRecord,
} from "@arx/core/persistence";
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
  keyringId: string;
  createAt: number;
  hidden?: boolean;
}): AccountRecord => ({
  accountId: params.accountId,
  origin: {
    type: "hd",
    keyringId: params.keyringId,
    derivationIndex: 0,
  },
  hidden: params.hidden ?? false,
  createAt: params.createAt,
});

const transaction = (params: {
  transactionId: string;
  chainRef: string;
  accountId: string;
  createAt: number;
  conflictValue?: string;
  status?: "submitting" | "submitted";
}): TransactionRecord => {
  const base = {
    transactionId: params.transactionId,
    chainRef: params.chainRef,
    accountId: params.accountId,
    origin: "wallet",
    source: "wallet-ui" as const,
    createAt: params.createAt,
    signingPayload: {},
    ...(params.conflictValue
      ? {
          conflictKey: {
            kind: "nonce",
            value: params.conflictValue,
          },
        }
      : {}),
  };

  if (params.status === "submitted") {
    return {
      ...base,
      status: "submitted",
      networkSubmission: { hash: params.transactionId },
    };
  }

  return {
    ...base,
    status: "submitting",
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
      const read = reader.get("eip155:01");
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
    const get = vi
      .spyOn(context.db.accounts, "get")
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(existingError);

    try {
      const rawRead = reader.get("eip155:01");
      await expect(rawRead).rejects.toBeInstanceOf(PersistenceReadError);
      await expect(rawRead).rejects.toMatchObject({ code: PersistenceReadError.code });
      await expect(rawRead).rejects.toHaveProperty("cause", failure);
      await expect(reader.get("eip155:01")).rejects.toBe(existingError);
    } finally {
      get.mockRestore();
    }
  });

  it("commits canonical records across stores and maps physical rows back", async () => {
    const persistence = createTestPersistence();
    const account = hdAccount({
      accountId: "eip155:01",
      keyringId: "keyring-1",
      createAt: 1,
    });
    const permission = {
      origin: "https://dapp.example",
      namespace: "eip155",
      chainScopes: {
        "eip155:1": [account.accountId],
      },
    } satisfies PermissionRecord;
    const encryptedVault = {
      salt: "AAECAwQFBgcICQoLDA0ODw==",
      iv: "EBESExQVFhcYGRob",
      ciphertext: "zp/Hc7X9pGfcMMMdmr+Fmv+RHSNqR5YnwEDSEQ==",
    } as const;

    await persistence.writer.commit([
      persistenceChange.put(persistenceTypes.encryptedVault, encryptedVault),
      persistenceChange.put(persistenceTypes.account, account),
      persistenceChange.put(persistenceTypes.permission, permission),
    ]);

    expect(await persistence.readers.encryptedVault.get()).toEqual(encryptedVault);
    expect(await persistence.readers.accounts.get(account.accountId)).toEqual(account);
    expect(await persistence.readers.permissions.listReferencingAccountIds([account.accountId])).toEqual([permission]);
    expect(await persistence.readers.permissions.listReferencingChainRef("eip155:1")).toEqual([permission]);
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
        key: "autoLock",
        value: { durationMs: 60_000 },
      }),
      persistenceChange.put(
        persistenceTypes.account,
        hdAccount({ accountId: "eip155:02", keyringId: "keyring-1", createAt: 2 }),
      ),
    ]);

    await expect(commit).rejects.toBeInstanceOf(PersistenceCommitError);
    await expect(commit).rejects.toMatchObject({ code: PersistenceCommitError.code });
    await expect(commit).rejects.toHaveProperty("cause", failure);
    putAccount.mockRestore();
    expect(await context.db.settings.get("autoLock")).toBeUndefined();
  });

  it("reads namespace accounts and required selection in one logical query", async () => {
    const persistence = createTestPersistence();
    const first = hdAccount({ accountId: "eip155:01", keyringId: "keyring-1", createAt: 1 });
    const second = hdAccount({
      accountId: "eip155:02",
      keyringId: "keyring-1",
      createAt: 2,
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

    const namespaceAccounts = await persistence.readers.accounts.getNamespaceAccounts("eip155");
    expect(namespaceAccounts?.selection).toEqual(selection);
    expect(namespaceAccounts?.accounts).toEqual(expect.arrayContaining([first, second]));
    expect(await persistence.readers.accounts.getNamespaceAccounts("solana")).toBeNull();
  });

  it("queries transaction history cursors, statuses, and conflict groups", async () => {
    const persistence = createTestPersistence();
    const first = transaction({
      transactionId: "transaction-a",
      chainRef: "eip155:1",
      accountId: "eip155:01",
      createAt: 100,
      conflictValue: "1",
    });
    const second = transaction({
      transactionId: "transaction-b",
      chainRef: "eip155:1",
      accountId: "eip155:01",
      createAt: 100,
      conflictValue: "1",
      status: "submitted",
    });
    const third = transaction({
      transactionId: "transaction-c",
      chainRef: "eip155:10",
      accountId: "eip155:02",
      createAt: 200,
      status: "submitted",
    });

    await persistence.writer.commit(
      [first, second, third].map((record) => persistenceChange.put(persistenceTypes.transaction, record)),
    );

    const firstPage = await persistence.readers.transactions.listHistory({ limit: 2 });
    expect(firstPage.transactions).toEqual([third, second]);
    expect(firstPage.nextCursor).toEqual({ createAt: 100, transactionId: "transaction-b" });
    expect(
      await persistence.readers.transactions.listHistory({
        limit: 2,
        cursor: firstPage.nextCursor,
      }),
    ).toEqual({ transactions: [first] });
    expect(await persistence.readers.transactions.listByStatuses(["submitted"])).toEqual(
      expect.arrayContaining([second, third]),
    );
    expect(
      await persistence.readers.transactions.listByConflictKey({
        chainRef: "eip155:1",
        conflictKey: { kind: "nonce", value: "1" },
      }),
    ).toEqual(expect.arrayContaining([first, second]));
    expect(
      await persistence.readers.transactions.existsByChainRefAndStatuses({
        chainRef: "eip155:1",
        statuses: ["submitted"],
      }),
    ).toBe(true);
  });
});
