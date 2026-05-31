import { describe, expect, it } from "vitest";
import {
  buildTransactionTerminalReason,
  TransactionAggregateInvariantError,
  TransactionAggregateService,
  TransactionStatusTransitionError,
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

const createTransaction = (service: TransactionAggregateService): TransactionAggregate =>
  service.createTransaction({
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "dapp",
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
  });

const approveTransaction = (service: TransactionAggregateService, aggregate: TransactionAggregate) =>
  service.approveTransaction(aggregate, {
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
  it("creates an awaiting approval aggregate before broadcast", () => {
    const { service } = createService();

    const aggregate = createTransaction(service);

    expect(aggregate.record).toMatchObject({
      id: "tx-1",
      status: "awaiting_approval",
      approvedRequest: null,
      activeSubmissionId: null,
      submitted: null,
      terminalReason: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(aggregate.submissions).toEqual([]);
  });

  it("stores replacement intent as one input object", () => {
    const { service } = createService();

    const aggregate = service.createTransaction({
      namespace: "eip155",
      chainRef: "eip155:1",
      origin: "https://dapp.example",
      source: "wallet",
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        kind: "eip155.wallet.speedUp",
        payload: { value: "0x1" },
      },
      replacement: {
        transactionId: "tx-old",
        type: "speed_up",
      },
    });

    expect(aggregate.record.replacesTransactionId).toBe("tx-old");
    expect(aggregate.record.replacementType).toBe("speed_up");
  });

  it("approves a transaction by fixing approved request and creating a queued submission", () => {
    const { service, tick } = createService();
    const created = createTransaction(service);
    tick(2_000);

    const aggregate = approveTransaction(service, created);

    expect(aggregate.record.status).toBe("submitting");
    expect(aggregate.record.updatedAt).toBe(2_000);
    expect(aggregate.record.approvedRequest).toMatchObject({
      approvalId: "approval-1",
      approvedAt: 2_000,
      payload: {
        nonce: "0x7",
        gas: "0x5208",
      },
    });
    expect(aggregate.record.activeSubmissionId).toBe("submission-1");
    expect(aggregate.record.conflictKey).toEqual({
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    });
    expect(aggregate.submissions).toEqual([
      {
        id: "submission-1",
        transactionId: "tx-1",
        status: "queued",
        terminalReason: null,
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ]);
  });

  it("records user rejection as a terminal transaction", () => {
    const { service } = createService();
    const created = createTransaction(service);

    const aggregate = service.rejectTransaction(created, { reason: null });

    expect(aggregate.record.status).toBe("rejected");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "user_rejected",
      code: "user_rejected",
    });
  });

  it("records local cancellation before broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createTransaction(service);

    const aggregate = service.cancelTransaction(created, { reason: null });

    expect(aggregate.record.status).toBe("cancelled");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_cancelled",
    });
  });

  it("records approval expiration before broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createTransaction(service);

    const aggregate = service.expireTransaction(created, { reason: null });

    expect(aggregate.record.status).toBe("expired");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_expired",
    });
  });

  it("records failed-before-broadcast as a terminal transaction", () => {
    const { service } = createService();
    const created = createTransaction(service);

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
    const created = createTransaction(service);
    const rejected = service.rejectTransaction(created, { reason: null });

    expect(() =>
      service.approveTransaction(rejected, {
        approvalId: "approval-1",
        approvedRequestPayload: { ok: true },
        submissionId: null,
        approvedAt: null,
        conflictKey: null,
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("advances signing and keeps signed broadcast input out of durable state", () => {
    const { service, tick } = createService();
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);

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
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);

    expect(() =>
      service.beginSubmissionSigning(aggregate, {
        submissionId: "submission-old",
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("records broadcast acceptance by accepting the submission and marking the transaction submitted", () => {
    const { service } = createService();
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);
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
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);
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

    expect(() => service.cancelTransaction(aggregate, { reason: null })).toThrow(TransactionStatusTransitionError);
  });

  it("prevents local cancellation after broadcast starts", () => {
    const { service } = createService();
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);
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
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);
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
    let aggregate = createTransaction(service);
    aggregate = approveTransaction(service, aggregate);
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

  it("lists restart actions for abandoned approval, incomplete submission, and submitted tracking", () => {
    const { service } = createService();
    const awaiting = createTransaction(service);
    let submitting = approveTransaction(service, createTransaction(service));
    submitting = service.beginSubmissionSigning(submitting, {
      submissionId: "submission-1",
    });
    let submitted = approveTransaction(service, createTransaction(service));
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

    expect(service.listRestartActions(awaiting)).toEqual([
      expect.objectContaining({
        kind: "finalize_incomplete_local",
        transactionId: awaiting.record.id,
        targetStatus: "cancelled",
      }),
    ]);
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
    const created = createTransaction(service);

    const approved = approveTransaction(service, created);
    approved.record.status = "confirmed";
    approved.record.request.payload = { mutated: true };

    expect(created.record.status).toBe("awaiting_approval");
    expect(created.record.request.payload).toEqual({
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
    });
  });
});
