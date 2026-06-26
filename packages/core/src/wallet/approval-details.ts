import { deriveApprovalReviewContext } from "../approvals/chainContext.js";
import { ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "../approvals/queue/types.js";
import { getApprovalSelectableAccounts } from "../approvals/shared.js";
import { eip155ChainIdHexFromChainRef } from "../chains/eip155/format.js";
import type { WalletAccounts } from "../engine/types.js";
import type { ChainViewsService } from "../services/runtime/chainViews/types.js";
import type { TransactionApproval, TransactionsService } from "../transactions/TransactionsService.js";
import type { ApprovalDetail, ApprovalListEntry, ApprovalSendTransactionDetail } from "./types.js";

export type ApprovalDetailsDeps = {
  approvals: {
    get(approvalId: string): ApprovalRecord | undefined;
    getState(): { pending: ApprovalQueueItem[] };
  };
  accounts: Pick<WalletAccounts, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  chainViews: Pick<ChainViewsService, "getApprovalReviewChainView" | "findAvailableChainView">;
  transactionApprovals?: Pick<TransactionsService, "getTransactionApproval" | "listTransactionApprovals">;
};

export type ApprovalDetails = Readonly<{
  listPending(): Promise<ApprovalListEntry[]>;
  getDetail(approvalId: string): Promise<ApprovalDetail | null>;
}>;

const isApprovalRecord = <K extends ApprovalRecord["kind"]>(
  record: ApprovalRecord,
  kind: K,
): record is ApprovalRecord<K> => record.kind === kind;

const toListEntry = (item: ApprovalQueueItem): ApprovalListEntry => ({
  approvalId: item.approvalId,
  kind: item.kind,
  source: item.source,
  origin: item.origin,
  namespace: item.namespace,
  chainRef: item.chainRef,
  createdAt: item.createdAt,
});

const toTransactionApprovalListEntry = (approval: TransactionApproval): ApprovalListEntry => ({
  approvalId: approval.approvalId,
  kind: ApprovalKinds.SendTransaction,
  source: approval.source,
  origin: approval.origin,
  namespace: approval.namespace,
  chainRef: approval.chainRef,
  createdAt: approval.createdAt,
});

const assertUnreachable = (_value: never): never => {
  throw new Error("Unreachable approval kind");
};

const toDetailMeta = (record: ApprovalRecord) => {
  const requestChainRef = getApprovalRequestChainRef(record);
  const reviewContext = deriveApprovalReviewContext(
    record,
    requestChainRef ? { request: { chainRef: requestChainRef } } : undefined,
  );

  return {
    approvalId: record.approvalId,
    source: record.requester.source,
    origin: record.origin,
    namespace: reviewContext.namespace,
    chainRef: reviewContext.reviewChainRef,
    createdAt: record.createdAt,
  };
};

const getApprovalRequestChainRef = (record: ApprovalRecord): string | undefined => {
  if (isApprovalRecord(record, ApprovalKinds.AddChain)) {
    return record.request.definition.chainRef;
  }

  if (
    isApprovalRecord(record, ApprovalKinds.RequestAccounts) ||
    isApprovalRecord(record, ApprovalKinds.RequestPermissions) ||
    isApprovalRecord(record, ApprovalKinds.SignMessage) ||
    isApprovalRecord(record, ApprovalKinds.SignTypedData) ||
    isApprovalRecord(record, ApprovalKinds.SwitchChain)
  ) {
    return record.request.chainRef;
  }

  return undefined;
};

const toSelectableAccounts = (accounts: ReturnType<typeof getApprovalSelectableAccounts>["selectableAccounts"]) =>
  accounts.map((account) => ({
    accountKey: account.accountKey,
    canonicalAddress: account.canonicalAddress,
    displayAddress: account.displayAddress,
  }));

const buildSelectionDetail = (
  record:
    | ApprovalRecord<typeof ApprovalKinds.RequestAccounts>
    | ApprovalRecord<typeof ApprovalKinds.RequestPermissions>,
  deps: ApprovalDetailsDeps,
): ApprovalDetail => {
  const { selectableAccounts, recommendedAccountKey } = getApprovalSelectableAccounts(record, deps, {
    request: record.request,
  });

  if (record.kind === ApprovalKinds.RequestAccounts) {
    return {
      ...toDetailMeta(record),
      kind: ApprovalKinds.RequestAccounts,
      actions: {
        canApprove: selectableAccounts.length > 0,
        canReject: true,
      },
      request: {
        selectableAccounts: toSelectableAccounts(selectableAccounts),
        recommendedAccountKey,
      },
      review: null,
    };
  }

  return {
    ...toDetailMeta(record),
    kind: ApprovalKinds.RequestPermissions,
    actions: {
      canApprove: selectableAccounts.length > 0,
      canReject: true,
    },
    request: {
      selectableAccounts: toSelectableAccounts(selectableAccounts),
      recommendedAccountKey,
      requestedGrants: record.request.requestedGrants.flatMap((item) =>
        item.chainRefs.map((chainRef) => ({
          grantKind: item.grantKind,
          chainRef,
        })),
      ),
    },
    review: null,
  };
};

const buildStaticDetail = (
  record:
    | ApprovalRecord<typeof ApprovalKinds.SignMessage>
    | ApprovalRecord<typeof ApprovalKinds.SignTypedData>
    | ApprovalRecord<typeof ApprovalKinds.SwitchChain>
    | ApprovalRecord<typeof ApprovalKinds.AddChain>,
  deps: ApprovalDetailsDeps,
): ApprovalDetail => {
  switch (record.kind) {
    case ApprovalKinds.SignMessage:
      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.SignMessage,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          from: record.request.from,
          message: record.request.message,
        },
        review: null,
      };

    case ApprovalKinds.SignTypedData:
      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.SignTypedData,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          from: record.request.from,
          typedData: record.request.typedData,
        },
        review: null,
      };

    case ApprovalKinds.SwitchChain: {
      const reviewChain = deps.chainViews.getApprovalReviewChainView({
        record,
        request: record.request,
      });
      const target = deps.chainViews.findAvailableChainView({ chainRef: reviewChain.chainRef }) ?? reviewChain;

      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.SwitchChain,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          chainRef: reviewChain.chainRef,
          chainId: eip155ChainIdHexFromChainRef(reviewChain.chainRef),
          ...(target.displayName ? { displayName: target.displayName } : {}),
        },
        review: null,
      };
    }

    case ApprovalKinds.AddChain: {
      const definition = record.request.definition;
      const rpcUrls = Array.from(
        new Set(record.request.defaultRpcEndpoints.map((entry) => entry.url.trim()).filter(Boolean)),
      );
      const blockExplorerUrl =
        definition.blockExplorers?.find((entry) => entry.type === "default")?.url ??
        definition.blockExplorers?.[0]?.url;

      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.AddChain,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          chainRef: record.chainRef,
          chainId: eip155ChainIdHexFromChainRef(definition.chainRef),
          displayName: definition.displayName,
          rpcUrls,
          ...(definition.nativeCurrency
            ? {
                nativeCurrency: {
                  name: definition.nativeCurrency.name,
                  symbol: definition.nativeCurrency.symbol,
                  decimals: definition.nativeCurrency.decimals,
                },
              }
            : {}),
          ...(blockExplorerUrl ? { blockExplorerUrl } : {}),
          isUpdate: record.request.isUpdate,
        },
        review: null,
      };
    }
  }

  return assertUnreachable(record);
};

