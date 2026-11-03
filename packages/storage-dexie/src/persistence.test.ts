import "fake-indexeddb/auto";

import {
  type AccountGroupRecord,
  type AccountMemberRecord,
  type CustomNetworkRecord,
  type DappNetworkSelectionRecord,
  type NetworkRpcOverrideRecord,
  PersistenceCommitError,
  PersistenceReadError,
  persistenceTypes,
  type TransactionRecord,
} from "@arx/core/persistence";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createDexiePersistence } from "./createDexiePersistence.js";
import { ArxPersistenceDatabase, createDexiePersistenceContext } from "./database.js";
import { createAccountsReader } from "./readers/accounts.js";
import { createPersistenceWriter } from "./writer.js";

const ACCOUNT_A = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const databaseConnections: Array<{ close(): void | Promise<void> }> = [];
let nextDatabaseId = 0;

const createDatabaseName = (): string => `arx-persistence-test-${nextDatabaseId++}`;

const createTestPersistence = () => {
  const persistence = createDexiePersistence({ databaseName: createDatabaseName() });
  databaseConnections.push(persistence);
  return persistence;
};

const createTestContext = () => {
  const context = createDexiePersistenceContext(createDatabaseName());
  databaseConnections.push(context.db);
  return context;
};

const transaction = (params: {
  transactionId: string;
  chainRef: string;
  accountId: typeof ACCOUNT_A | typeof ACCOUNT_B;
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
      from:
        params.accountId === ACCOUNT_A
          ? "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          : "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      to: null,
      value: "0x0",
      data: "0x",
      gas: "0x5208",
      nonce: "0x1",
      type: "legacy",
      gasPrice: "0x1",
    } as const,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };

  return params.status === "pending"
    ? { ...base, state: { status: "pending" }, recovery: { rawTransaction: "0xdeadbeef" } }
    : {
        ...base,
        state: {
          status: "confirmed",
          confirmation: {
            blockHash: "0xabababababababababababababababababababababababababababababababab",
            blockNumber: "0x1",
            transactionIndex: "0x0",
            gasUsed: "0x5208",
          },
        },
      };
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const connection of databaseConnections.splice(0)) {
    await connection.close();
  }
});

