import { deriveApprovalReviewContext } from "../../../approvals/chainContext.js";
import { getApprovalSelectableAccounts } from "../../../approvals/shared.js";
import {
  ApprovalKinds,
  type ApprovalQueueItem,
  type ApprovalRecord,
  type ApprovalSubject,
} from "../../../controllers/approval/types.js";
import type { TransactionController } from "../../../controllers/transaction/types.js";
import type { WalletAccounts } from "../../../engine/types.js";
import type { ChainViewsService } from "../../../services/runtime/chainViews/types.js";
import type {
  ApprovalDetail,
  ApprovalListEntry,
  ApprovalSendTransactionDetail,
} from "../../protocol/models/approvals.js";

type ApprovalReadServiceDeps = {
  approvals: {
    get(approvalId: string): ApprovalRecord | undefined;
    getSubject(approvalId: string): ApprovalSubject | undefined;
    listPendingIdsBySubject(subject: ApprovalSubject): string[];
    getState(): { pending: ApprovalQueueItem[] };
  };
  accounts: Pick<WalletAccounts, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  chainViews: Pick<ChainViewsService, "getApprovalReviewChainView" | "findAvailableChainView">;
  transactions: Pick<TransactionController, "getApprovalReview" | "getMeta">;
};

const isApprovalRecord = <K extends ApprovalRecord["kind"]>(
  record: ApprovalRecord,
  kind: K,
): record is ApprovalRecord<K> => record.kind === kind;

const toListEntry = (item: ApprovalQueueItem): ApprovalListEntry => ({
  approvalId: item.approvalId,
  kind: item.kind,
  origin: item.origin,
  namespace: item.namespace,
  chainRef: item.chainRef,
  createdAt: item.createdAt,
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
    origin: record.origin,
    namespace: reviewContext.namespace,
    chainRef: reviewContext.reviewChainRef,
    createdAt: record.createdAt,
  };
};

const getApprovalRequestChainRef = (record: ApprovalRecord): string | undefined => {
  if (isApprovalRecord(record, ApprovalKinds.AddChain)) {
    return record.request.metadata.chainRef;
  }

  if (
    isApprovalRecord(record, ApprovalKinds.RequestAccounts) ||
    isApprovalRecord(record, ApprovalKinds.RequestPermissions) ||
    isApprovalRecord(record, ApprovalKinds.SignMessage) ||
    isApprovalRecord(record, ApprovalKinds.SignTypedData) ||
    isApprovalRecord(record, ApprovalKinds.SwitchChain) ||
    isApprovalRecord(record, ApprovalKinds.SendTransaction)
  ) {
    return record.request.chainRef;
  }

  return undefined;
};

const buildSelectionDetail = (
  record:
    | ApprovalRecord<typeof ApprovalKinds.RequestAccounts>
    | ApprovalRecord<typeof ApprovalKinds.RequestPermissions>,
  deps: ApprovalReadServiceDeps,
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
        selectableAccounts: selectableAccounts.map((account) => ({
          accountKey: account.accountKey,
          canonicalAddress: account.canonicalAddress,
          displayAddress: account.displayAddress,
        })),
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
      selectableAccounts: selectableAccounts.map((account) => ({
        accountKey: account.accountKey,
        canonicalAddress: account.canonicalAddress,
        displayAddress: account.displayAddress,
      })),
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
  deps: ApprovalReadServiceDeps,
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
          ...(target.chainId ? { chainId: target.chainId } : {}),
          ...(target.displayName ? { displayName: target.displayName } : {}),
        },
        review: null,
      };
    }

    case ApprovalKinds.AddChain: {
      const meta = record.request.metadata;
      const rpcUrls = Array.from(new Set(meta.rpcEndpoints.map((entry) => entry.url.trim()).filter(Boolean)));
      const blockExplorerUrl =
        meta.blockExplorers?.find((entry) => entry.type === "default")?.url ?? meta.blockExplorers?.[0]?.url;

      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.AddChain,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          chainRef: record.chainRef,
          chainId: meta.chainId,
          displayName: meta.displayName,
          rpcUrls,
          ...(meta.nativeCurrency
            ? {
                nativeCurrency: {
                  name: meta.nativeCurrency.name,
                  symbol: meta.nativeCurrency.symbol,
                  decimals: meta.nativeCurrency.decimals,
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

const buildSendTransactionDetail = (
  record: ApprovalRecord<typeof ApprovalKinds.SendTransaction>,
  deps: ApprovalReadServiceDeps,
): ApprovalSendTransactionDetail => {
  const subject = deps.approvals.getSubject(record.approvalId);
  if (subject?.kind !== "transaction") {
    throw new Error(`Send-transaction approval ${record.approvalId} is missing a transaction subject.`);
  }

  const review = deps.transactions.getApprovalReview({
    transactionId: subject.transactionId,
    request: record.request,
  });

  return {
    ...toDetailMeta(record),
    kind: ApprovalKinds.SendTransaction,
    actions: {
      canApprove: review.prepare.state === "ready",
      canReject: true,
    },
    request: {
      transactionId: subject.transactionId,
      chainRef: record.request.chainRef,
      origin: record.request.origin,
    },
    review,
  };
};

export const createApprovalReadService = (deps: ApprovalReadServiceDeps) => {
  const listPending = (): ApprovalListEntry[] => deps.approvals.getState().pending.map(toListEntry);

  const getDetail = (approvalId: string): ApprovalDetail | null => {
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

    if (isApprovalRecord(record, ApprovalKinds.SendTransaction)) {
      return buildSendTransactionDetail(record, deps);
    }

    throw new Error(`Unsupported approval kind: ${record.kind}`);
  };

  const listAffectedApprovalIds = (change: { approvalId: string } | { transactionId: string }): string[] => {
    if ("approvalId" in change) {
      return [change.approvalId];
    }

    return deps.approvals.listPendingIdsBySubject({
      kind: "transaction",
      transactionId: change.transactionId,
    });
  };

  return {
    listPending,
    getDetail,
    listAffectedApprovalIds,
  };
};
