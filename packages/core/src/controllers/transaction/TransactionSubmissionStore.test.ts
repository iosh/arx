import { describe, expect, it } from "vitest";
import { DEFAULT_SUBMITTED } from "./__fixtures__/transactionServices.js";
import { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";

describe("TransactionSubmissionStore", () => {
  it("resolves waiters as soon as broadcast is accepted", async () => {
    const submissionService = new TransactionSubmissionStore({
      stateLimit: 10,
    });

    const pending = submissionService.waitForSubmissionOutcome("tx-1");
    submissionService.recordBroadcastAccepted("tx-1", {
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(pending).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
    });
  });

  it("rejects waiters after a pre-broadcast failure is recorded", async () => {
    const submissionService = new TransactionSubmissionStore({
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
      stateLimit: 10,
    });

    submissionService.recordBroadcastAccepted("tx-3", {
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(submissionService.waitForSubmissionOutcome("tx-3")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
    });
  });

  it("attaches persistence failure metadata to a submitted outcome", async () => {
    const submissionService = new TransactionSubmissionStore({
      stateLimit: 10,
    });

    submissionService.recordBroadcastAccepted("tx-4", {
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

  it("keeps waiting when no submission outcome was recorded", async () => {
    const submissionService = new TransactionSubmissionStore({
      stateLimit: 10,
    });

    let settled = false;
    const pending = submissionService.waitForSubmissionOutcome("tx-5").then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();

    expect(settled).toBe(false);

    submissionService.recordBroadcastAccepted("tx-5", {
      submitted: DEFAULT_SUBMITTED,
    });

    await pending;
    expect(settled).toBe(true);
  });

  it("adds persistence failure metadata for later readers after an earlier success resolution", async () => {
    const submissionService = new TransactionSubmissionStore({
      stateLimit: 10,
    });

    await expect(
      (async () => {
        submissionService.recordBroadcastAccepted("tx-6", {
          submitted: DEFAULT_SUBMITTED,
        });
        return await submissionService.waitForSubmissionOutcome("tx-6");
      })(),
    ).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
    });

    submissionService.recordPersistenceFailure("tx-6", {
      transactionId: "tx-6",
      error: {
        name: "TransactionPersistenceError",
        message: "Transaction was broadcast but could not be persisted locally.",
      },
      submitted: DEFAULT_SUBMITTED,
    });

    await expect(submissionService.waitForSubmissionOutcome("tx-6")).resolves.toMatchObject({
      submitted: DEFAULT_SUBMITTED,
      persistenceFailure: {
        transactionId: "tx-6",
      },
    });
  });
});
