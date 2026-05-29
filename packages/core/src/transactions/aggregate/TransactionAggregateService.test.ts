import { describe, expect, it } from "vitest";
import {
  buildTransactionTerminalReason,
  TransactionAggregateConflictError,
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
        return `id-${nextId}`;
      },
    }),
    tick: (value: number) => {
      now = value;
    },
  };
};

const createTransaction = (service: TransactionAggregateService, id = "tx-1"): TransactionAggregate =>
  service.createTransaction({
    id,
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

const approveTransaction = (service: TransactionAggregateService, transactionId = "tx-1") =>
  service.approveTransaction({
    transactionId,
    approvalId: "approval-1",
    submissionId: "submission-1",
    approvedRequestPayload: {
      chainId: "0x1",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
      data: "0x",
      gasLimit: "0x5208",
      nonce: "0x7",
      fee: {
        kind: "legacy",
        gasPrice: "0x3b9aca00",
      },
    },
    conflictKey: {
      kind: "eip155.nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    },
  });

describe("TransactionAggregateService", () => {
  it("creates an awaiting approval durable aggregate before broadcast", () => {
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
    expect(aggregate.submissionArtifacts).toEqual([]);
  });

  it("rejects duplicate aggregate ids", () => {
    const { service } = createService();

    createTransaction(service);

    expect(() => createTransaction(service)).toThrow(TransactionAggregateConflictError);
  });

  it("stores replacement intent as one input object", () => {
    const { service } = createService();

    const aggregate = service.createTransaction({
      id: "tx-1",
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
    createTransaction(service);
    tick(2_000);

    const aggregate = approveTransaction(service);

    expect(aggregate.record.status).toBe("submitting");
    expect(aggregate.record.updatedAt).toBe(2_000);
    expect(aggregate.record.approvedRequest).toMatchObject({
      approvalId: "approval-1",
      approvedAt: 2_000,
      payload: {
        nonce: "0x7",
        gasLimit: "0x5208",
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
        artifactId: null,
        terminalReason: null,
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ]);
  });

  it("records user rejection as a terminal durable transaction", () => {
    const { service } = createService();
    createTransaction(service);

    const aggregate = service.rejectTransaction({ transactionId: "tx-1" });

    expect(aggregate.record.status).toBe("rejected");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "user_rejected",
      code: "user_rejected",
    });
  });

  it("records local cancellation before broadcast as a terminal durable transaction", () => {
    const { service } = createService();
    createTransaction(service);

    const aggregate = service.cancelTransaction({ transactionId: "tx-1" });

    expect(aggregate.record.status).toBe("cancelled");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_cancelled",
    });
  });

  it("records approval expiration before broadcast as a terminal durable transaction", () => {
    const { service } = createService();
    createTransaction(service);

    const aggregate = service.expireTransaction({ transactionId: "tx-1" });

    expect(aggregate.record.status).toBe("expired");
    expect(aggregate.record.terminalReason).toMatchObject({
      kind: "approval_expired",
    });
  });

  it("records failed-before-broadcast as a terminal durable transaction", () => {
    const { service } = createService();
    createTransaction(service);

    const aggregate = service.failTransaction({
      transactionId: "tx-1",
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
    createTransaction(service);
    service.rejectTransaction({ transactionId: "tx-1" });

    expect(() =>
      service.approveTransaction({
        transactionId: "tx-1",
        approvalId: "approval-1",
        approvedRequestPayload: { ok: true },
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("advances signing, stores sealed artifact separately, and does not place it on the record", () => {
    const { service, tick } = createService();
    createTransaction(service);
    approveTransaction(service);

    tick(3_000);
    const signing = service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    expect(signing.submissions[0]?.status).toBe("signing");

    tick(4_000);
    const signed = service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactId: "artifact-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: {
        envelope: "test-only-sealed-payload",
      },
    });

    expect(signed.record).not.toHaveProperty("sealedPayload");
    expect(signed.record.submitted).toBeNull();
    expect(signed.submissions[0]).toMatchObject({
      status: "signed",
      artifactId: "artifact-1",
    });
    expect(signed.submissionArtifacts).toEqual([
      {
        id: "artifact-1",
        transactionId: "tx-1",
        submissionId: "submission-1",
        namespace: "eip155",
        chainRef: "eip155:1",
        kind: "eip155.raw_transaction",
        sealedPayload: {
          envelope: "test-only-sealed-payload",
        },
        retention: "until_submitted",
        expiresAt: null,
        createdAt: 4_000,
      },
    ]);
  });

  it("rejects submission commands for non-active submission ids", () => {
    const { service } = createService();
    createTransaction(service);
    approveTransaction(service);

    expect(() =>
      service.beginSubmissionSigning({
        transactionId: "tx-1",
        submissionId: "submission-old",
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("records broadcast acceptance by accepting the submission and marking the transaction submitted", () => {
    const { service } = createService();
    createTransaction(service);
    approveTransaction(service);
    service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: { envelope: "test-only-sealed-payload" },
    });
    service.queueSubmissionBroadcast({ transactionId: "tx-1", submissionId: "submission-1" });

    const submitted = service.recordBroadcastAcceptance({
      transactionId: "tx-1",
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
    createTransaction(service);
    approveTransaction(service);
    service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: { envelope: "test-only-sealed-payload" },
    });
    service.queueSubmissionBroadcast({ transactionId: "tx-1", submissionId: "submission-1" });
    service.recordBroadcastAcceptance({
      transactionId: "tx-1",
      submissionId: "submission-1",
      submitted: { hash: "0x1111" },
    });

    expect(() => service.cancelTransaction({ transactionId: "tx-1" })).toThrow(TransactionStatusTransitionError);
  });

  it("prevents local cancellation after broadcast starts", () => {
    const { service } = createService();
    createTransaction(service);
    approveTransaction(service);
    service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: { envelope: "test-only-sealed-payload" },
    });
    service.queueSubmissionBroadcast({ transactionId: "tx-1", submissionId: "submission-1" });

    expect(() => service.cancelTransaction({ transactionId: "tx-1" })).toThrow(TransactionAggregateInvariantError);
  });

  it("records submitted transaction outcomes", () => {
    const { service } = createService();
    createTransaction(service);
    approveTransaction(service);
    service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: { envelope: "test-only-sealed-payload" },
    });
    service.queueSubmissionBroadcast({ transactionId: "tx-1", submissionId: "submission-1" });
    service.recordBroadcastAcceptance({
      transactionId: "tx-1",
      submissionId: "submission-1",
      submitted: { hash: "0x1111" },
    });

    const confirmed = service.recordTransactionConfirmed({
      transactionId: "tx-1",
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
    createTransaction(service);
    approveTransaction(service);
    service.beginSubmissionSigning({ transactionId: "tx-1", submissionId: "submission-1" });
    service.completeSubmissionSigning({
      transactionId: "tx-1",
      submissionId: "submission-1",
      artifactKind: "eip155.raw_transaction",
      sealedPayload: { envelope: "test-only-sealed-payload" },
    });
    service.queueSubmissionBroadcast({ transactionId: "tx-1", submissionId: "submission-1" });
    service.recordBroadcastAcceptance({
      transactionId: "tx-1",
      submissionId: "submission-1",
      submitted: { signature: "solana-signature" },
    });

    const expired = service.recordTransactionExpired({
      transactionId: "tx-1",
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

  it("returns clones so callers cannot mutate stored aggregate state", () => {
    const { service } = createService();
    const aggregate = createTransaction(service);
    aggregate.record.status = "confirmed";
    aggregate.record.request.payload = { mutated: true };

    const stored = service.getTransactionAggregate("tx-1");

    expect(stored?.record.status).toBe("awaiting_approval");
    expect(stored?.record.request.payload).toEqual({
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
    });
  });
});
