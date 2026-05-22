import { describe, expect, it, vi } from "vitest";
import type { TransactionIntent } from "../intent/index.js";
import type { BeginTransactionApprovalOptions, TransactionApprovalRequestRef } from "../provider/types.js";
import { ProviderTransactionApprovalService } from "./ProviderTransactionApprovalService.js";
import type { TransactionSubmissionResolution } from "./types.js";

const TRANSACTION_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";

const REQUEST = {
  namespace: "eip155",
  chainRef: "eip155:1",
  payload: {
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x0",
    data: "0x",
  },
} as const;

const INTENT: TransactionIntent = {
  namespace: REQUEST.namespace,
  chainRef: REQUEST.chainRef,
  account: {
    accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    accountAddress: REQUEST.payload.from,
    requestedAddress: REQUEST.payload.from,
  },
  request: REQUEST,
};

const APPROVAL_REQUESTER = {
  origin: "https://dapp.example",
  initiator: "dapp" as const,
  requestId: "request-1",
};

const buildApprovalRequestRef = (): TransactionApprovalRequestRef => ({
  transactionId: TRANSACTION_ID,
  approvalId: APPROVAL_ID,
});

const buildSubmissionResolution = (): TransactionSubmissionResolution => ({
  submitted: {
    hash: "0xdeadbeef",
    chainId: "0x1",
    from: REQUEST.payload.from,
    nonce: "0x1",
  },
});

describe("ProviderTransactionApprovalService", () => {
  it("rejects immediately when request binding is already aborted", async () => {
    const begin = vi.fn(async () => buildApprovalRequestRef());
    const rejectTransaction = vi.fn(async () => {});
    const waitForSubmissionOutcome = vi.fn(async () => buildSubmissionResolution());

    const service = new ProviderTransactionApprovalService({
      begin: { beginTransactionApproval: begin },
      execution: { rejectTransaction },
      submission: { waitForSubmissionOutcome },
    });

    const controller = new AbortController();
    controller.abort();

    const submission = await service.beginTransactionApproval(INTENT, APPROVAL_REQUESTER, {
      requestBinding: {
        abortSignal: controller.signal,
        attachBlockingApproval: vi.fn(),
      },
    });

    expect(rejectTransaction).toHaveBeenCalledTimes(1);
    expect(rejectTransaction).toHaveBeenCalledWith({
      id: TRANSACTION_ID,
      reason: expect.objectContaining({
        name: "TransportDisconnectedError",
        code: 4900,
      }),
      terminationReason: "approval_cancelled",
    });

    await submission.waitForSubmission();
    expect(waitForSubmissionOutcome).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it("removes the abort listener after submission settles", async () => {
    const begin = vi.fn(async () => buildApprovalRequestRef());
    const rejectTransaction = vi.fn(async () => {});
    const resolution = buildSubmissionResolution();
    const waitForSubmissionOutcome = vi.fn(async () => resolution);

    const service = new ProviderTransactionApprovalService({
      begin: { beginTransactionApproval: begin },
      execution: { rejectTransaction },
      submission: { waitForSubmissionOutcome },
    });

    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, "addEventListener");
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");

    const submission = await service.beginTransactionApproval(INTENT, APPROVAL_REQUESTER, {
      requestBinding: {
        abortSignal: controller.signal,
        attachBlockingApproval: vi.fn(),
      } satisfies BeginTransactionApprovalOptions["requestBinding"],
    });

    const settled = await submission.waitForSubmission();

    expect(settled).toEqual(resolution);
    expect(addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));

    controller.abort();
    expect(rejectTransaction).not.toHaveBeenCalled();
  });
});
