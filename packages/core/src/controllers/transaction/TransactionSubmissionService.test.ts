import { describe, expect, it } from "vitest";
import { createRecordViewStub, DEFAULT_LOCATOR, DEFAULT_SUBMITTED } from "./__fixtures__/transactionServices.js";
import { TransactionSubmissionService } from "./TransactionSubmissionService.js";

describe("TransactionSubmissionService", () => {
  it("resolves waiters after broadcast submission is recorded", async () => {
    const submissionService = new TransactionSubmissionService({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    const pending = submissionService.waitForSubmissionOutcome("tx-1");
    submissionService.recordSubmitted("tx-1", {
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });

    await expect(pending).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });

  it("rejects waiters after a pre-broadcast failure is recorded", async () => {
    const submissionService = new TransactionSubmissionService({
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
    const submissionService = new TransactionSubmissionService({
      recordView: createRecordViewStub(),
      stateLimit: 10,
    });

    submissionService.recordSubmitted("tx-3", {
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });

    await expect(submissionService.waitForSubmissionOutcome("tx-3")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });
});