describe("Dexie persistence boundary", () => {
  it("reports a database opening failure as a persistence read error", async () => {
    const failure = new Error("IndexedDB open failed");
    vi.spyOn(ArxPersistenceDatabase.prototype, "open").mockRejectedValueOnce(failure);
    const reader = createAccountsReader(createTestContext());

    const reading = reader.listRecords();
    await expect(reading).rejects.toBeInstanceOf(PersistenceReadError);
    await expect(reading).rejects.toHaveProperty("cause", failure);
  });

  it("reports a database query failure as a persistence read error", async () => {
    const context = createTestContext();
    await context.ready;
    const failure = new Error("IndexedDB query failed");
    vi.spyOn(context.db.accounts, "toArray").mockRejectedValueOnce(failure);
    const reader = createAccountsReader(context);

    const reading = reader.listRecords();
    await expect(reading).rejects.toBeInstanceOf(PersistenceReadError);
    await expect(reading).rejects.toHaveProperty("cause", failure);
  });

  it("rolls back a written group when its member write fails", async () => {
    const context = createTestContext();
    await context.ready;
    const group: AccountGroupRecord = {
      accountGroupId: "95fe9605-6848-47b8-ae46-a842cf29dd7d",
      source: { type: "private-key", keySourceId: "source-1" },
      hidden: false,
      createdAt: 1,
    };
    const member: AccountMemberRecord = {
      accountId: ACCOUNT_A,
      accountGroupId: group.accountGroupId,
      origin: { type: "private-key", keySourceId: "source-1" },
    };
    const failure = new Error("IndexedDB member write failed");
    vi.spyOn(context.db.accounts, "put").mockImplementationOnce(() =>
      context.db.accountGroups.get(group.accountGroupId).then((written) => {
        expect(written).toEqual(group);
        throw failure;
      }),
    );

    const writing = createPersistenceWriter(context).commit([
      persistenceTypes.accountGroup.put(group),
      persistenceTypes.account.put(member),
    ]);
    await expect(writing).rejects.toBeInstanceOf(PersistenceCommitError);
    await expect(writing).rejects.toHaveProperty("cause", failure);
    const reader = createAccountsReader(context);
    expect(await reader.listGroups()).toEqual([]);
    expect(await reader.listRecords()).toEqual([]);
  });

  it("replaces the single shared account selection without exposing its physical key", async () => {
    const persistence = createTestPersistence();
    const first = { accountGroupId: "95fe9605-6848-47b8-ae46-a842cf29dd7d" };
    const second = { accountGroupId: "56128651-0451-4057-801e-3b3d5b9fe409" };

    await persistence.writer.commit([persistenceTypes.accountSelection.put(first)]);
    expect(await persistence.readers.accounts.getSelection()).toEqual(first);
    await persistence.writer.commit([persistenceTypes.accountSelection.put(second)]);

    expect(await persistence.readers.accounts.getSelection()).toEqual(second);
  });

  it("persists a custom network and its RPC override", async () => {
    const persistence = createTestPersistence();
    const customNetwork: CustomNetworkRecord = {
      definition: {
        chainRef: "eip155:1337",
        name: "Local EVM",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      defaultRpcEndpoints: ["https://custom.example"],
    };
    const rpcOverride: NetworkRpcOverrideRecord = {
      chainRef: customNetwork.definition.chainRef,
      endpoints: ["https://override.example"],
    };

    await persistence.writer.commit([
      persistenceTypes.customNetwork.put(customNetwork),
      persistenceTypes.networkRpcOverride.put(rpcOverride),
    ]);

    expect(await persistence.readers.customNetworks.listAll()).toEqual([customNetwork]);
    expect(await persistence.readers.networkRpcOverrides.listAll()).toEqual([rpcOverride]);
  });

  it("removes one site's saved network without removing another site's choice", async () => {
    const persistence = createTestPersistence();
    const first: DappNetworkSelectionRecord = {
      origin: "https://first.example",
      namespace: "eip155",
      chainRef: "eip155:10",
    };
    const second = { ...first, origin: "https://second.example", chainRef: "eip155:1" };

    await persistence.writer.commit([first, second].map(persistenceTypes.dappNetworkSelection.put));
    expect(await persistence.readers.dappNetworkSelections.listAll()).toEqual(expect.arrayContaining([first, second]));

    await persistence.writer.commit([persistenceTypes.dappNetworkSelection.remove(first)]);
    expect(await persistence.readers.dappNetworkSelections.listAll()).toEqual([second]);
  });
});

describe("Dexie transaction history", () => {
  it("paginates equal-timestamp transactions without skipping or repeating a record", async () => {
    const persistence = createTestPersistence();
    const records = [
      transaction({
        transactionId: "a",
        chainRef: "eip155:1",
        accountId: ACCOUNT_A,
        createdAt: 100,
        status: "confirmed",
      }),
      transaction({
        transactionId: "b",
        chainRef: "eip155:1",
        accountId: ACCOUNT_A,
        createdAt: 100,
        status: "confirmed",
      }),
      transaction({
        transactionId: "c",
        chainRef: "eip155:1",
        accountId: ACCOUNT_A,
        createdAt: 200,
        status: "confirmed",
      }),
    ];
    await persistence.writer.commit(records.map(persistenceTypes.transaction.put));

    const firstPage = await persistence.readers.transactions.list({ limit: 2 });
    expect(firstPage.transactions.map((record) => record.transactionId)).toEqual(["c", "b"]);
    assert(firstPage.nextCursor);
    const secondPage = await persistence.readers.transactions.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.transactions.map((record) => record.transactionId)).toEqual(["a"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("combines account, chain and status filters", async () => {
    const persistence = createTestPersistence();
    const records = [
      transaction({
        transactionId: "match",
        chainRef: "eip155:1",
        accountId: ACCOUNT_A,
        createdAt: 100,
        status: "pending",
      }),
      transaction({
        transactionId: "other-chain",
        chainRef: "eip155:10",
        accountId: ACCOUNT_A,
        createdAt: 100,
        status: "pending",
      }),
      transaction({
        transactionId: "other-account",
        chainRef: "eip155:1",
        accountId: ACCOUNT_B,
        createdAt: 100,
        status: "pending",
      }),
      transaction({
        transactionId: "confirmed",
        chainRef: "eip155:1",
        accountId: ACCOUNT_A,
        createdAt: 100,
        status: "confirmed",
      }),
    ];
    await persistence.writer.commit(records.map(persistenceTypes.transaction.put));

    const page = await persistence.readers.transactions.list({
      accountId: ACCOUNT_A,
      chainRef: "eip155:1",
      statuses: ["pending"],
      limit: 10,
    });
    expect(page.transactions.map((record) => record.transactionId)).toEqual(["match"]);
  });

  it("keeps recovery artifacts in internal pending reads and out of public reads", async () => {
    const persistence = createTestPersistence();
    const pending = transaction({
      transactionId: "pending",
      chainRef: "eip155:1",
      accountId: ACCOUNT_A,
      createdAt: 100,
      status: "pending",
    });
    assert(pending.state.status === "pending");
    const { recovery: _recovery, ...publicTransaction } = pending;
    await persistence.writer.commit([persistenceTypes.transaction.put(pending)]);

    expect(await persistence.readers.transactions.get(pending.transactionId)).toEqual(publicTransaction);
    expect(await persistence.readers.transactions.list({ limit: 10 })).toEqual({ transactions: [publicTransaction] });
    expect(await persistence.readers.transactions.listPending()).toEqual([pending]);
  });
});
