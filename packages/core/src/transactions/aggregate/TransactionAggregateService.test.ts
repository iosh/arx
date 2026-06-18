import { describe, expect, it } from "vitest";
import {
  buildTransactionTerminalReason,
  TransactionAggregateInvariantError,
  TransactionAggregateService,
} from "./index.js";
import type { TransactionAggregate } from "./types.js";

const createService = () => {
  let now = 1_000;
  let nextId = 0;
  return {
    service: new TransactionAggregateService({
      now: () => now,
      createId: () => {
        nextId += 1;
        return `tx-${nextId}`;
      },
    }),
    tick: (value: number) => {
      now = value;
    },
  };
};

const createApprovedTransactionAggregate = (service: TransactionAggregateService): TransactionAggregate =>
  service.createApprovedTransaction({
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "provider",
    requestId: "rpc-1",
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request: {
      kind: "eip155.rpc.eth_sendTransaction",
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
    },
    approvalId: "approval-1",
    submissionId: "submission-1",
    approvedAt: null,
    approvedRequestPayload: {
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
      data: "0x",
      gas: "0x5208",
      nonce: "0x7",
      type: "legacy",
      gasPrice: "0x3b9aca00",
    },
    conflictKey: {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    },
  });

describe("TransactionAggregateService", () => {
  it("creates a durable approved transaction with a queued submission", () => {
    const { service } = createService();

    const aggregate = createApprovedTransactionAggregate(service);

    expect(aggregate.record).toMatchObject({
      id: "tx-1",
      status: "submitting",
      approvedRequest: {
        approvalId: "approval-1",
        payload: {
          nonce: "0x7",
          gas: "0x5208",
        },
      },
      activeSubmissionId: "submission-1",
      submitted: null,
      terminalReason: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(aggregate.submissions).toEqual([
      expect.objectContaining({
        id: "submission-1",
        transactionId: "tx-1",
        status: "queued",
      }),
    ]);
  });

  it("stores replacement intent as one input object", () => {
    const { service } = createService();

    const aggregate = service.createApprovedTransaction({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      source: "wallet-ui",
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        kind: "eip155.wallet.speedUp",
        payload: { value: "0x1" },
      },
      approvalId: "approval-1",
      approvedAt: null,
      approvedRequestPayload: { value: "0x1" },
      submissionId: "submission-1",
      conflictKey: null,
      replacement: {
        transactionId: "tx-old",
        type: "speed_up",
      },
    });

    expect(aggregate.record.replacesTransactionId).toBe("tx-old");
    expect(aggregate.record.replacementType).toBe("speed_up");
  });

  it("records local cancellation before broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);

    const aggregate = service.cancelTransaction(created, { reason: null });

    expect(aggregate.record.status).toBe("cancelled");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_cancelled",
    });
  });

  it("records approval expiration before broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);

    const aggregate = service.expireTransaction(created, { reason: null });

    expect(aggregate.record.status).toBe("expired");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_expired",
    });
  });

  it("records failed-before-broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);

    const aggregate = service.failTransaction(created, {
      reason: buildTransactionTerminalReason({
        kind: "prepare_failed",
        namespace: "eip155",
        code: "eip155.insufficient_funds",
        message: "Insufficient funds for transaction.",
      }),
    });

    expect(aggregate.record.status).toBe("failed");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "prepare_failed",
      namespace: "eip155",
      code: "eip155.insufficient_funds",
    });
  });

  it("prevents terminal transactions from continuing", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);
    const failed = service.failTransaction(created, {
      reason: buildTransactionTerminalReason({
        kind: "internal_failed",
      }),
    });

    expect(() =>
      service.beginSubmissionSigning(failed, {
        submissionId: "submission-1",
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("advances signing and keeps signed broadcast input out of durable state", () => {
    const { service, tick } = createService();
    const aggregate = createApprovedTransactionAggregate(service);

    tick(3_000);
    const signing = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });

    expect(signing.record.submitted).toBeNull();
    expect(signing.submissions[0]).toMatchObject({
      status: "signing",
      terminalReason: null,
      updatedAt: 3_000,
    });
  });

  it("rejects submission commands for non-active submission ids", () => {
    const { service } = createService();
    const aggregate = createApprovedTransactionAggregate(service);

    expect(() =>
      service.beginSubmissionSigning(aggregate, {
        submissionId: "submission-old",
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("records broadcast acceptance by accepting the submission and marking the transaction submitted", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId: "submission-1",
    });

    const submitted = service.recordBroadcastAcceptance(aggregate, {
      submissionId: "submission-1",
      submitted: {
        hash: "0x1111",
        chainId: "0x1",
      },
    });

    expect(submitted.record.status).toBe("submitted");
    expect(submitted.record.activeSubmissionId).toBeNull();
    expect(submitted.record.submitted).toEqual({
      hash: "0x1111",
      chainId: "0x1",
    });
    expect(submitted.submissions[0]?.status).toBe("accepted");
  });

  it("prevents cancelling a submitted transaction as local cancellation", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId: "submission-1",
      submitted: { hash: "0x1111" },
    });

    expect(() => service.cancelTransaction(aggregate, { reason: null })).toThrow(TransactionAggregateInvariantError);
  });

  it("prevents local cancellation after broadcast starts", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId: "submission-1",
    });

    expect(() => service.cancelTransaction(aggregate, { reason: null })).toThrow(TransactionAggregateInvariantError);
  });

  it("records submitted transaction outcomes", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId: "submission-1",
      submitted: { hash: "0x1111" },
    });

    const confirmed = service.recordTransactionConfirmed(aggregate, {
      receipt: {
        status: "0x1",
        blockNumber: "0x10",
      },
    });

    expect(confirmed.record.status).toBe("confirmed");
    expect(confirmed.record.receipt).toEqual({
      status: "0x1",
      blockNumber: "0x10",
    });
  });

  it("records submitted transaction expiry from tracking", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId: "submission-1",
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId: "submission-1",
      submitted: { signature: "solana-signature" },
    });

    const expired = service.recordTransactionExpired(aggregate, {
      reason: buildTransactionTerminalReason({
        kind: "tracking_failed",
        code: "solana.blockhash_expired",
        details: { lastValidBlockHeight: 123 },
      }),
    });

    expect(expired.record.status).toBe("expired");
    expect(expired.record.terminalReason).toMatchObject({
      kind: "tracking_failed",
      code: "solana.blockhash_expired",
      details: { lastValidBlockHeight: 123 },
    });
  });

  it("lists restart actions for incomplete submission and submitted tracking", () => {
    const { service } = createService();
    let submitting = createApprovedTransactionAggregate(service);
    submitting = service.beginSubmissionSigning(submitting, {
      submissionId: "submission-1",
    });
    let submitted = createApprovedTransactionAggregate(service);
    submitted = service.beginSubmissionSigning(submitted, {
      submissionId: "submission-1",
    });
    submitted = service.queueSubmissionBroadcast(submitted, {
      submissionId: "submission-1",
    });
    submitted = service.recordBroadcastAcceptance(submitted, {
      submissionId: "submission-1",
      submitted: { hash: "0x1234" },
    });

    expect(service.listRestartActions(submitting)).toEqual([
      expect.objectContaining({
        kind: "finalize_incomplete_local",
        transactionId: submitting.record.id,
        targetStatus: "failed",
      }),
    ]);
    expect(service.listRestartActions(submitted)).toEqual([
      {
        kind: "resume_tracking",
        transactionId: submitted.record.id,
      },
    ]);
  });

  it("returns a next aggregate without mutating the current aggregate", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);

    const signing = service.beginSubmissionSigning(created, {
      submissionId: "submission-1",
    });
    signing.record.status = "confirmed";
    signing.record.request.payload = { mutated: true };

    expect(created.record.status).toBe("submitting");
    expect(created.record.request.payload).toEqual({
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
    });
  });
});
