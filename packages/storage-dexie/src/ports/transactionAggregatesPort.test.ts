import "fake-indexeddb/auto";

import {
  type TransactionAggregate,
  TransactionAggregateNotFoundError,
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

const createAwaitingApprovalAggregate = (
  transactionId: string,
  overrides: Partial<TransactionAggregate["record"]> = {},
): TransactionAggregate => ({
  record: {
    id: transactionId,
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "dapp",
    requestId: "rpc-1",
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "awaiting_approval",
    request: {
      kind: "eip155.rpc.eth_sendTransaction",
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
    },
    approvedRequest: null,
    activeSubmissionId: null,
    submitted: null,
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
  submissionArtifacts: [],
});

const createSubmittingAggregate = (transactionId: string, createdAt = 1_000): TransactionAggregate => ({
  record: {
    id: transactionId,
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "dapp",
    requestId: "rpc-1",
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "submitting",
    request: {
      kind: "eip155.rpc.eth_sendTransaction",
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
        gasLimit: "0x5208",
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
      status: "signed",
      artifactId: `${transactionId}:artifact-1`,
      terminalReason: null,
      createdAt: createdAt + 100,
      updatedAt: createdAt + 200,
    },
  ],
  submissionArtifacts: [
    {
      id: `${transactionId}:artifact-1`,
      transactionId,
      submissionId: `${transactionId}:submission-1`,
      namespace: "eip155",
      chainRef: "eip155:1",
      kind: "eip155.raw_transaction",
      sealedPayload: {
        envelope: "test-only-sealed-payload",
      },
      retention: "until_submitted",
      expiresAt: null,
      createdAt: createdAt + 200,
    },
  ],
});

const getOnlySubmission = (aggregate: TransactionAggregate): TransactionAggregate["submissions"][number] => {
  const submission = aggregate.submissions[0];
  if (!submission) throw new Error(`Expected aggregate "${aggregate.record.id}" to contain a submission.`);
  return submission;
};

const getOnlyArtifact = (aggregate: TransactionAggregate): TransactionAggregate["submissionArtifacts"][number] => {
  const artifact = aggregate.submissionArtifacts[0];
  if (!artifact) throw new Error(`Expected aggregate "${aggregate.record.id}" to contain an artifact.`);
  return artifact;
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
    const port = storage.ports.transactionAggregates;
    const aggregate = createSubmittingAggregate("tx-1");

    await port.insertTransactionAggregate(aggregate);

    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(aggregate);
  });

  it("saveTransactionAggregate() replaces submissions and artifacts in the same aggregate boundary", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;
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
          artifactId: null,
          updatedAt: 2_000,
        },
      ],
      submissionArtifacts: [],
    };

    await port.saveTransactionAggregate(next);

    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(next);
    await expect(storage.__debug.db.transactionSubmissionArtifacts.toArray()).resolves.toEqual([]);
  });

  it("saveTransactionAggregate() fails for missing records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;

    await expect(port.saveTransactionAggregate(createAwaitingApprovalAggregate("missing-tx"))).rejects.toThrow(
      TransactionAggregateNotFoundError,
    );
  });

  it("rolls back insertTransactionAggregate() when a later aggregate part fails", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;
    const first = createSubmittingAggregate("tx-1");
    const duplicateSubmissionId = createSubmittingAggregate("tx-2");
    const firstSubmission = getOnlySubmission(first);
    duplicateSubmissionId.record.activeSubmissionId = firstSubmission.id;
    duplicateSubmissionId.submissions[0] = {
      ...getOnlySubmission(duplicateSubmissionId),
      id: firstSubmission.id,
    };
    duplicateSubmissionId.submissionArtifacts[0] = {
      ...getOnlyArtifact(duplicateSubmissionId),
      submissionId: firstSubmission.id,
    };
    const second = duplicateSubmissionId;

    await port.insertTransactionAggregate(first);
    await expect(port.insertTransactionAggregate(second)).rejects.toThrow();

    await expect(storage.__debug.db.transactionRecords.get("tx-2")).resolves.toBeUndefined();
    await expect(port.loadTransactionAggregate("tx-1")).resolves.toEqual(first);
  });

  it("listTransactionHistory() reads only transactionRecords and paginates newest first", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;
    const older = createSubmittingAggregate("tx-older", 1_000);
    const newer = createSubmittingAggregate("tx-newer", 2_000);
    await port.insertTransactionAggregate(older);
    await port.insertTransactionAggregate(newer);
    const artifactWhere = vi.spyOn(storage.__debug.db.transactionSubmissionArtifacts, "where");
    const artifactToArray = vi.spyOn(storage.__debug.db.transactionSubmissionArtifacts, "toArray");

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
    expect(artifactWhere).not.toHaveBeenCalled();
    expect(artifactToArray).not.toHaveBeenCalled();
  });

  it("findTransactionRecordsByConflictKey() returns matching records newest first", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;
    const conflictKey = {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    };
    const older = createAwaitingApprovalAggregate("tx-older", {
      conflictKey,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    const newer = createAwaitingApprovalAggregate("tx-newer", {
      conflictKey,
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    const unrelated = createAwaitingApprovalAggregate("tx-unrelated", {
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

  it("listRecoverableTransactionAggregates() includes active candidates and excludes terminal records", async () => {
    const storage = createTestStorage();
    const port = storage.ports.transactionAggregates;
    const awaiting = createAwaitingApprovalAggregate("tx-awaiting", {
      createdAt: 1_000,
      updatedAt: 1_000,
    });
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
        },
      ],
    };
    const failed = createAwaitingApprovalAggregate("tx-failed", {
      status: "failed",
      terminalReason: createTerminalReason("prepare_failed"),
      createdAt: 4_000,
      updatedAt: 4_000,
    });

    await port.insertTransactionAggregate(awaiting);
    await port.insertTransactionAggregate(submitting);
    await port.insertTransactionAggregate(submitted);
    await port.insertTransactionAggregate(failed);

    const candidates = await port.listRecoverableTransactionAggregates();
    expect(candidates.map((aggregate) => aggregate.record.id)).toEqual([
      "tx-submitted",
      "tx-submitting",
      "tx-awaiting",
    ]);
  });
});
