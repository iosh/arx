import { describe, expect, it, vi } from "vitest";
import { Approvals } from "../../approvals/Approvals.js";
import type { SendTransactionApproval } from "../../approvals/types.js";
import type * as Eip155 from "../../transactions/eip155/types.js";
import type { TransactionSubmission } from "../../transactions/types.js";
import { createEip155DappTransactionHandlers } from "./dappTransactions.js";
import { decodeSendTransactionParams } from "./transactionRequest.js";

const ORIGIN = "https://dapp.example";
const CHAIN_REF = "eip155:1";
const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c";
const RECIPIENT = "0x0000000000000000000000000000000000000001";
const ACCOUNT_ID = `eip155:${ADDRESS.slice(2)}`;
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

const transactionWithState = (state: Eip155.TransactionState): Eip155.Transaction => ({
  ...PREPARED,
  transactionId: "transaction-1",
  state,
  createdAt: 1,
  updatedAt: 1,
});

const createHarness = (submission?: TransactionSubmission) => {
  const approvals = new Approvals({
    time: {
      now: () => 1,
      schedule: () => () => {},
    },
    publishChanged: () => {},
  });
  const prepare = vi.fn(async () => PREPARED);
  const submit = vi.fn(
    async (): Promise<TransactionSubmission> =>
      submission ?? {
        status: "pending",
        transaction: transactionWithState({ status: "pending" }),
        transactionHash: TRANSACTION_HASH,
      },
  );
  const { sendTransaction } = createEip155DappTransactionHandlers({
    accounts: {
      accountIdFromAddress: ({ address }) => `eip155:${address.replace(/^0x/, "").toLowerCase()}`,
      getAccount: (accountId) =>
        accountId === ACCOUNT_ID
          ? {
              accountId,
              namespace: "eip155",
              origin: { type: "private-key", keySourceId: "source" },
              hidden: false,
              selected: true,
              createdAt: 1,
            }
          : null,
      getAddress: ({ accountId, chainRef }) => ({
        accountId,
        chainRef,
        canonicalAddress: ADDRESS,
        displayAddress: ADDRESS,
      }),
    },
    permissions: {
      get: () => ({ origin: ORIGIN, namespace: "eip155", accountIds: [ACCOUNT_ID] }),
    },
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

  it("returns a broadcast rejection as a node RPC error", async () => {
    const failure = {
      type: "broadcast" as const,
      code: -32_000,
      message: "insufficient funds",
      data: { balance: "0x0" },
    };
    const harness = createHarness({
      status: "failed",
      transaction: transactionWithState({ status: "failed", failure }),
      failure,
    });

    const pending = harness.request([legacyRequest]);
    await harness.approve();

    await expect(pending).rejects.toMatchObject({
      code: "global.rpc.node_response",
      message: failure.message,
      rpcCode: failure.code,
      rpcData: failure.data,
    });
  });
});
