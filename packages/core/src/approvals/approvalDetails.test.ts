import { describe, expect, it } from "vitest";
import type { TransactionReviewDetails } from "../transactions/review.js";
import type { TransactionReadyProposal } from "../transactions/TransactionsService.js";
import { createApprovalDetails } from "./approvalDetails.js";
import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "./queue/types.js";

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
  requireChainDefinition: (chainRef: string) => ({
    chainRef,
    displayName: `Chain ${chainRef}`,
    shortName: null,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
  }),
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

const createTransactionProposal = (
  proposal: Partial<TransactionReadyProposal> & Pick<TransactionReadyProposal, "proposalId">,
): TransactionReadyProposal => ({
  proposalId: proposal.proposalId,
  namespace: proposal.namespace ?? "eip155",
  chainRef: proposal.chainRef ?? "eip155:1",
  source: proposal.source ?? "provider",
  origin: proposal.origin ?? "https://dapp.example",
  account: proposal.account ?? TRANSACTION_ACCOUNT,
  request: proposal.request ?? { payload: {} },
  replacement: proposal.replacement ?? null,
  review: proposal.review ?? TRANSACTION_REVIEW_DETAILS,
  createdAt: proposal.createdAt ?? 1,
  status: "ready",
  prepared: proposal.prepared ?? {},
});

const createApprovalDetailsHarness = (records: ApprovalRecord[]) => {
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
    const approvalDetails = createApprovalDetailsHarness([
      createRecord({
        approvalId: "approval-transaction",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 3,
        request: {
          proposal: createTransactionProposal({
            proposalId: "proposal-transaction",
            createdAt: 3,
          }),
        },
      }),
    ]);

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
    const approvalDetails = createApprovalDetailsHarness([
      createRecord({
        approvalId: "approval-transaction",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 2,
        request: {
          proposal: createTransactionProposal({
            proposalId: "proposal-transaction",
            createdAt: 3,
            review: TRANSACTION_REVIEW_DETAILS,
          }),
        },
      }),
    ]);

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
        proposalId: "proposal-transaction",
      },
      review: {
        details: TRANSACTION_REVIEW_DETAILS,
        prepare: { state: "ready" },
      },
    });
  });
});
