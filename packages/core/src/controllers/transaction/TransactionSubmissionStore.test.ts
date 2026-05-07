import { describe, expect, it } from "vitest";
import { createRecordViewStub, DEFAULT_SUBMITTED } from "./__fixtures__/transactionServices.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";

describe("TransactionSubmissionStore", () => {
  it("resolves waiters after broadcast submission is recorded", async () => {
    const submissionService = new TransactionSubmissionStore({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    const pending = submissionService.waitForSubmissionOutcome("tx-1");
    submissionService.recordSubmitted("tx-1", {
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(pending).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
    });
  });

  it("rejects waiters after a pre-broadcast failure is recorded", async () => {
    const submissionService = new TransactionSubmissionStore({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    const pending = submissionService.waitForSubmissionOutcome("tx-2");
    submissionService.recordFailure("tx-2", {
      transactionId: "tx-2",
      error: {
        name: "TransactionRejectedError",
        message: "User rejected transaction",
        code: 4001,
      },
      userRejected: true,
      message: "User rejected transaction",
    });

    await expect(pending).rejects.toMatchObject({
      name: "TransactionSubmissionError",
      failure: {
        transactionId: "tx-2",
        userRejected: true,
      },
    });
  });

  it("replays cached submission outcomes to later waiters", async () => {
    const submissionService = new TransactionSubmissionStore({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    submissionService.recordSubmitted("tx-3", {
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(submissionService.waitForSubmissionOutcome("tx-3")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
    });
  });

  it("attaches persistence failure metadata to a submitted outcome", async () => {
    const submissionService = new TransactionSubmissionStore({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    submissionService.recordSubmitted("tx-4", {
      submitted: DEFAULT_SUBMITTED,
    });
    submissionService.recordPersistenceFailure("tx-4", {
      transactionId: "tx-4",
      error: {
        name: "TransactionPersistenceError",
        message: "Transaction was broadcast but could not be persisted locally.",
      },
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(submissionService.waitForSubmissionOutcome("tx-4")).resolves.toMatchObject({
      persistenceFailure: {
        transactionId: "tx-4",
        error: {
          name: "TransactionPersistenceError",
        },
      },
    });
  });
});
