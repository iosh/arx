import { describe, expect, it, vi } from "vitest";
import { ApprovalKinds, type ApprovalRecord, type ApprovalState } from "../../controllers/approval/types.js";
import { buildUiSnapshot } from "./snapshot.js";
import type { UiAccountsAccess, UiApprovalsAccess, UiSessionAccess } from "./types.js";

const selectedChain = {
  chainRef: "eip155:1",
  chainId: "0x1",
  namespace: "eip155",
  displayName: "Ethereum",
  shortName: "eth",
  icon: null,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

const networks = {
  active: selectedChain.chainRef,
  known: [selectedChain],
  available: [selectedChain],
};

const createApprovalRecord = (
  overrides?: Partial<ApprovalRecord<typeof ApprovalKinds.SignMessage>>,
): ApprovalRecord<typeof ApprovalKinds.SignMessage> => ({
  id: "approval-1",
  kind: ApprovalKinds.SignMessage,
  origin: "https://dapp.example",
  namespace: "eip155",
  chainRef: "eip155:1",
  createdAt: 1_000,
  request: {
    chainRef: "eip155:1",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    message: "hello",
  },
  requester: {
    transport: "provider",
    origin: "https://dapp.example",
    portId: "port-1",
    sessionId: "session-1",
    requestId: "request-1",
  },
  ...overrides,
});

const createDeps = (options?: {
  approvalState?: ApprovalState;
  records?: Map<string, ApprovalRecord>;
  present?: (record: ApprovalRecord) => unknown;
}) => ({
  accounts: {
    getState: () => ({ namespaces: {} }),
    listOwnedForNamespace: () => [],
    getActiveAccountForNamespace: () => null,
    setActiveAccount: async () => {
      throw new Error("not needed in snapshot test");
    },
    onStateChanged: () => () => {},
  } satisfies UiAccountsAccess,
  approvals: {
    getState: () => options?.approvalState ?? { pending: [] },
    get: (id: string) => options?.records?.get(id),
    resolve: async () => {
      throw new Error("not needed in snapshot test");
    },
    onStateChanged: () => () => {},
  } satisfies UiApprovalsAccess,
  chains: {
    buildWalletNetworksSnapshot: () => networks,
    findAvailableChainView: () => selectedChain,
    getApprovalReviewChainView: ({ record }: { record: { namespace: string; chainRef: string } }) => ({
      ...selectedChain,
      namespace: record.namespace,
      chainRef: record.chainRef,
    }),
    getSelectedChainView: () => selectedChain,
  },
  permissions: {
    buildUiPermissionsSnapshot: () => ({ origins: {} }),
  },
  session: {
    unlock: {
      isUnlocked: () => false,
      getState: () => ({
        isUnlocked: false,
        lastUnlockedAt: null,
        timeoutMs: 900_000,
        nextAutoLockAt: null,
      }),
      lock: () => {},
      onStateChanged: () => () => {},
      scheduleAutoLock: () => null,
      setAutoLockDuration: () => {},
      unlock: async () => {},
    },
    vault: {
      getStatus: () => ({ isUnlocked: false, hasEnvelope: false }),
      initialize: async () => {
        throw new Error("not needed in snapshot test");
      },
    },
    withVaultMetaPersistHold: async (fn) => await fn(),
    persistVaultMeta: async () => {},
  } satisfies UiSessionAccess,
  keyrings: {
    getKeyrings: () => [],
  },
  attention: {
    getSnapshot: () => ({ queue: [], count: 0 }),
  },
  namespaceBindings: {
    getUi: () => undefined,
    hasTransaction: () => false,
    hasTransactionReceiptTracking: () => false,
  },
  transactions: {
    getMeta: () => undefined,
  },
  approvalFlowRegistry: {
    present:
      options?.present ??
      ((record: ApprovalRecord) => ({
        id: record.id,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
        type: "unsupported" as const,
        payload: {
          rawType: record.kind,
          rawPayload: record.request,
        },
      })),
  },
});

describe("buildUiSnapshot approvals fallback", () => {
  it("keeps pending approvals visible when a record is missing or a fallback summary is returned", () => {
    const firstRecord = createApprovalRecord();
    const approvalState: ApprovalState = {
      pending: [
        {
          id: "approval-1",
          kind: ApprovalKinds.SignMessage,
          origin: firstRecord.origin,
          namespace: firstRecord.namespace,
          chainRef: firstRecord.chainRef,
          createdAt: firstRecord.createdAt,
        },
        {
          id: "approval-2",
          kind: ApprovalKinds.SignTypedData,
          origin: "https://wallet.example",
          namespace: "eip155",
          chainRef: "eip155:10",
          createdAt: 1_001,
        },
      ],
    };

    const deps = createDeps({
      approvalState,
      records: new Map([["approval-1", firstRecord]]),
      present: vi.fn((record) => ({
        id: record.id,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
        type: "unsupported" as const,
        payload: {
          rawType: record.kind,
          rawPayload: record.request,
        },
      })),
    });

    const snapshot = buildUiSnapshot(deps);

    expect(snapshot.approvals).toEqual([
      {
        id: "approval-1",
        origin: firstRecord.origin,
        namespace: firstRecord.namespace,
        chainRef: firstRecord.chainRef,
        createdAt: firstRecord.createdAt,
        type: "unsupported",
        payload: {
          rawType: firstRecord.kind,
          rawPayload: firstRecord.request,
        },
      },
      {
        id: "approval-2",
        origin: "https://wallet.example",
        namespace: "eip155",
        chainRef: "eip155:10",
        createdAt: 1_001,
        type: "unsupported",
        payload: {
          rawType: ApprovalKinds.SignTypedData,
        },
      },
    ]);
  });

  it("preserves pending queue order in snapshot approvals", () => {
    const approvalState: ApprovalState = {
      pending: [
        {
          id: "approval-b",
          kind: ApprovalKinds.SignMessage,
          origin: "https://b.example",
          namespace: "eip155",
          chainRef: "eip155:1",
          createdAt: 1_000,
        },
        {
          id: "approval-a",
          kind: ApprovalKinds.SignMessage,
          origin: "https://a.example",
          namespace: "eip155",
          chainRef: "eip155:10",
          createdAt: 1_000,
        },
      ],
    };

    const records = new Map<string, ApprovalRecord>([
      [
        "approval-b",
        createApprovalRecord({
          id: "approval-b",
          origin: "https://b.example",
          chainRef: "eip155:1",
          createdAt: 1_000,
        }),
      ],
      [
        "approval-a",
        createApprovalRecord({
          id: "approval-a",
          origin: "https://a.example",
          chainRef: "eip155:10",
          createdAt: 1_000,
          request: {
            chainRef: "eip155:10",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            message: "world",
          },
        }),
      ],
    ]);

    const deps = createDeps({
      approvalState,
      records,
      present: (record) => ({
        id: record.id,
        origin: record.origin,
        namespace: record.namespace,
        chainRef: record.chainRef,
        createdAt: record.createdAt,
        type: "unsupported" as const,
        payload: {
          rawType: record.kind,
          rawPayload: record.request,
        },
      }),
    });

    const snapshot = buildUiSnapshot(deps);

    expect(snapshot.approvals.map((approval) => approval.id)).toEqual(["approval-b", "approval-a"]);
    expect(snapshot.approvals[0]?.id).toBe("approval-b");
  });
});
