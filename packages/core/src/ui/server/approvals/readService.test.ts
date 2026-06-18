import { describe, expect, it } from "vitest";
import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "../../../approvals/queue/types.js";
import type { SendTransactionApprovalReview } from "../../../transactions/review/types.js";
import type { TransactionApproval } from "../../../transactions/TransactionsService.js";
import { createApprovalReadService } from "./readService.js";

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
      accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      namespace: "eip155",
      canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayAddress: "0xaaaa...aaaa",
    },
    {
      accountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      namespace: "eip155",
      canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      displayAddress: "0xbbbb...bbbb",
    },
  ],
  getActiveAccountForNamespace: () => ({
    accountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    namespace: "eip155",
    chainRef: "eip155:1",
    canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    displayAddress: "0xbbbb...bbbb",
  }),
} as const;

const SEND_TRANSACTION_REVIEW_READY = {
  updatedAt: 3,
  details: {
    namespace: "eip155" as const,
    kind: "native_transfer" as const,
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    value: "0x1",
    data: null,
    gasLimit: "0x5208",
    fees: {
      gasPrice: "0x3b9aca00",
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    },
  },
  prepare: { state: "ready" },
} satisfies SendTransactionApprovalReview;

const SEND_TRANSACTION_REVIEW_BLOCKED = {
  updatedAt: 4,
  details: null,
  prepare: {
    state: "blocked",
    blocker: {
      reason: "transaction.blocked",
      message: "Blocked",
    },
  },
} satisfies SendTransactionApprovalReview;

