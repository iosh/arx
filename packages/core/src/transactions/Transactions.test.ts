import { describe, expect, it, vi } from "vitest";
import type { AccountId } from "../accounts/addressing/accountId.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import type {
  BroadcastingTransactionRecord,
  SubmittedTransactionRecord,
  SubmittingTransactionRecord,
  TransactionConflictKey,
  TransactionHistoryQuery,
  TransactionRecord,
} from "./persistence.js";
import { createTransactions } from "./Transactions.js";
import type { TransactionNamespaceAdapter } from "./transactionNamespace.js";

const ACCOUNT_ID = "eip155:0000000000000000000000000000000000000001" as AccountId;
const CONFLICT_KEY: TransactionConflictKey = { kind: "eip155.nonce", value: "eip155:1:account:1" };

const submittedRecord = (transactionId: string): SubmittedTransactionRecord => ({
  transactionId,
  chainRef: "eip155:1",
  accountId: ACCOUNT_ID,
  origin: "https://app.example",
  source: "provider",
  createAt: 1,
  signingPayload: { nonce: "0x1" },
  conflictKey: CONFLICT_KEY,
  status: "submitted",
  networkSubmission: { hash: `0x${transactionId}` },
});

const localRecord = (
  transactionId: string,
  status: "submitting" | "broadcasting",
): SubmittingTransactionRecord | BroadcastingTransactionRecord => ({
  transactionId,
  chainRef: "eip155:1",
  accountId: ACCOUNT_ID,
  origin: "https://app.example",
  source: "provider",
  createAt: 1,
  signingPayload: { nonce: "0x1" },
  conflictKey: CONFLICT_KEY,
  status,
});

type HarnessOptions = {
  records?: readonly TransactionRecord[];
  bootstrap?: readonly TransactionRecord[];
  inspect?: TransactionNamespaceAdapter["inspect"];
  onBroadcast?: (records: Map<string, TransactionRecord>) => void;
};

const createHarness = async (options: HarnessOptions = {}) => {
  const records = new Map((options.records ?? []).map((record) => [record.transactionId, record]));
  const commits: readonly PersistenceChange[][] = [];
  const readers = {
    transactions: {
      get: vi.fn(async (transactionId: string) => records.get(transactionId) ?? null),
      listHistory: vi.fn(async (_query: TransactionHistoryQuery) => ({ transactions: [...records.values()] })),
      listByConflictKey: vi.fn(async ({ chainRef, conflictKey }) =>
        [...records.values()].filter(
          (record) =>
            record.chainRef === chainRef &&
            record.conflictKey?.kind === conflictKey.kind &&
            record.conflictKey.value === conflictKey.value,
        ),
      ),
      listByStatuses: vi.fn(async (statuses) =>
        [...records.values()].filter((record) => statuses.includes(record.status)),
      ),
      existsByChainRefAndStatuses: vi.fn(async () => false),
      listIds: vi.fn(async () => [...records.keys()]),
    },
  };
  const adapter: TransactionNamespaceAdapter = {
    namespace: "eip155",
    getResourceKey: (input) => ({ kind: "eip155.account", value: `${input.chainRef}:${input.accountId}` }),
    finalize: vi.fn(async ({ submission }) => ({
      status: "ready" as const,
      signingPayload: submission.finalizationPayload,
      conflictKey: CONFLICT_KEY,
    })),
    createReplacementPayload: vi.fn(async ({ target, type }) => ({ target: target.transactionId, type })),
    sign: vi.fn(async () => ({ raw: "0xsigned" })),
    broadcast: vi.fn(async () => {
      options.onBroadcast?.(records);
      return { status: "submitted" as const, networkSubmission: { hash: "0xsubmitted" } };
    }),
    inspect: options.inspect ?? vi.fn(async () => ({ status: "pending" as const })),
    getInitialInspectionDelay: () => 0,
    getPendingInspectionDelay: () => 1_000,
    getRetryInspectionDelay: () => 1_000,
  };
  const changed: string[][] = [];
  const transactions = await createTransactions({
    readers,
    mutations: createCoreMutationQueue({
      commit: async (changes) => {
        (commits as PersistenceChange[][]).push([...changes]);
        for (const change of changes) {
          if (change.persistenceType !== "transaction") continue;
          if (change.operation === "put") records.set(change.value.transactionId, change.value);
          else records.delete(change.key);
        }
      },
    }),
    adapters: new Map([[adapter.namespace, adapter]]),
    bootstrap: { activeTransactions: options.bootstrap ?? [] },
    publishChanged: ({ transactionIds }) => changed.push([...transactionIds]),
  });
  return { transactions, records, commits, readers, adapter, changed };
};

