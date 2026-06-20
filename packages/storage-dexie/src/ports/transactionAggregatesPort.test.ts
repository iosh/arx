import "fake-indexeddb/auto";

import {
  type TransactionAggregate,
  TransactionAggregateAlreadyExistsError,
  TransactionAggregateNotFoundError,
  TransactionConflictKeyCollisionError,
  type TransactionTerminalReason,
} from "@arx/core/transactions/storage";
import { Dexie } from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDexieStorage } from "../createDexieStorage.js";

const DB_NAME = "arx-transaction-aggregates-port-test";
const storages: Array<ReturnType<typeof createDexieStorage>> = [];

const createTestStorage = (): ReturnType<typeof createDexieStorage> => {
  const storage = createDexieStorage({ databaseName: DB_NAME });
  storages.push(storage);
  return storage;
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const storage of storages.splice(0)) storage.close();
  await Dexie.delete(DB_NAME);
});

const createSubmittedAggregateRecord = (
  transactionId: string,
  overrides: Partial<TransactionAggregate["record"]> = {},
): TransactionAggregate => ({
  record: {
    id: transactionId,
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "provider",
    requestId: "rpc-1",
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "submitted",
    request: {
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
    },
    approvedRequest: {
      approvalId: `approval:${transactionId}`,
      payload: {
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x7",
      },
      approvedAt: 1_100,
    },
    activeSubmissionId: null,
    submitted: {
      hash: `0x${transactionId
        .replace(/[^a-f0-9]/gi, "")
        .padEnd(64, "0")
        .slice(0, 64)}`,
    },
    receipt: null,
    conflictKey: null,
    replacesTransactionId: null,
    replacementType: null,
    replacedByTransactionId: null,
    terminalReason: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  },
  submissions: [],
});

const createSubmittingAggregate = (transactionId: string, createdAt = 1_000): TransactionAggregate => ({
  record: {
    id: transactionId,
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "provider",
    requestId: "rpc-1",
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "submitting",
    request: {
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
    },
    approvedRequest: {
      approvalId: "approval-1",
      payload: {
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
        data: "0x",
        gas: "0x5208",
        nonce: "0x7",
      },
      approvedAt: createdAt + 100,
    },
    activeSubmissionId: `${transactionId}:submission-1`,
    submitted: null,
    receipt: null,
    conflictKey: {
      kind: "eip155.nonce",
      value: `eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:${transactionId}`,
    },
    replacesTransactionId: null,
    replacementType: null,
    replacedByTransactionId: null,
    terminalReason: null,
    createdAt,
    updatedAt: createdAt + 100,
  },
  submissions: [
    {
      id: `${transactionId}:submission-1`,
      transactionId,
      status: "signing",
      terminalReason: null,
      createdAt: createdAt + 100,
      updatedAt: createdAt + 200,
    },
  ],
});

const getOnlySubmission = (aggregate: TransactionAggregate): TransactionAggregate["submissions"][number] => {
  const submission = aggregate.submissions[0];
  if (!submission) throw new Error(`Expected aggregate "${aggregate.record.id}" to contain a submission.`);
  return submission;
};

const createTerminalReason = (kind: TransactionTerminalReason["kind"]): TransactionTerminalReason => ({
  kind,
  message: "Transaction preparation failed.",
  namespace: null,
  code: kind,
  details: null,
  retryable: false,
});

