import "fake-indexeddb/auto";

import {
  type AccountRecord,
  type PermissionRecord,
  persistenceChange,
  persistenceTypes,
  type TransactionRecord,
} from "@arx/core/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDexiePersistence } from "./createDexiePersistence.js";
import { createDexiePersistenceContext } from "./database.js";
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
      version: 1,
      kdf: {
        name: "pbkdf2",
        hash: "sha256",
        salt: "salt",
        iterations: 1,
      },
      cipher: {
        name: "aes-gcm",
        iv: "iv",
        data: "ciphertext",
      },
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

    await expect(commit).rejects.toBe(failure);
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
