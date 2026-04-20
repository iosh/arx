import { describe, expect, it } from "vitest";
import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "../../../controllers/approval/types.js";
import { createApprovalReadService } from "./readService.js";

const CHAIN_VIEWS = {
  getApprovalReviewChainView: ({ record, request }: { record: ApprovalRecord; request?: { chainRef?: string } }) => {
    const chainRef = request?.chainRef ?? record.chainRef;
    const [namespace] = chainRef.split(":");
    return {
      namespace,
      chainRef,
      chainId: "0x1",
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
          chainId: "0x1",
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
  reviewState: {
    status: "ready" as const,
    revision: 3,
    updatedAt: 3,
    error: null,
  },
  warnings: [],
  approvalBlocker: null,
  namespaceReview: {
    namespace: "eip155" as const,
    summary: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      value: "0x1",
      data: "0x",
    },
    execution: {
      gas: "0x5208",
      gasPrice: "0x3b9aca00",
    },
  },
};

const SEND_TRANSACTION_REVIEW_BLOCKED = {
  reviewState: {
    status: "ready" as const,
    revision: 4,
    updatedAt: 4,
    error: null,
  },
  warnings: [],
  approvalBlocker: {
    code: "transaction.blocked",
    message: "Blocked",
  },
  namespaceReview: null,
};

const createRecord = <K extends ApprovalRecord["kind"]>(
  record: Omit<ApprovalRecord<K>, "requester"> & { request: ApprovalRecord<K>["request"] },
): ApprovalRecord<K> => ({
  requester: {
    transport: "provider",
    origin: record.origin,
    portId: "test-port",
    sessionId: "session-1",
    requestId: "request-1",
  },
  ...record,
});

const createReadService = (
  records: ApprovalRecord[],
  reviews?: Record<string, typeof SEND_TRANSACTION_REVIEW_READY>,
) => {
  const byId = new Map(records.map((record) => [record.approvalId, record] as const));
  const pending: ApprovalQueueItem[] = records.map((record) => ({
    approvalId: record.approvalId,
    kind: record.kind,
    origin: record.origin,
    namespace: record.namespace,
    chainRef: record.chainRef,
    createdAt: record.createdAt,
  }));

  return createApprovalReadService({
    approvals: {
      get: (approvalId) => byId.get(approvalId),
      getSubject: (approvalId) => {
        const record = byId.get(approvalId);
        return record?.subject;
      },
      listPendingIdsBySubject: (subject) =>
        records
          .filter(
            (record) => record.subject?.kind === subject.kind && record.subject.transactionId === subject.transactionId,
          )
          .map((record) => record.approvalId),
      getState: () => ({ pending }),
    },
    accounts: ACCOUNTS,
    chainViews: CHAIN_VIEWS,
    transactions: {
      getMeta: () => undefined,
      getApprovalReview: ({ transactionId }) => reviews?.[transactionId] ?? SEND_TRANSACTION_REVIEW_READY,
    },
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
          metadata: {
            chainRef: "eip155:8453",
            namespace: "eip155",
            chainId: "0x2105",
            displayName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcEndpoints: [{ url: "https://mainnet.base.org", type: "public" }],
            blockExplorers: [{ url: "https://basescan.org", type: "default" }],
          },
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
        chainId: "0x1",
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

  it("projects sendTransaction detail and gates canApprove from review state", () => {
    const records = [
      createRecord({
        approvalId: "approval-send-ready",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        subject: {
          kind: "transaction",
          transactionId: "tx-ready",
        },
        createdAt: 7,
        request: {
          chainRef: "eip155:1",
          origin: "https://dapp.example",
          chain: null,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          request: {
            namespace: "eip155",
            chainRef: "eip155:1",
            payload: {
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0x1",
              data: "0x",
            },
          },
          warnings: [],
          issues: [],
        },
      }),
      createRecord({
        approvalId: "approval-send-blocked",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        subject: {
          kind: "transaction",
          transactionId: "tx-blocked",
        },
        createdAt: 8,
        request: {
          chainRef: "eip155:1",
          origin: "https://dapp.example",
          chain: null,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          request: {
            namespace: "eip155",
            chainRef: "eip155:1",
            payload: {
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          },
          warnings: [],
          issues: [],
        },
      }),
    ];

    const readService = createReadService(records, {
      "tx-ready": SEND_TRANSACTION_REVIEW_READY,
      "tx-blocked": SEND_TRANSACTION_REVIEW_BLOCKED,
    });

    expect(readService.getDetail("approval-send-ready")).toMatchObject({
      kind: ApprovalKinds.SendTransaction,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        transactionId: "tx-ready",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
      },
      review: SEND_TRANSACTION_REVIEW_READY,
    });
    expect(readService.getDetail("approval-send-blocked")).toMatchObject({
      kind: ApprovalKinds.SendTransaction,
      actions: {
        canApprove: false,
        canReject: true,
      },
      request: {
        transactionId: "tx-blocked",
        chainRef: "eip155:1",
        origin: "https://dapp.example",
      },
      review: SEND_TRANSACTION_REVIEW_BLOCKED,
    });
  });

  it("lists affected approval ids by approvalId and matching transactionId only", () => {
    const readService = createReadService([
      createRecord({
        approvalId: "approval-send-1",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        subject: {
          kind: "transaction",
          transactionId: "tx-1",
        },
        createdAt: 9,
        request: {
          chainRef: "eip155:1",
          origin: "https://dapp.example",
          chain: null,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          request: {
            namespace: "eip155",
            payload: {},
          },
          warnings: [],
          issues: [],
        },
      }),
      createRecord({
        approvalId: "approval-send-2",
        kind: ApprovalKinds.SendTransaction,
        origin: "https://dapp.example",
        namespace: "eip155",
        chainRef: "eip155:1",
        subject: {
          kind: "transaction",
          transactionId: "tx-2",
        },
        createdAt: 10,
        request: {
          chainRef: "eip155:1",
          origin: "https://dapp.example",
          chain: null,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          request: {
            namespace: "eip155",
            payload: {},
          },
          warnings: [],
          issues: [],
        },
      }),
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
    ]);

    expect(readService.listAffectedApprovalIds({ approvalId: "approval-send-1" })).toEqual(["approval-send-1"]);
    expect(readService.listAffectedApprovalIds({ transactionId: "tx-2" })).toEqual(["approval-send-2"]);
    expect(readService.listAffectedApprovalIds({ transactionId: "missing" })).toEqual([]);
  });
});
