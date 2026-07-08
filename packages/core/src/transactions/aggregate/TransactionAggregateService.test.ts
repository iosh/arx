import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTransactionTerminalReason,
  TransactionAggregateInvariantError,
  TransactionAggregateService,
} from "./index.js";
import type { TransactionAggregate } from "./types.js";

type RandomUuid = ReturnType<typeof crypto.randomUUID>;

const mockTransactionIds = () => {
  let nextId = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    nextId += 1;
    return `tx-${nextId}` as RandomUuid;
  });
};

const createService = () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  mockTransactionIds();
  return {
    service: new TransactionAggregateService(),
    tick: (value: number) => {
      vi.setSystemTime(value);
    },
  };
};

const createApprovedTransactionAggregate = (service: TransactionAggregateService): TransactionAggregate =>
  service.createApprovedTransaction({
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    source: "provider",
    accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    request: {
      payload: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
    },
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
    resourceKey: {
      kind: "eip155.account_nonce",
      value: "eip155:1:eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    replacement: null,
  });

const getActiveSubmissionId = (aggregate: TransactionAggregate): string => {
  expect(aggregate.record.activeSubmissionId).toEqual(expect.any(String));
  return aggregate.record.activeSubmissionId as string;
};

describe("TransactionAggregateService", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates a durable approved transaction with a queued submission", () => {
    const { service } = createService();

    const aggregate = createApprovedTransactionAggregate(service);

    expect(aggregate.record).toMatchObject({
      id: "tx-1",
      status: "submitting",
      approvedRequest: {
        payload: {
          nonce: "0x7",
          gas: "0x5208",
        },
      },
      activeSubmissionId: "tx-2",
      submitted: null,
      terminalReason: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(aggregate.submissions).toEqual([
      expect.objectContaining({
        id: "tx-2",
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
      accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        kind: "eip155.wallet.speedUp",
        payload: { value: "0x1" },
      },
      approvedRequestPayload: { value: "0x1" },
      conflictKey: null,
      resourceKey: null,
      replacement: {
        transactionId: "tx-old",
        type: "speed_up",
      },
    });

    expect(aggregate.record.replacement).toEqual({
      transactionId: "tx-old",
      type: "speed_up",
    });
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
        submissionId: getActiveSubmissionId(created),
      }),
    ).toThrow(TransactionAggregateInvariantError);
  });

  it("advances signing and keeps signed broadcast artifact out of durable state", () => {
    const { service, tick } = createService();
    const aggregate = createApprovedTransactionAggregate(service);
    const submissionId = getActiveSubmissionId(aggregate);

    tick(3_000);
    const signing = service.beginSubmissionSigning(aggregate, {
      submissionId,
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
    const submissionId = getActiveSubmissionId(aggregate);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId,
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId,
    });

    const submitted = service.recordBroadcastAcceptance(aggregate, {
      submissionId,
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
    const submissionId = getActiveSubmissionId(aggregate);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId,
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId,
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId,
      submitted: { hash: "0x1111" },
    });

    expect(() => service.cancelTransaction(aggregate, { reason: null })).toThrow(TransactionAggregateInvariantError);
  });

  it("prevents local cancellation after broadcast starts", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    const submissionId = getActiveSubmissionId(aggregate);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId,
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId,
    });

    expect(() => service.cancelTransaction(aggregate, { reason: null })).toThrow(TransactionAggregateInvariantError);
  });

  it("records submitted transaction outcomes", () => {
    const { service } = createService();
    let aggregate = createApprovedTransactionAggregate(service);
    const submissionId = getActiveSubmissionId(aggregate);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId,
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId,
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId,
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
    const submissionId = getActiveSubmissionId(aggregate);
    aggregate = service.beginSubmissionSigning(aggregate, {
      submissionId,
    });
    aggregate = service.queueSubmissionBroadcast(aggregate, {
      submissionId,
    });
    aggregate = service.recordBroadcastAcceptance(aggregate, {
      submissionId,
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

  it("lists restart actions only for incomplete local submission", () => {
    const { service } = createService();
    let submitting = createApprovedTransactionAggregate(service);
    const submittingSubmissionId = getActiveSubmissionId(submitting);
    submitting = service.beginSubmissionSigning(submitting, {
      submissionId: submittingSubmissionId,
    });
    let submitted = createApprovedTransactionAggregate(service);
    const submittedSubmissionId = getActiveSubmissionId(submitted);
    submitted = service.beginSubmissionSigning(submitted, {
      submissionId: submittedSubmissionId,
    });
    submitted = service.queueSubmissionBroadcast(submitted, {
      submissionId: submittedSubmissionId,
    });
    submitted = service.recordBroadcastAcceptance(submitted, {
      submissionId: submittedSubmissionId,
      submitted: { hash: "0x1234" },
    });

    expect(service.listRestartActions(submitting)).toEqual([
      expect.objectContaining({
        kind: "finalize_incomplete_local",
        transactionId: submitting.record.id,
        targetStatus: "failed",
      }),
    ]);
    expect(service.listRestartActions(submitted)).toEqual([]);
  });

  it("returns a next aggregate without mutating the current aggregate", () => {
    const { service } = createService();
    const created = createApprovedTransactionAggregate(service);
    const submissionId = getActiveSubmissionId(created);

    const signing = service.beginSubmissionSigning(created, {
      submissionId,
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
