import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { CoreTime } from "../runtime/time.js";
import type { PendingTransactionInspection, TransactionsNamespaceAdapter } from "./namespaceAdapter.js";
import type { PendingTransactionRecord, TransactionRecord } from "./persistence.js";
import { TRANSACTION_INSPECTION_INTERVAL_MS, TransactionMonitor } from "./TransactionMonitor.js";

const pendingRecord: PendingTransactionRecord = {
  transactionId: "transaction-1",
  namespace: "eip155",
  chainRef: "eip155:1",
  accountId: "eip155:0000000000000000000000000000000000000001",
  initiator: { type: "wallet" },
  transaction: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
    gas: "0x5208",
    nonce: "0x1",
    fee: { type: "legacy", gasPrice: "0x1" },
  },
  state: { status: "pending" },
  recovery: { rawTransaction: "0xdeadbeef" },
  createdAt: 1,
  updatedAt: 1,
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

const createHarness = (input: {
  recovery: PendingTransactionInspection[];
  inspection: PendingTransactionInspection[];
}) => {
  const scheduled: ScheduledTask[] = [];
  const events: string[] = [];
  const commits: TransactionRecord[] = [];
  const order: string[] = [];
  const inspectPending = vi.fn(async () => input.inspection.shift() ?? { status: "pending" as const });
  const recoverPending = vi.fn(async () => input.recovery.shift() ?? { status: "pending" as const });
  const adapter = {
    namespace: "eip155",
    prepare: async () => unexpected(),
    createSigningInput: async () => unexpected(),
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
      order.push("commit");
      commits.push(changes[0]?.value as TransactionRecord);
    },
  });
  const monitor = new TransactionMonitor({
    adapters: { eip155: adapter },
    mutations,
    time,
    publishChanged: ({ transactionIds }) => {
      order.push("publish");
      events.push(...transactionIds);
    },
  });

  return {
    monitor,
    scheduled,
    inspectPending,
    recoverPending,
    commits,
    events,
    order,
    time,
  };
};

describe("TransactionMonitor", () => {
  it("retries restored records before committing a receipt-proven terminal state", async () => {
    const harness = createHarness({
      recovery: [{ status: "unavailable" }, { status: "pending" }],
      inspection: [
        {
          status: "terminal",
          state: {
            status: "confirmed",
            confirmation: {
              blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              blockNumber: "0x1",
              transactionIndex: "0x0",
              gasUsed: "0x5208",
            },
          },
        },
      ],
    });

    harness.monitor.restore([pendingRecord]);
    expect(harness.scheduled.map(({ delayMs }) => delayMs)).toEqual([0]);

    harness.scheduled[0]?.task();
    await flush();
    expect(harness.recoverPending).toHaveBeenCalledOnce();
    expect(harness.commits).toEqual([]);
    expect(harness.events).toEqual([]);

    harness.scheduled[1]?.task();
    await flush();
    expect(harness.recoverPending).toHaveBeenCalledTimes(2);
    expect(harness.inspectPending).not.toHaveBeenCalled();

    harness.scheduled[2]?.task();
    await flush();

    expect(harness.inspectPending).toHaveBeenCalledOnce();
    expect(harness.commits[0]).toMatchObject({
      transactionId: pendingRecord.transactionId,
      state: { status: "confirmed" },
      updatedAt: 100,
    });
    expect(harness.commits[0]).not.toHaveProperty("recovery");
    expect(harness.events).toEqual([pendingRecord.transactionId]);
    expect(harness.order).toEqual(["commit", "publish"]);
    expect(harness.time.now).toHaveBeenCalledOnce();
    expect(harness.scheduled[1]?.delayMs).toBe(TRANSACTION_INSPECTION_INTERVAL_MS);
    expect(harness.scheduled[2]?.delayMs).toBe(TRANSACTION_INSPECTION_INTERVAL_MS);
  });
});
