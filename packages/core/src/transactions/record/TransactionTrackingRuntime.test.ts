import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_REQUESTER,
  createNamespacesStub,
  createNamespaceTransactionStub,
  createRecordViewStub,
  createTransactionsServiceStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  REQUEST_ID,
  toRecord,
} from "../__fixtures__/transactionServices.js";
import { TransactionTrackingRuntime } from "./TransactionTrackingRuntime.js";

describe("TransactionTrackingRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a broadcast record when receipt durable parsing fails", async () => {
    vi.useFakeTimers();
    const record = toRecord({
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef: DEFAULT_CHAIN_REF,
      origin: APPROVAL_REQUESTER.origin,
      from: DEFAULT_FROM,
      createdAt: 1,
      updatedAt: 1,
    });
    const recordView = createRecordViewStub();
    const updateRecordStatus = vi.fn(async () => ({
      ...record,
      status: "failed" as const,
      updatedAt: 2,
    }));
    const runtime = new TransactionTrackingRuntime({
      recordView,
      namespaces: createNamespacesStub(() =>
        createNamespaceTransactionStub({
          parseReceipt: vi.fn(() => {
            throw new Error("Receipt is not durable");
          }) as never,
          tracking: {
            fetchReceipt: vi.fn(async () => ({
              status: "success" as const,
              receipt: { status: "0x1" },
            })),
          },
        }),
      ),
      service: createTransactionsServiceStub({
        get: vi.fn(async () => record),
        updateRecordStatus,
      }),
    });

    runtime.startTracking(recordView.commitRecordView(record).next);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(updateRecordStatus).toHaveBeenCalledWith({
      id: REQUEST_ID,
      fromStatus: "broadcast",
      toStatus: "failed",
      patch: { receipt: { status: "0x1" } },
    });
    expect(runtime.isTracking(REQUEST_ID)).toBe(false);
  });
});