describe("DexieTransactionAggregatesPort", () => {
  it("insertTransactionAggregate() + loadTransactionAggregate() roundtrips all aggregate parts", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const aggregate = createSubmittingAggregate("tx-1");

    await port.insertTransactionAggregate(aggregate);

    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(aggregate);
  });

  it("saveTransactionAggregate() replaces submissions in the same aggregate boundary", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const aggregate = createSubmittingAggregate("tx-1");
    await port.insertTransactionAggregate(aggregate);

    const next: TransactionAggregate = {
      record: {
        ...aggregate.record,
        status: "submitted",
        activeSubmissionId: null,
        submitted: {
          hash: "0x1111",
          chainId: "0x1",
        },
        updatedAt: 2_000,
      },
      submissions: [
        {
          ...getOnlySubmission(aggregate),
          status: "accepted",
          updatedAt: 2_000,
        },
      ],
    };

    await port.saveTransactionAggregate(next);

    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(next);
  });

  it("saveTransactionAggregate() fails for missing records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;

    await expect(port.saveTransactionAggregate(createSubmittedAggregateRecord("missing-tx"))).rejects.toThrow(
      TransactionAggregateNotFoundError,
    );
  });

  it("rolls back insertTransactionAggregate() when a later aggregate part fails", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const first = createSubmittingAggregate("tx-1");
    const duplicateSubmissionId = createSubmittingAggregate("tx-2");
    const firstSubmission = getOnlySubmission(first);
    duplicateSubmissionId.record.activeSubmissionId = firstSubmission.id;
    duplicateSubmissionId.submissions[0] = {
      ...getOnlySubmission(duplicateSubmissionId),
      id: firstSubmission.id,
    };
    const second = duplicateSubmissionId;

    await port.insertTransactionAggregate(first);
    await expect(port.insertTransactionAggregate(second)).rejects.toThrow();

    await expect(storage.__debug.db.transactionRecords.get("tx-2")).resolves.toBeUndefined();
    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(first);
  });

  it("listTransactionHistory() reads only transactionRecords and paginates newest first", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const older = createSubmittingAggregate("tx-older", 1_000);
    const newer = createSubmittingAggregate("tx-newer", 2_000);
    await port.insertTransactionAggregate(older);
    await port.insertTransactionAggregate(newer);
    const submissionsWhere = vi.spyOn(storage.__debug.db.transactionSubmissions, "where");
    const submissionsToArray = vi.spyOn(storage.__debug.db.transactionSubmissions, "toArray");

    const firstPage = await port.listTransactionHistory({
      chainRef: "eip155:1",
      limit: 1,
    });
    expect(firstPage.map((record) => record.id)).toEqual(["tx-newer"]);

    const secondPage = await port.listTransactionHistory({
      chainRef: "eip155:1",
      limit: 1,
      before: {
        createdAt: firstPage[0]?.createdAt ?? 0,
        id: firstPage[0]?.id ?? "",
      },
    });
    expect(secondPage.map((record) => record.id)).toEqual(["tx-older"]);
    expect(submissionsWhere).not.toHaveBeenCalled();
    expect(submissionsToArray).not.toHaveBeenCalled();
  });

  it("listTransactionHistory() returns all matching records when limit is omitted", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const older = createSubmittingAggregate("tx-older", 1_000);
    const newer = createSubmittingAggregate("tx-newer", 2_000);

    await port.insertTransactionAggregate(older);
    await port.insertTransactionAggregate(newer);

    const records = await port.listTransactionHistory({
      chainRef: "eip155:1",
    });

    expect(records.map((record) => record.id)).toEqual(["tx-newer", "tx-older"]);
  });

  it("findTransactionRecordsByConflictKey() returns matching records newest first", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const conflictKey = {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    };
    const older = createSubmittedAggregateRecord("tx-older", {
      conflictKey,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    const newer = createSubmittedAggregateRecord("tx-newer", {
      conflictKey,
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    const unrelated = createSubmittedAggregateRecord("tx-unrelated", {
      conflictKey: {
        ...conflictKey,
        value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x8",
      },
      createdAt: 3_000,
      updatedAt: 3_000,
    });

    await port.insertTransactionAggregate(older);
    await port.insertTransactionAggregate(newer);
    await port.insertTransactionAggregate(unrelated);

    const records = await port.findTransactionRecordsByConflictKey(conflictKey);
    expect(records.map((record) => record.id)).toEqual(["tx-newer", "tx-older"]);
  });

  it("insertApprovedTransactionAggregate() rejects conflicting active records atomically", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;

    const first = createSubmittingAggregate("tx-1");
    first.record.conflictKey = {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    };
    const second = createSubmittingAggregate("tx-2");
    second.record.conflictKey = {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    };
    await port.insertTransactionAggregate(first);

    await expect(port.insertApprovedTransactionAggregate({ aggregate: second })).rejects.toBeInstanceOf(
      TransactionConflictKeyCollisionError,
    );
    await expect(port.loadTransactionAggregate("tx-2")).resolves.toBeNull();
  });

  it("insertApprovedTransactionAggregate() rejects duplicate transaction ids", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;

    const first = createSubmittingAggregate("tx-1");
    const duplicate = createSubmittingAggregate("tx-1");
    await port.insertTransactionAggregate(first);

    await expect(port.insertApprovedTransactionAggregate({ aggregate: duplicate })).rejects.toBeInstanceOf(
      TransactionAggregateAlreadyExistsError,
    );
  });

  it("listRecoverableTransactionAggregates() includes active candidates and excludes terminal records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactions;
    const submitting = createSubmittingAggregate("tx-submitting", 2_000);
    const submittedBase = createSubmittingAggregate("tx-submitted", 3_000);
    const submitted: TransactionAggregate = {
      ...submittedBase,
      record: {
        ...submittedBase.record,
        status: "submitted",
        activeSubmissionId: null,
        submitted: {
          hash: "0x2222",
        },
      },
      submissions: [
        {
          ...getOnlySubmission(submittedBase),
          status: "accepted",
          terminalReason: null,
        },
      ],
    };
    const confirmed = createSubmittedAggregateRecord("tx-confirmed", {
      status: "confirmed",
      terminalReason: createTerminalReason("on_chain_failed"),
      createdAt: 4_000,
      updatedAt: 4_000,
    });

    await port.insertTransactionAggregate(submitting);
    await port.insertTransactionAggregate(submitted);
    await port.insertTransactionAggregate(confirmed);

    const candidates = await port.listRecoverableTransactionAggregates();

    expect(candidates.map((aggregate) => aggregate.record.id)).toEqual(["tx-submitted", "tx-submitting"]);
  });
});