const toTransactionReviewPrepare = (
  approval: TransactionApproval,
): ApprovalSendTransactionDetail["review"]["prepare"] => {
  const prepare = approval.prepare;

  if (prepare.status === "preparing") {
    return { state: "preparing" };
  }

  if (prepare.status === "ready") {
    return { state: "ready" };
  }

  if (prepare.status === "blocked") {
    return {
      state: "blocked",
      blocker: prepare.blocker,
    };
  }

  return {
    state: "failed",
    error: prepare.error,
  };
};

const buildTransactionDetail = (approval: TransactionApproval): ApprovalSendTransactionDetail => {
  return {
    approvalId: approval.approvalId,
    kind: ApprovalKinds.SendTransaction,
    source: approval.source,
    origin: approval.origin,
    namespace: approval.namespace,
    chainRef: approval.chainRef,
    createdAt: approval.createdAt,
    actions: {
      canApprove: approval.prepare.status === "ready",
      canReject: true,
    },
    request: {
      approvalId: approval.approvalId,
      chainRef: approval.chainRef,
      origin: approval.origin,
      prepareId: approval.prepare.id,
    },
    review: {
      updatedAt: approval.updatedAt,
      details: approval.review,
      prepare: toTransactionReviewPrepare(approval),
    },
  };
};

export const createApprovalDetails = (deps: ApprovalDetailsDeps): ApprovalDetails => {
  const listPending = async (): Promise<ApprovalListEntry[]> => {
    const [pending, transactionApprovals] = await Promise.all([
      Promise.resolve(deps.approvals.getState().pending),
      deps.transactionApprovals ? deps.transactionApprovals.listTransactionApprovals() : Promise.resolve([]),
    ]);

    return [...pending.map(toListEntry), ...transactionApprovals.map(toTransactionApprovalListEntry)].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  };

  const getDetail = async (approvalId: string): Promise<ApprovalDetail | null> => {
    const transactionApproval = deps.transactionApprovals?.getTransactionApproval(approvalId) ?? null;
    if (transactionApproval) {
      return buildTransactionDetail(transactionApproval);
    }

    const record = deps.approvals.get(approvalId);
    if (!record) {
      return null;
    }

    if (
      isApprovalRecord(record, ApprovalKinds.RequestAccounts) ||
      isApprovalRecord(record, ApprovalKinds.RequestPermissions)
    ) {
      return buildSelectionDetail(record, deps);
    }

    if (
      isApprovalRecord(record, ApprovalKinds.SignMessage) ||
      isApprovalRecord(record, ApprovalKinds.SignTypedData) ||
      isApprovalRecord(record, ApprovalKinds.SwitchChain) ||
      isApprovalRecord(record, ApprovalKinds.AddChain)
    ) {
      return buildStaticDetail(record, deps);
    }

    throw new Error(`Unsupported approval kind: ${record.kind}`);
  };

  return {
    listPending,
    getDetail,
  };
};
