import { z } from "zod";
import { ApprovalAccountSelectionDecisionSchema } from "../../../approvals/decision.js";
import type { ApprovalKind, ApprovalKinds } from "../../../approvals/queue/types.js";
import type { ApprovalSource } from "../../../approvals/source.js";
import type { ChainRef } from "../../../chains/ids.js";
import type { AccountKey } from "../../../storage/records.js";
import type { SendTransactionApprovalReview } from "../../../transactions/review/types.js";

export type ApprovalSelectableAccount = {
  accountKey: AccountKey;
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
  recommendedAccountKey: AccountKey | null;
};

type RequestPermissionsRequest = {
  selectableAccounts: ApprovalSelectableAccount[];
  recommendedAccountKey: AccountKey | null;
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
  prepareId: string | null;
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

export const ApprovalResolveRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("approve"),
    decision: ApprovalAccountSelectionDecisionSchema.optional(),
    expectedPrepareId: z.string().min(1).optional(),
  }),
  z.strictObject({
    approvalId: z.string().min(1),
    action: z.literal("reject"),
    reason: z.string().min(1).optional(),
  }),
]);

export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequestSchema>;
export type ApprovalResolveResult = null;
export type { SendTransactionApprovalReview };
