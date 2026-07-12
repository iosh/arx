import { describe, expect, it } from "vitest";
import type { AccountId } from "../accounts/accountId.js";
import type { SubmittingTransactionRecord } from "./persistence.js";
import {
  confirmTransaction,
  createSubmittingTransaction,
  interruptTransaction,
  markTransactionBroadcasting,
  markTransactionSubmitted,
} from "./transactionRecord.js";

const submitting = (): SubmittingTransactionRecord =>
  createSubmittingTransaction({
    transactionId: "transaction-1",
    chainRef: "eip155:1",
    accountId: "eip155:0000000000000000000000000000000000000001" as AccountId,
    origin: "https://app.example",
    source: "provider",
    createAt: 1,
    signingPayload: { nonce: "0x1" },
    conflictKey: { kind: "eip155.nonce", value: "1" },
  });

describe("transaction record lifecycle", () => {
  it("advances through submitting, broadcasting, submitted, and confirmed", () => {
    const broadcasting = markTransactionBroadcasting(submitting());
    const submitted = markTransactionSubmitted(broadcasting, { hash: "0xabc" });
    const confirmed = confirmTransaction(submitted, { blockNumber: "0x1" });

    expect([broadcasting.status, submitted.status, confirmed.status]).toEqual([
      "broadcasting",
      "submitted",
      "confirmed",
    ]);
    expect(confirmed.networkSubmission).toEqual({ hash: "0xabc" });
  });

  it("does not allow a terminal transaction to transition again", () => {
    const confirmed = confirmTransaction(
      markTransactionSubmitted(markTransactionBroadcasting(submitting()), { hash: "0xabc" }),
      { blockNumber: "0x1" },
    );

    expect(() => confirmTransaction(confirmed, { blockNumber: "0x2" })).toThrowError(
      expect.objectContaining({ code: "transaction.lifecycle_transition_invalid" }),
    );
  });

  it("turns interrupted local stages into explicit failures", () => {
    const submittingFailure = interruptTransaction(submitting());
    const broadcastingFailure = interruptTransaction(markTransactionBroadcasting(submitting()));

    expect(submittingFailure).toMatchObject({
      status: "failed",
      phase: "submitting",
      reason: { code: "transaction.interrupted_before_signing" },
    });
    expect(broadcastingFailure).toMatchObject({
      status: "failed",
      phase: "broadcasting",
      reason: { code: "transaction.broadcast_outcome_unknown" },
    });
  });
});
