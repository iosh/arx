import { describe, expect, it } from "vitest";
import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "../approvals/queue/types.js";
import type { TransactionReviewDetails } from "../transactions/review.js";
import type { TransactionApproval } from "../transactions/TransactionsService.js";
import { createApprovalDetails } from "./approval-details.js";

const CHAIN_VIEWS = {
  getApprovalReviewChainView: ({ record, request }: { record: ApprovalRecord; request?: { chainRef?: string } }) => {
    const chainRef = request?.chainRef ?? record.chainRef;
    const [namespace] = chainRef.split(":");
    return {
      namespace,
      chainRef,
      displayName: chainRef,
      shortName: null,
      icon: null,
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
    };
  },
  findAvailableChainView: ({ chainRef }: { chainRef?: string }) =>
    chainRef
      ? {
          namespace: chainRef.split(":")[0] ?? "eip155",
          chainRef,
          displayName: `Chain ${chainRef}`,
          shortName: null,
          icon: null,
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
        }
      : null,
} as const;

const ACCOUNTS = {
  listOwnedForNamespace: () => [
    {
      accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      namespace: "eip155",
      canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayAddress: "0xaaaa...aaaa",
    },
    {
      accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      namespace: "eip155",
      canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      displayAddress: "0xbbbb...bbbb",
    },
  ],
  getActiveAccountForNamespace: () => ({
    accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    namespace: "eip155",
    chainRef: "eip155:1",
    canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    displayAddress: "0xbbbb...bbbb",
  }),
} as const;

const TRANSACTION_REVIEW_DETAILS = {
  namespace: "eip155" as const,
  kind: "native_transfer" as const,
  from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  value: "0x1",
  data: null,
  nonce: null,
  gasLimit: "0x5208",
  fees: {
    gasPrice: "0x3b9aca00",
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  },
} satisfies TransactionReviewDetails;

const TRANSACTION_ACCOUNT = {
  accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

const createRecord = <K extends ApprovalRecord["kind"]>(
  record: Omit<ApprovalRecord<K>, "requester"> & { request: ApprovalRecord<K>["request"] },
): ApprovalRecord<K> => ({
  requester: {
    origin: record.origin,
    source: "provider",
    requestId: "request-1",
  },
  ...record,
});

const createTransactionApproval = (
  approval: Partial<TransactionApproval> & Pick<TransactionApproval, "approvalId">,
): TransactionApproval => ({
  approvalId: approval.approvalId,
  namespace: approval.namespace ?? "eip155",
  chainRef: approval.chainRef ?? "eip155:1",
  source: approval.source ?? "provider",
  origin: approval.origin ?? "https://dapp.example",
  account: approval.account ?? TRANSACTION_ACCOUNT,
  review: approval.review ?? null,
  prepare: approval.prepare ?? {
    id: `prepare-${approval.approvalId}`,
    status: "ready",
    draftRevision: 0,
    updatedAt: approval.updatedAt ?? approval.createdAt ?? 1,
    preparedAt: approval.updatedAt ?? approval.createdAt ?? 1,
    expiresAt: null,
  },
  createdAt: approval.createdAt ?? 1,
  updatedAt: approval.updatedAt ?? approval.createdAt ?? 1,
});

const createTransactionApprovalsStub = (input: { approvals: TransactionApproval[] }) => {
  const approvalsById = new Map(input.approvals.map((approval) => [approval.approvalId, approval] as const));

  return {
    getTransactionApproval: (approvalId: string) => approvalsById.get(approvalId) ?? null,
    listTransactionApprovals: async () => input.approvals,
  };
};

const createApprovalDetailsHarness = (
  records: ApprovalRecord[],
  options?: { transactionApprovals?: ReturnType<typeof createTransactionApprovalsStub> },
) => {
  const byId = new Map(records.map((record) => [record.approvalId, record] as const));
  const pending: ApprovalQueueItem[] = records.map((record) => ({
    approvalId: record.approvalId,
    kind: record.kind,
    source: record.requester.source,
    origin: record.origin,
    namespace: record.namespace,
    chainRef: record.chainRef,
    createdAt: record.createdAt,
  }));

  return createApprovalDetails({
    approvals: {
      get: (approvalId) => byId.get(approvalId),
      getState: () => ({ pending }),
    },
    accounts: ACCOUNTS,
    chainViews: CHAIN_VIEWS,
    ...(options?.transactionApprovals ? { transactionApprovals: options.transactionApprovals } : {}),
  });
};

describe("createApprovalDetails", () => {
  it("projects requestAccounts detail with selectable accounts and recommended account", async () => {
    const approvalDetails = createApprovalDetailsHarness([
      createRecord({
        approvalId: "approval-request-accounts",
        kind: ApprovalKinds.RequestAccounts,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 1,
        request: {
          chainRef: "eip155:1",
        },
      }),
    ]);

    await expect(approvalDetails.getDetail("approval-request-accounts")).resolves.toEqual({
      approvalId: "approval-request-accounts",
      kind: ApprovalKinds.RequestAccounts,
      source: "provider",
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 1,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        selectableAccounts: [
          {
            accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            displayAddress: "0xaaaa...aaaa",
          },
          {
            accountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            displayAddress: "0xbbbb...bbbb",
          },
        ],
        recommendedAccountId: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      review: null,
    });
  });

  it("includes transaction approvals in the pending list", async () => {
    const approvalDetails = createApprovalDetailsHarness([], {
      transactionApprovals: createTransactionApprovalsStub({
        approvals: [
          createTransactionApproval({
            approvalId: "approval-transaction",
            createdAt: 3,
          }),
        ],
      }),
    });

    await expect(approvalDetails.listPending()).resolves.toEqual([
      {
        approvalId: "approval-transaction",
        kind: ApprovalKinds.SendTransaction,
        source: "provider",
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 3,
      },
    ]);
  });

  it("projects transaction approval detail", async () => {
    const approvalDetails = createApprovalDetailsHarness([], {
      transactionApprovals: createTransactionApprovalsStub({
        approvals: [
          createTransactionApproval({
            approvalId: "approval-transaction",
            createdAt: 2,
            updatedAt: 3,
            review: TRANSACTION_REVIEW_DETAILS,
          }),
        ],
      }),
    });

    await expect(approvalDetails.getDetail("approval-transaction")).resolves.toEqual({
      approvalId: "approval-transaction",
      kind: ApprovalKinds.SendTransaction,
      source: "provider",
      origin: "https://dapp.example",
      namespace: "eip155",
      chainRef: "eip155:1",
      createdAt: 2,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        approvalId: "approval-transaction",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        prepareId: "prepare-approval-transaction",
      },
      review: {
        updatedAt: 3,
        details: TRANSACTION_REVIEW_DETAILS,
        prepare: { state: "ready" },
      },
    });
  });
});
