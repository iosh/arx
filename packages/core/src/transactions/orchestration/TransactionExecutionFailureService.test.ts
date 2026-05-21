import { describe, expect, it, vi } from "vitest";
import { createProposalRuntime, createTransactionProposal, REQUEST_ID } from "../__fixtures__/transactionServices.js";
import type { TransactionError } from "../types.js";
import { TransactionExecutionFailureService } from "./TransactionExecutionFailureService.js";

describe("TransactionExecutionFailureService", () => {
  it("fails an active proposal and records submission failure before durable persistence", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "approved",
      prepared: {},
    });

    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const service = new TransactionExecutionFailureService({
      proposalRuntime,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 2,
    });

    await service.finalizeExecutionFailure({
      id: REQUEST_ID,
      reason: new Error("User cancelled"),
      terminationReason: "execution_failed",
    });

    expect(proposalRuntime.get(REQUEST_ID)).toMatchObject({
      status: "terminated",
      termination: {
        reason: "execution_failed",
        error: {
          message: "User cancelled",
        },
        userRejected: false,
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
    const proposalRuntime = createProposalRuntime();
    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const reason: TransactionError = {
      name: "Error",
      message: "Late failure",
    };

    const service = new TransactionExecutionFailureService({
      proposalRuntime,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 1,
    });

    await service.finalizeExecutionFailure({
      id: "missing",
      reason,
      terminationReason: "execution_failed",
    });

    expect(recordSubmissionFailure).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith("missing", reason);
  });

  it("falls through to durable record failure once the proposal is already terminal", async () => {
    const proposalRuntime = createProposalRuntime();
    createTransactionProposal(proposalRuntime, {
      status: "terminated",
      error: {
        name: "Error",
        message: "already failed",
      },
      terminationReason: "execution_failed",
    });

    const recordFailure = vi.fn(async () => {});
    const recordSubmissionFailure = vi.fn();
    const reason: TransactionError = {
      name: "Error",
      message: "Late failure",
    };

    const service = new TransactionExecutionFailureService({
      proposalRuntime,
      submission: {
        recordFailure: recordSubmissionFailure,
      },
      records: {
        failRecord: recordFailure,
      },
      now: () => 2,
    });

    await service.finalizeExecutionFailure({
      id: REQUEST_ID,
      reason,
      terminationReason: "execution_failed",
    });

    expect(recordSubmissionFailure).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(REQUEST_ID, reason);
  });
});
