import type { ApprovalKinds, ApprovalRequestByKind } from "../../../controllers/approval/types.js";
import type { NamespaceTransactionReview } from "../../../controllers/transaction/review/types.js";
import type { Eip155TransactionPayload, TransactionPrepared } from "../../types.js";
import type { TransactionProposalContext } from "../types.js";
import type { Eip155PreparedTransaction } from "./types.js";

const getApprovalPayload = (args: {
  proposal: TransactionProposalContext | null;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
}): Eip155TransactionPayload => {
  const proposalPayload = args.proposal?.currentRequest.payload;
  if (args.proposal?.currentRequest.namespace === "eip155") {
    return proposalPayload as Eip155TransactionPayload;
  }

  if (args.request.request.namespace !== "eip155") {
    throw new Error(`EIP-155 approval review received namespace "${args.request.request.namespace}"`);
  }

  return args.request.request.payload as Eip155TransactionPayload;
};

export const buildEip155ApprovalReview = (args: {
  proposal: TransactionProposalContext | null;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
  reviewPreparedSnapshot: TransactionPrepared | null;
}): NamespaceTransactionReview => {
  const requestPayload = getApprovalPayload(args);
  const prepared = args.reviewPreparedSnapshot as Partial<Eip155PreparedTransaction> | null;
  const sourceRequest = args.proposal?.currentRequest.namespace === "eip155" ? args.proposal.currentRequest : null;
  const sourcePayload: Eip155TransactionPayload = sourceRequest
    ? (sourceRequest.payload as Eip155TransactionPayload)
    : requestPayload;

  return {
    namespace: "eip155",
    summary: {
      from: args.proposal?.from ?? args.request.from ?? "",
      to: typeof sourcePayload.to === "string" ? sourcePayload.to : null,
      value: sourcePayload.value,
      data: sourcePayload.data,
    },
    execution: {
      gas: prepared?.gas ?? sourcePayload.gas,
      gasPrice: prepared?.gasPrice ?? sourcePayload.gasPrice,
      maxFeePerGas: prepared?.maxFeePerGas ?? sourcePayload.maxFeePerGas,
      maxPriorityFeePerGas: prepared?.maxPriorityFeePerGas ?? sourcePayload.maxPriorityFeePerGas,
    },
  };
};
