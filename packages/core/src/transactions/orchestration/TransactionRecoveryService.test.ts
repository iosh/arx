import { describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../../storage/records.js";
import {
  APPROVAL_REQUESTER,
  accountCodecs,
  createNamespacesStub,
  createRecordViewStub,
  createTransactionsServiceStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_SUBMITTED,
} from "../__fixtures__/transactionServices.js";
import { TransactionRecordRuntime } from "../record/TransactionRecordRuntime.js";
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
        accountAddress: DEFAULT_FROM,
        accountKey: record.accountKey,
        status: record.status,
        submitted: record.submitted,
        receipt: record.receipt,
        replacementKey: record.replacementKey,
        replacedByRecordId: record.replacedByRecordId,
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
          namespace: "eip155",
          chainRef: DEFAULT_CHAIN_REF,
          origin: APPROVAL_REQUESTER.origin,
          accountKey: accountCodecs.toAccountKeyFromAddress({
            chainRef: DEFAULT_CHAIN_REF,
            address: DEFAULT_FROM,
          }),
          status: "broadcast",
          submitted: DEFAULT_SUBMITTED,
          receipt: null,
          replacementKey: null,
          replacedByRecordId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      .mockResolvedValueOnce([]);

    const records = new TransactionRecordRuntime({
      proposalRuntime: {
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
