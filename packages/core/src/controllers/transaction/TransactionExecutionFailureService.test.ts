import { describe, expect, it, vi } from "vitest";
import type { TransactionError } from "../../transactions/types.js";
import { createProposalStore, createTransactionProposal, REQUEST_ID } from "./__fixtures__/transactionServices.js";
import { TransactionExecutionFailureService } from "./TransactionExecutionFailureService.js";

describe("TransactionExecutionFailureService", () => {
  it("fails an active proposal and records submission failure before durable persistence", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      status: "approved",
      prepared: {},
    });

    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const service = new TransactionExecutionFailureService({
      proposalStore,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 2,
    });

    await service.finalizeExecutionFailure(REQUEST_ID, new Error("User cancelled"));

    expect(proposalStore.get(REQUEST_ID)).toMatchObject({
      status: "failed",
      error: {
        message: "User cancelled",
      },
    });
    expect(recordSubmissionFailure).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.objectContaining({
        transactionId: REQUEST_ID,
        message: "User cancelled",
      }),
    );
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("falls through to durable record failure once the proposal is no longer active", async () => {
    const proposalStore = createProposalStore();
    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const reason: TransactionError = {
      name: "Error",
      message: "Late failure",
    };

    const service = new TransactionExecutionFailureService({
      proposalStore,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 1,
    });

    await service.finalizeExecutionFailure("missing", reason);

    expect(recordSubmissionFailure).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith("missing", reason);
  });

  it("falls through to durable record failure once the proposal is already terminal", async () => {
    const proposalStore = createProposalStore();
    createTransactionProposal(proposalStore, {
      status: "failed",
      error: {
        name: "Error",
        message: "already failed",
      },
    });

    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const reason: TransactionError = {
      name: "Error",
      message: "Late failure",
    };

    const service = new TransactionExecutionFailureService({
      proposalStore,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 2,
    });

    await service.finalizeExecutionFailure(REQUEST_ID, reason);

    expect(recordSubmissionFailure).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(REQUEST_ID, reason);
  });
});
