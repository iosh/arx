import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import type { PendingTransactionInspection, TransactionsNamespaceAdapter } from "./namespaceAdapter.js";
import type { PendingTransactionRecord, TransactionRecord } from "./persistence.js";
import { TRANSACTION_INSPECTION_INTERVAL_MS, TransactionMonitor } from "./TransactionMonitor.js";

const pendingTransaction = {
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  nonce: "0x1",
  type: "legacy",
  gasPrice: "0x1",
} as const;

const pendingRecord: PendingTransactionRecord = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
  transaction: pendingTransaction,
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
};

const replacementRecord: PendingTransactionRecord = {
  ...pendingRecord,
  transactionId: "transaction-2",
  replacesTransactionId: pendingRecord.transactionId,
  transaction: {
    ...pendingTransaction,
    gasPrice: "0x2",
  },
  recovery: { rawTransaction: "0xcafebabe" },
  createdAt: 2,
  updatedAt: 2,
};

type ScheduledTask = {
  delayMs: number;
  task(): void;
  cancelled: boolean;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const unexpected = (): never => {
  throw new Error("Unexpected transaction operation.");
};

const createHarness = (input?: {
  recovery?: PendingTransactionInspection[];
  inspection?: PendingTransactionInspection[];
}) => {
  const scheduled: ScheduledTask[] = [];
  const events: string[][] = [];
  const commits: TransactionRecord[][] = [];
  const inspectPending = vi.fn(
    async () => input?.inspection?.shift() ?? { status: "checked" as const, terminalChanges: [] },
  );
  const recoverPending = vi.fn(
    async () => input?.recovery?.shift() ?? { status: "checked" as const, terminalChanges: [] },
  );
  const adapter = {
    namespace: "eip155",
    prepare: async () => unexpected(),
    prepareReplacement: async () => unexpected(),
    withSigningInput: async () => unexpected(),
    sign: async () => unexpected(),
    broadcast: async () => unexpected(),
    createSubmission: unexpected,
    inspectPending,
    recoverPending,
  } satisfies TransactionsNamespaceAdapter;
  const time = {
    now: vi.fn(() => 100),
    schedule: (delayMs: number, task: () => void) => {
      const scheduledTask: ScheduledTask = { delayMs, task, cancelled: false };
      scheduled.push(scheduledTask);
      return () => {
        scheduledTask.cancelled = true;
      };
    },
  } satisfies CoreTime;
  const mutations = createCoreMutationQueue({
    commit: async (changes) => {
      commits.push(
        changes.map((change) => {
          if (change.operation !== "put") return unexpected();
          return change.value as TransactionRecord;
        }),
      );
    },
  });
  const monitor = new TransactionMonitor({
    adapters: { eip155: adapter },
    mutations,
    time,
    publishChanged: ({ transactionIds }) => events.push([...transactionIds]),
  });

  return { monitor, scheduled, inspectPending, recoverPending, commits, events };
};

describe("TransactionMonitor", () => {
  it("recovers one chain batch and commits its terminal changes atomically", async () => {
    const confirmation = {
      blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      blockNumber: "0x1" as const,
      transactionIndex: "0x0" as const,
      gasUsed: "0x5208" as const,
    };
    const harness = createHarness({
      recovery: [{ status: "unavailable" }, { status: "checked", terminalChanges: [] }],
      inspection: [
        {
          status: "checked",
          terminalChanges: [
            {
              transactionId: pendingRecord.transactionId,
              state: { status: "confirmed", confirmation },
            },
            {
              transactionId: replacementRecord.transactionId,
              state: {
                status: "replaced",
                replacement: { type: "local", transactionId: pendingRecord.transactionId },
              },
            },
          ],
        },
      ],
    });

    harness.monitor.restore([pendingRecord, replacementRecord]);
    expect(harness.scheduled.map(({ delayMs }) => delayMs)).toEqual([0]);

    harness.scheduled[0]?.task();
    await flush();
    expect(harness.recoverPending).toHaveBeenCalledWith(
      [pendingRecord, replacementRecord],
      [pendingRecord.transactionId, replacementRecord.transactionId],
    );
    expect(harness.commits).toEqual([]);

    harness.scheduled[1]?.task();
    await flush();
    harness.scheduled[2]?.task();
    await flush();

    expect(harness.inspectPending).toHaveBeenCalledWith([pendingRecord, replacementRecord]);
    expect(harness.commits).toHaveLength(1);
    expect(harness.commits[0]?.map(({ state }) => state.status)).toEqual(["confirmed", "replaced"]);
    expect(harness.commits[0]?.every((record) => !("recovery" in record))).toBe(true);
    expect(harness.events).toEqual([[pendingRecord.transactionId, replacementRecord.transactionId]]);
  });

  it("checks pending records in separate chainRef batches", async () => {
    const otherChainRecord: PendingTransactionRecord = {
      ...pendingRecord,
      transactionId: "transaction-3",
      chainRef: "eip155:10",
    };
    const harness = createHarness();

    harness.monitor.track(pendingRecord);
    harness.monitor.track(otherChainRecord);
    expect(harness.scheduled.map(({ delayMs }) => delayMs)).toEqual([TRANSACTION_INSPECTION_INTERVAL_MS]);

    harness.scheduled[0]?.task();
    await flush();

    expect(harness.inspectPending.mock.calls).toEqual([[[pendingRecord]], [[otherChainRecord]]]);
    expect(harness.recoverPending).not.toHaveBeenCalled();
  });
});