const TRANSACTION_ACCOUNT = {
  accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

const createReadService = (
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

  return createApprovalReadService({
    approvals: {
      get: (approvalId) => byId.get(approvalId),
      getState: () => ({ pending }),
    },
    accounts: ACCOUNTS,
    chainViews: CHAIN_VIEWS,
    ...(options?.transactionApprovals ? { transactionApprovals: options.transactionApprovals } : {}),
  });
};

describe("createApprovalReadService", () => {
  it("projects requestAccounts detail with selectable accounts and recommended account", () => {
    const readService = createReadService([
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

    expect(readService.getDetail("approval-request-accounts")).toEqual({
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
            accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            displayAddress: "0xaaaa...aaaa",
          },
          {
            accountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            canonicalAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            displayAddress: "0xbbbb...bbbb",
          },
        ],
        recommendedAccountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      review: null,
    });
  });

  it("projects requestPermissions detail with requested grants", () => {
    const readService = createReadService([
      createRecord({
        approvalId: "approval-request-permissions",
        kind: ApprovalKinds.RequestPermissions,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 2,
        request: {
          chainRef: "eip155:1",
          requestedGrants: [
            {
              grantKind: "eth_accounts",
              chainRefs: ["eip155:1", "eip155:10"],
            },
          ],
        },
      }),
    ]);

    expect(readService.getDetail("approval-request-permissions")).toMatchObject({
      approvalId: "approval-request-permissions",
      kind: ApprovalKinds.RequestPermissions,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        recommendedAccountKey: "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        requestedGrants: [
          { grantKind: "eth_accounts", chainRef: "eip155:1" },
          { grantKind: "eth_accounts", chainRef: "eip155:10" },
        ],
      },
      review: null,
    });
  });

  it("projects static approval kinds into their request shapes", () => {
    const readService = createReadService([
      createRecord({
        approvalId: "approval-sign-message",
        kind: ApprovalKinds.SignMessage,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 3,
        request: {
          chainRef: "eip155:1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          message: "0xdeadbeef",
        },
      }),
      createRecord({
        approvalId: "approval-sign-typed-data",
        kind: ApprovalKinds.SignTypedData,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 4,
        request: {
          chainRef: "eip155:1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          typedData: '{"hello":"world"}',
        },
      }),
      createRecord({
        approvalId: "approval-switch-chain",
        kind: ApprovalKinds.SwitchChain,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 5,
        request: {
          chainRef: "eip155:10",
        },
      }),
      createRecord({
        approvalId: "approval-add-chain",
        kind: ApprovalKinds.AddChain,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:8453",
        createdAt: 6,
        request: {
          isUpdate: false,
          definition: {
            chainRef: "eip155:8453",
            displayName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            blockExplorers: [{ url: "https://basescan.org", type: "default" }],
          },
          defaultRpcEndpoints: [{ url: "https://mainnet.base.org", type: "public" }],
        },
      }),
    ]);

    expect(readService.getDetail("approval-sign-message")).toMatchObject({
      kind: ApprovalKinds.SignMessage,
      request: {
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        message: "0xdeadbeef",
      },
    });
    expect(readService.getDetail("approval-sign-typed-data")).toMatchObject({
      kind: ApprovalKinds.SignTypedData,
      request: {
        typedData: '{"hello":"world"}',
      },
    });
    expect(readService.getDetail("approval-switch-chain")).toMatchObject({
      kind: ApprovalKinds.SwitchChain,
      chainRef: "eip155:10",
      request: {
        chainRef: "eip155:10",
        chainId: "0xa",
        displayName: "Chain eip155:10",
      },
    });
    expect(readService.getDetail("approval-add-chain")).toMatchObject({
      kind: ApprovalKinds.AddChain,
      chainRef: "eip155:8453",
      request: {
        chainRef: "eip155:8453",
        chainId: "0x2105",
        displayName: "Base",
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrl: "https://basescan.org",
        isUpdate: false,
      },
    });
  });

  it("maps wallet-ui initiated generic approvals to wallet-ui source", () => {
    const readService = createReadService([
      {
        ...createRecord({
          approvalId: "approval-wallet-sign-message",
          kind: ApprovalKinds.SignMessage,
          origin: "arx://ui",
          namespace: "eip155",
          chainRef: "eip155:1",
          createdAt: 7,
          request: {
            chainRef: "eip155:1",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            message: "0xdeadbeef",
          },
        }),
        requester: {
          origin: "arx://ui",
          source: "wallet-ui",
          requestId: "request-wallet-1",
        },
      },
    ]);

    expect(readService.listPending()).toEqual([
      expect.objectContaining({
        approvalId: "approval-wallet-sign-message",
        source: "wallet-ui",
      }),
    ]);
    expect(readService.getDetail("approval-wallet-sign-message")).toMatchObject({
      approvalId: "approval-wallet-sign-message",
      source: "wallet-ui",
    });
  });

  it("projects sendTransaction detail and gates canApprove from prepare state", async () => {
    const readService = createReadService([], {
      transactionApprovals: createTransactionApprovalsStub({
        approvals: [
          createTransactionApproval({
            approvalId: "approval-send-ready",
            createdAt: 7,
            updatedAt: SEND_TRANSACTION_REVIEW_READY.updatedAt,
            review: SEND_TRANSACTION_REVIEW_READY.details,
            prepare: {
              id: "prepare-ready",
              status: "ready",
              draftRevision: 0,
              updatedAt: SEND_TRANSACTION_REVIEW_READY.updatedAt,
              preparedAt: SEND_TRANSACTION_REVIEW_READY.updatedAt,
              expiresAt: null,
            },
          }),
          createTransactionApproval({
            approvalId: "approval-send-blocked",
            source: "wallet-ui",
            createdAt: 8,
            origin: "arx://ui",
            updatedAt: SEND_TRANSACTION_REVIEW_BLOCKED.updatedAt,
            review: SEND_TRANSACTION_REVIEW_BLOCKED.details,
            prepare: {
              id: "prepare-blocked",
              status: "blocked",
              draftRevision: 0,
              updatedAt: SEND_TRANSACTION_REVIEW_BLOCKED.updatedAt,
              blocker: SEND_TRANSACTION_REVIEW_BLOCKED.prepare.blocker,
              expiresAt: null,
            },
          }),
        ],
      }),
    });

    await expect(readService.getDetail("approval-send-ready")).resolves.toMatchObject({
      kind: ApprovalKinds.SendTransaction,
      source: "provider",
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        approvalId: "approval-send-ready",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
        prepareId: "prepare-ready",
      },
      review: {
        updatedAt: SEND_TRANSACTION_REVIEW_READY.updatedAt,
        details: SEND_TRANSACTION_REVIEW_READY.details,
        prepare: SEND_TRANSACTION_REVIEW_READY.prepare,
      },
    });
    await expect(readService.getDetail("approval-send-blocked")).resolves.toMatchObject({
      kind: ApprovalKinds.SendTransaction,
      source: "wallet-ui",
      actions: {
        canApprove: false,
        canReject: true,
      },
      request: {
        approvalId: "approval-send-blocked",
        chainRef: "eip155:1",
        origin: "arx://ui",
        prepareId: "prepare-blocked",
      },
      review: {
        updatedAt: SEND_TRANSACTION_REVIEW_BLOCKED.updatedAt,
        details: SEND_TRANSACTION_REVIEW_BLOCKED.details,
        prepare: SEND_TRANSACTION_REVIEW_BLOCKED.prepare,
      },
    });
  });

  it("lists transaction-owned approvals together with generic approval entries", async () => {
    const readService = createReadService(
      [
        createRecord({
          approvalId: "approval-sign-message",
          kind: ApprovalKinds.SignMessage,
          origin: "https://dapp.example",
          namespace: "eip155",
          chainRef: "eip155:1",
          createdAt: 11,
          request: {
            chainRef: "eip155:1",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            message: "0xdeadbeef",
          },
        }),
      ],
      {
        transactionApprovals: createTransactionApprovalsStub({
          approvals: [
            createTransactionApproval({
              approvalId: "approval-send-1",
              createdAt: 9,
            }),
            createTransactionApproval({
              approvalId: "approval-send-2",
              source: "wallet-ui",
              origin: "arx://ui",
              createdAt: 10,
            }),
          ],
        }),
      },
    );

    await expect(readService.listPending()).resolves.toEqual([
      expect.objectContaining({
        approvalId: "approval-send-1",
        kind: ApprovalKinds.SendTransaction,
        source: "provider",
      }),
      expect.objectContaining({
        approvalId: "approval-send-2",
        kind: ApprovalKinds.SendTransaction,
        source: "wallet-ui",
      }),
      expect.objectContaining({
        approvalId: "approval-sign-message",
        kind: ApprovalKinds.SignMessage,
        source: "provider",
      }),
    ]);
  });

  it("reads transaction-owned approval detail by approvalId", async () => {
    const readService = createReadService([], {
      transactionApprovals: createTransactionApprovalsStub({
        approvals: [
          createTransactionApproval({
            approvalId: "approval-send-1",
            createdAt: 9,
          }),
          createTransactionApproval({
            approvalId: "approval-send-2",
            createdAt: 10,
          }),
        ],
      }),
    });

    await expect(readService.getDetail("approval-send-1")).resolves.toMatchObject({
      approvalId: "approval-send-1",
      kind: ApprovalKinds.SendTransaction,
      request: {
        approvalId: "approval-send-1",
      },
    });
    await expect(readService.getDetail("approval-send-2")).resolves.toMatchObject({
      approvalId: "approval-send-2",
      kind: ApprovalKinds.SendTransaction,
      request: {
        approvalId: "approval-send-2",
      },
    });
  });
});
