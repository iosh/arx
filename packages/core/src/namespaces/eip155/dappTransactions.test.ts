import { describe, expect, it, vi } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import type { SendTransactionApproval } from "../../approvals/types.js";
import { Permissions } from "../../permissions/Permissions.js";
import type { Transactions } from "../../transactions/Transactions.js";
import { ACCOUNT_ID, ADDRESS, createAccounts } from "./__tests__/fixtures.js";
import { createEip155DappTransactionHandlers } from "./dappTransactions.js";
import { decodeSendTransactionParams } from "./transactionRequest.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";
const RECIPIENT = "0x0000000000000000000000000000000000000001";
const TRANSACTION_HASH: `0x${string}` = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const PREPARED = {
  namespace: "eip155",
  chainRef: CHAIN_REF,
  accountId: ACCOUNT_ID,
  initiator: { type: "dapp", origin: ORIGIN },
  transaction: {
    from: ADDRESS,
    to: RECIPIENT,
    value: "0x1",
    data: "0x",
    gas: "0x5208",
    nonce: "0x0",
    type: "legacy",
    gasPrice: "0x2",
  },
} as const;

const createHarness = () => {
  const accounts = createAccounts();
  const permissions = new Permissions({
    accounts,
    bootstrap: { records: [{ origin: ORIGIN, namespace: "eip155", accountIds: [ACCOUNT_ID] }] },
  });
  const approvals = new Approvals({
    time: {
      now: () => 1,
      schedule: () => () => {},
    },
    publishChanged: () => {},
  });
  const prepare = vi.fn<Transactions["prepare"]>(async () => PREPARED);
  const submit = vi.fn<Transactions["submit"]>(async () => ({
    status: "pending",
    transaction: {
      ...PREPARED,
      transactionId: "transaction-1",
      state: { status: "pending" },
      createdAt: 1,
      updatedAt: 1,
    },
    transactionHash: TRANSACTION_HASH,
  }));
  const { sendTransaction } = createEip155DappTransactionHandlers({
    accounts,
    permissions,
    approvals,
    transactions: { prepare, submit },
  });

  const request = (params: unknown) =>
    sendTransaction({
      origin: ORIGIN,
      chainRef: CHAIN_REF,
      method: "eth_sendTransaction",
      params,
    });
  const nextApproval = async (): Promise<SendTransactionApproval> => {
    await vi.waitFor(() => expect(approvals.list()).toHaveLength(1));
    const approval = approvals.list()[0];
    if (approval?.type !== "sendTransaction") throw new Error("Expected a send transaction approval.");
    return approval;
  };
  const approve = async (): Promise<SendTransactionApproval> => {
    const approval = await nextApproval();
    approvals.approve({ approvalId: approval.approvalId, type: "sendTransaction" });
    return approval;
  };

  return { approvals, prepare, submit, request, nextApproval, approve };
};

const legacyRequest = {
  from: ADDRESS,
  to: RECIPIENT,
  value: "0x1",
  gasPrice: "0x2",
  nonce: "0x9",
  chainId: "0x1",
  type: "0x0",
};

describe("EIP-155 dapp transactions", () => {
  it("decodes transaction kinds and ignores a dapp nonce", () => {
    const cases = [
      {
        request: { from: ADDRESS },
        expected: { type: "auto" },
      },
      {
        request: legacyRequest,
        expected: { type: "legacy", gasPrice: "0x2" },
      },
      {
        request: { ...legacyRequest, type: "0x1", accessList: [] },
        expected: { type: "eip2930", gasPrice: "0x2", accessList: [] },
      },
      {
        request: {
          from: ADDRESS,
          to: RECIPIENT,
          value: "0x1",
          chainId: "0x1",
          type: "0x2",
          maxFeePerGas: "0x3",
          maxPriorityFeePerGas: "0x1",
          accessList: [],
        },
        expected: {
          type: "eip1559",
          maxFeePerGas: "0x3",
          maxPriorityFeePerGas: "0x1",
          accessList: [],
        },
      },
    ] as const;

    for (const testCase of cases) {
      expect(decodeSendTransactionParams([testCase.request], "eth_sendTransaction").transaction).toMatchObject(
        testCase.expected,
      );
    }

    expect(decodeSendTransactionParams([legacyRequest], "eth_sendTransaction").transaction).not.toHaveProperty("nonce");
  });

  it("prepares, approves, and submits the decoded transaction", async () => {
    const harness = createHarness();

    const pending = harness.request([legacyRequest]);
    const approval = await harness.approve();

    expect(approval.request).toEqual(PREPARED);
    await expect(pending).resolves.toBe(TRANSACTION_HASH);
    expect(harness.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "eip155",
        chainRef: CHAIN_REF,
        accountId: ACCOUNT_ID,
        initiator: { type: "dapp", origin: ORIGIN },
        transaction: expect.objectContaining({
          type: "legacy",
          to: RECIPIENT,
          value: "0x1",
          gasPrice: "0x2",
        }),
      }),
    );
    expect(harness.submit).toHaveBeenCalledWith(PREPARED);
  });

  it("rejects invalid transaction shapes before preparation", async () => {
    const harness = createHarness();
    const invalidRequests = [
      { ...legacyRequest, value: "0x01" },
      { ...legacyRequest, maxFeePerGas: "0x2" },
      { ...legacyRequest, type: "0x3" },
      { ...legacyRequest, from: ADDRESS.slice(2) },
    ];

    for (const request of invalidRequests) {
      await expect(harness.request([request])).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    }
    expect(harness.prepare).not.toHaveBeenCalled();
    expect(harness.approvals.list()).toEqual([]);
  });

  it("does not submit a rejected approval", async () => {
    const harness = createHarness();

    const pending = harness.request([legacyRequest]);
    const approval = await harness.nextApproval();
    harness.approvals.reject(approval.approvalId);

    await expect(pending).rejects.toMatchObject({ code: "global.rpc.user_rejected_request" });
    expect(harness.submit).not.toHaveBeenCalled();
  });
});
