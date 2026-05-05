import type { NamespaceTransactionReview } from "../../review.js";
import type { Eip155ApprovalReviewContext } from "./types.js";

export const buildEip155ApprovalReview = (context: Eip155ApprovalReviewContext): NamespaceTransactionReview => {
  const requestPayload = context.request.payload;
  const prepared = context.reviewPreparedSnapshot;

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
