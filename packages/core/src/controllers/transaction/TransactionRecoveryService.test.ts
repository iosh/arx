import { describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../../storage/records.js";
import {
  accountCodecs,
  createNamespacesStub,
  createReceiptTrackingStub,
  createRecordViewStub,
  createTransactionsServiceStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_SUBMITTED,
  REQUEST_CONTEXT,
} from "./__fixtures__/transactionServices.js";
import { TransactionRecordRuntime } from "./TransactionRecordRuntime.js";
import { createTransactionRecoveryService } from "./TransactionRecoveryService.js";

describe("createTransactionRecoveryService", () => {
  it("resumes approved proposals and broadcast records", async () => {
    const resumeApprovedProposals = vi.fn(async () => {});
    const commitRecordView = vi.fn((record: TransactionRecord) => ({
      next: {
        kind: "record" as const,
        id: record.id,
        namespace: "eip155",
        chainRef: record.chainRef,
        origin: record.origin,
        from: DEFAULT_FROM,
        status: record.status,
        submitted: record.submitted,
        receipt: record.receipt ?? null,
        replacedId: record.replacedId ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    }));
    const tracker = {
      start: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      isTracking: vi.fn(() => false),
      pending: vi.fn(() => 0),
    };
    const recordView = createRecordViewStub({
      commitRecordView,
    });
    const list = vi
      .fn<(params?: unknown) => Promise<TransactionRecord[]>>()
      .mockResolvedValueOnce([
        {
          id: "durable-tx",
          chainRef: DEFAULT_CHAIN_REF,
          origin: REQUEST_CONTEXT.origin,
          fromAccountKey: accountCodecs.toAccountKeyFromAddress({
            chainRef: DEFAULT_CHAIN_REF,
            address: DEFAULT_FROM,
          }),
          status: "broadcast",
          submitted: DEFAULT_SUBMITTED,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      .mockResolvedValueOnce([]);

    const records = new TransactionRecordRuntime({
      proposalStore: {
        clearProposalAfterRecordPersisted: vi.fn(),
        delete: vi.fn(),
      },
      recordView,
      accountCodecs,
      namespaces: createNamespacesStub() as never,
      service: createTransactionsServiceStub({
        list: list as never,
      }),
      submission: {
        recordPersisted: vi.fn(),
        recordPersistenceFailure: vi.fn(),
      },
      tracker: tracker as never,
    });
    const recovery = createTransactionRecoveryService({
      execution: { resumeApprovedProposals },
      records,
    });

    await recovery.resumeTransactions();

    expect(resumeApprovedProposals).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(commitRecordView).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "durable-tx",
        status: "broadcast",
      }),
    );
    expect(tracker.resume).toHaveBeenCalledTimes(1);
  });
});
