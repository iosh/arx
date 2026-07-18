import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { ChainRef } from "../chains/ids.js";
import type { ChainViewsService } from "../chains/views/types.js";
import { chainIdFromChainRef } from "../namespaces/eip155/chainId.js";
import type { SendTransactionApprovalReview } from "../transactions/review/types.js";
import * as Hex from "../utils/hex.js";
import { deriveApprovalReviewContext } from "./chainContext.js";
import { UnsupportedApprovalKindError } from "./errors.js";
import { type ApprovalKind, ApprovalKinds, type ApprovalQueueItem, type ApprovalRecord } from "./queue/types.js";
import { getApprovalSelectableAccounts } from "./shared.js";
import type { ApprovalSource } from "./source.js";

export type ApprovalSelectableAccount = {
  accountId: AccountId;
  canonicalAddress: string;
  displayAddress: string;
};

export type ApprovalListEntry = {
  approvalId: string;
  kind: ApprovalKind;
  source: ApprovalSource;
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  createdAt: number;
};

type ApprovalDetailBase<K extends ApprovalKind, Request, Review> = {
  approvalId: string;
  kind: K;
  source: ApprovalSource;
  origin: string;
  namespace: string;
  chainRef: ChainRef;
  createdAt: number;
  actions: {
    canApprove: boolean;
    canReject: boolean;
  };
  request: Request;
  review: Review;
};

type RequestAccountsRequest = {
  selectableAccounts: ApprovalSelectableAccount[];
  recommendedAccountId: AccountId;
};

type RequestPermissionsRequest = {
  selectableAccounts: ApprovalSelectableAccount[];
  recommendedAccountId: AccountId;
  requestedGrants: Array<{
    grantKind: string;
    chainRef: ChainRef;
  }>;
};

type SignMessageRequest = {
  from: string;
  message: string;
};

type SignTypedDataRequest = {
  from: string;
  typedData: string;
};

type SwitchChainRequest = {
  chainRef: ChainRef;
  chainId?: string | undefined;
  displayName?: string | undefined;
};

type AddChainRequest = {
  chainRef: ChainRef;
  chainId: string;
  displayName: string;
  rpcUrls: string[];
  nativeCurrency?:
    | {
        name: string;
        symbol: string;
        decimals: number;
      }
    | undefined;
  blockExplorerUrl?: string | undefined;
  isUpdate: boolean;
};

type SendTransactionRequest = {
  approvalId: string;
  chainRef: ChainRef;
  origin: string;
  proposalId: string;
};

export type ApprovalAccountSelectionDetail =
  | ApprovalDetailBase<typeof ApprovalKinds.RequestAccounts, RequestAccountsRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.RequestPermissions, RequestPermissionsRequest, null>;

export type ApprovalStaticDetail =
  | ApprovalDetailBase<typeof ApprovalKinds.SignMessage, SignMessageRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.SignTypedData, SignTypedDataRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.SwitchChain, SwitchChainRequest, null>
  | ApprovalDetailBase<typeof ApprovalKinds.AddChain, AddChainRequest, null>;

export type ApprovalSendTransactionDetail = ApprovalDetailBase<
  typeof ApprovalKinds.SendTransaction,
  SendTransactionRequest,
  SendTransactionApprovalReview
>;

export type ApprovalDetail = ApprovalAccountSelectionDetail | ApprovalStaticDetail | ApprovalSendTransactionDetail;