const submission = (replacementTargetId?: string) => ({
  chainRef: "eip155:1",
  accountId: ACCOUNT_ID,
  origin: "https://app.example",
  source: "provider" as const,
  finalizationPayload: { nonce: "0x1" },
  ...(replacementTargetId ? { replacementTargetId } : {}),
});

describe("Transactions", () => {
  it("commits broadcasting before invoking the external broadcaster", async () => {
    const harness = await createHarness({
      onBroadcast: (records) => {
        expect([...records.values()][0]?.status).toBe("broadcasting");
      },
    });

    const result = await harness.transactions.submit(submission());

    expect(result.status).toBe("submitted");
    expect(harness.commits.map((changes) => (changes[0] as { value: TransactionRecord }).value.status)).toEqual([
      "submitting",
      "broadcasting",
      "submitted",
    ]);
  });

  it("blocks creation when an active transaction owns the conflict key", async () => {
    const existing = submittedRecord("existing");
    const harness = await createHarness({ records: [existing] });

    await expect(harness.transactions.submit(submission())).rejects.toMatchObject({
      code: "transaction.conflict",
      details: { conflictingTransactionIds: ["existing"] },
    });
    expect(harness.commits).toHaveLength(0);
  });

  it("requires a submitted replacement target with the same conflict key", async () => {
    const harness = await createHarness();

    await expect(harness.transactions.submit(submission("missing"))).rejects.toMatchObject({
      code: "transaction.replacement_target_invalid",
      details: { targetTransactionId: "missing" },
    });
    expect(harness.commits).toHaveLength(0);
  });

  it("allows a replacement to enter submitting when its target is submitted", async () => {
    const target = submittedRecord("target");
    const harness = await createHarness({ records: [target] });

    const replacement = await harness.transactions.submit(submission("target"));

    expect(replacement.status).toBe("submitted");
    expect(harness.commits[0]).toEqual([
      expect.objectContaining({
        persistenceType: "transaction",
        operation: "put",
        value: expect.objectContaining({ status: "submitting", conflictKey: CONFLICT_KEY }),
      }),
    ]);
  });

  it("recovers interrupted stages and preserves submitted tracking", async () => {
    const submittingRecord = localRecord("submitting", "submitting");
    const broadcastingRecord = localRecord("broadcasting", "broadcasting");
    const submitted = submittedRecord("submitted");
    const harness = await createHarness({
      records: [submittingRecord, broadcastingRecord, submitted],
      bootstrap: [submittingRecord, broadcastingRecord, submitted],
    });

    expect(harness.commits).toHaveLength(1);
    expect(harness.records.get("submitting")).toMatchObject({ status: "failed", phase: "submitting" });
    expect(harness.records.get("broadcasting")).toMatchObject({ status: "failed", phase: "broadcasting" });
    expect(harness.transactions.monitor.getNextInspectionAt()).not.toBeNull();
  });

  it("commits a confirmed winner and submitted conflicts together", async () => {
    const winner = submittedRecord("winner");
    const replaced = submittedRecord("replaced");
    const inspect = vi.fn(async (record: SubmittedTransactionRecord) =>
      record.transactionId === "winner"
        ? ({ status: "confirmed" as const, confirmation: { blockNumber: "0x1" } } as const)
        : ({ status: "pending" as const } as const),
    );
    const harness = await createHarness({
      records: [winner, replaced],
      bootstrap: [winner, replaced],
      inspect,
    });

    await harness.transactions.monitor.runDue(Date.now() + 1);

    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]?.map((change) => (change as { value: TransactionRecord }).value.status)).toEqual([
      "confirmed",
      "replaced",
    ]);
    expect(harness.records.get("replaced")).toMatchObject({
      status: "replaced",
      replacedByTransactionId: "winner",
    });
    expect(harness.readers.transactions.get).toHaveBeenCalledWith("winner");
  });
});
