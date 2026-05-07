import { describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../../storage/records.js";
import {
  accountCodecs,
  createRecordViewStub,
  createTransactionsServiceStub,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_SUBMITTED,
  REQUEST_CONTEXT,
} from "./__fixtures__/transactionServices.js";
import { TransactionRecordService } from "./TransactionRecordService.js";
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
    const resumeBroadcast = vi.fn();
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

    const records = new TransactionRecordService({
      proposalStore: {
        clearProposalAfterRecordPersisted: vi.fn(),
        delete: vi.fn(),
      },
      recordView,
      accountCodecs,
      service: createTransactionsServiceStub({
        list: list as never,
      }),
      submission: {
        recordPersistenceFailure: vi.fn(),
      },
      tracking: {
        handleTransition: vi.fn(),
        resumeBroadcast,
        stop: vi.fn(),
      } as never,
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
    expect(resumeBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "durable-tx",
        status: "broadcast",
      }),
    );
  });
});