export type ApprovalDetailsDeps = {
  approvals: {
    get(approvalId: string): ApprovalRecord | undefined;
    getState(): { pending: ApprovalQueueItem[] };
  };
  accounts: Pick<Accounts, "getSelectedAddress" | "listSelectableAddresses">;
  chainViews: Pick<ChainViewsService, "findAvailableChainView" | "requireChainDefinition">;
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

const assertUnreachable = (value: never): never => {
  throw new UnsupportedApprovalKindError(String(value));
};

const toDetailMeta = (record: ApprovalRecord) => {
  const reviewContext = deriveApprovalReviewContext(record);

  return {
    approvalId: record.approvalId,
    source: record.requester.source,
    origin: record.origin,
    namespace: reviewContext.namespace,
    chainRef: reviewContext.reviewChainRef,
    createdAt: record.createdAt,
  };
};

const toSelectableAccounts = (accounts: ReturnType<typeof getApprovalSelectableAccounts>["selectableAccounts"]) =>
  accounts.map((account) => ({
    accountId: account.accountId,
    canonicalAddress: account.canonicalAddress,
    displayAddress: account.displayAddress,
  }));

const toChainDisplayName = (chain: { displayName: string }): string | undefined => {
  const name = chain.displayName.trim();
  return name.length > 0 ? name : undefined;
};

const buildSelectionDetail = (
  record:
    | ApprovalRecord<typeof ApprovalKinds.RequestAccounts>
    | ApprovalRecord<typeof ApprovalKinds.RequestPermissions>,
  deps: ApprovalDetailsDeps,
): ApprovalDetail => {
  const { selectableAccounts, recommendedAccountId } = getApprovalSelectableAccounts(record, deps, {
    request: record.request,
  });

  if (record.kind === ApprovalKinds.RequestAccounts) {
    return {
      ...toDetailMeta(record),
      kind: ApprovalKinds.RequestAccounts,
      actions: {
        canApprove: true,
        canReject: true,
      },
      request: {
        selectableAccounts: toSelectableAccounts(selectableAccounts),
        recommendedAccountId,
      },
      review: null,
    };
  }

  return {
    ...toDetailMeta(record),
    kind: ApprovalKinds.RequestPermissions,
    actions: {
      canApprove: true,
      canReject: true,
    },
    request: {
      selectableAccounts: toSelectableAccounts(selectableAccounts),
      recommendedAccountId,
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
      const context = deriveApprovalReviewContext(record, { request: record.request });
      const target =
        deps.chainViews.findAvailableChainView({ chainRef: context.reviewChainRef }) ??
        deps.chainViews.requireChainDefinition(context.reviewChainRef);
      const displayName = toChainDisplayName(target);

      return {
        ...toDetailMeta(record),
        kind: ApprovalKinds.SwitchChain,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          chainRef: context.reviewChainRef,
          chainId: Hex.fromNumber(chainIdFromChainRef(context.reviewChainRef)),
          ...(displayName ? { displayName } : {}),
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
          chainId: Hex.fromNumber(chainIdFromChainRef(definition.chainRef)),
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

const buildTransactionDetail = (
  record: ApprovalRecord<typeof ApprovalKinds.SendTransaction>,
): ApprovalSendTransactionDetail => {
  const proposal = record.request.proposal;
  return {
    approvalId: record.approvalId,
    kind: ApprovalKinds.SendTransaction,
    source: record.requester.source,
    origin: record.origin,
    namespace: proposal.namespace,
    chainRef: proposal.chainRef,
    createdAt: record.createdAt,
    actions: {
      canApprove: proposal.status === "ready",
      canReject: true,
    },
    request: {
      approvalId: record.approvalId,
      chainRef: proposal.chainRef,
      origin: proposal.origin,
      proposalId: proposal.proposalId,
    },
    review: {
      details: proposal.review,
      prepare: { state: "ready" },
    },
  };
};

export const createApprovalDetails = (deps: ApprovalDetailsDeps): ApprovalDetails => {
  const listPending = async (): Promise<ApprovalListEntry[]> => {
    const pending = deps.approvals.getState().pending;
    return pending.map(toListEntry).sort((left, right) => left.createdAt - right.createdAt);
  };

  const getDetail = async (approvalId: string): Promise<ApprovalDetail | null> => {
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
      return buildTransactionDetail(record);
    }

    throw new UnsupportedApprovalKindError(record.kind);
  };

  return {
    listPending,
    getDetail,
  };
};
