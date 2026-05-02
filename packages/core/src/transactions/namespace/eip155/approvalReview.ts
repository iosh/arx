import type { NamespaceTransactionReview } from "../../../controllers/transaction/review/types.js";
import type { Eip155TransactionPayload, TransactionPrepared } from "../../types.js";
import type { TransactionApprovalReviewContext } from "../types.js";
import type { Eip155PreparedTransaction } from "./types.js";

const getReviewPayload = (context: TransactionApprovalReviewContext): Eip155TransactionPayload => {
  if (context.request.namespace === "eip155") {
    return context.request.payload as Eip155TransactionPayload;
  }

  throw new Error(`EIP-155 approval review received namespace "${context.request.namespace}"`);
};

export const buildEip155ApprovalReview = (context: TransactionApprovalReviewContext): NamespaceTransactionReview => {
  const requestPayload = getReviewPayload(context);
  const prepared = context.reviewPreparedSnapshot as Partial<Eip155PreparedTransaction> | null;

  return {
    namespace: "eip155",
    summary: {
      from: context.from ?? "",
      to: typeof requestPayload.to === "string" ? requestPayload.to : null,
      value: requestPayload.value,
      data: requestPayload.data,
    },
    execution: {
      gas: prepared?.gas ?? requestPayload.gas,
      gasPrice: prepared?.gasPrice ?? requestPayload.gasPrice,
      maxFeePerGas: prepared?.maxFeePerGas ?? requestPayload.maxFeePerGas,
      maxPriorityFeePerGas: prepared?.maxPriorityFeePerGas ?? requestPayload.maxPriorityFeePerGas,
    },
  };
};
