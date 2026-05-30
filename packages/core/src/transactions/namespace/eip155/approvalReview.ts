import type { Eip155TransactionReviewDetails } from "../../review.js";
import type { Eip155ApprovalReviewContext } from "./types.js";

const isNonEmptyEip155CallData = (data: string | undefined): data is string =>
  typeof data === "string" && data.toLowerCase() !== "0x";

const getEip155TransactionKind = (payload: Eip155ApprovalReviewContext["request"]["payload"]) => {
  if (!payload.to) return "contract_deployment";
  if (isNonEmptyEip155CallData(payload.data)) return "contract_interaction";
  return "native_transfer";
};

export const buildEip155ApprovalReview = (context: Eip155ApprovalReviewContext): Eip155TransactionReviewDetails => {
  const requestPayload = context.request.payload;
  const reviewSnapshot = context.reviewSnapshot;
  const data = isNonEmptyEip155CallData(requestPayload.data) ? requestPayload.data : null;

  return {
    namespace: "eip155",
    kind: getEip155TransactionKind(requestPayload),
    from: context.from,
    to: requestPayload.to ?? null,
    value: requestPayload.value ?? "0x0",
    data,
    gasLimit: reviewSnapshot?.gas ?? requestPayload.gas ?? null,
    fees: {
      gasPrice: reviewSnapshot?.gasPrice ?? requestPayload.gasPrice ?? null,
      maxFeePerGas: reviewSnapshot?.maxFeePerGas ?? requestPayload.maxFeePerGas ?? null,
      maxPriorityFeePerGas: reviewSnapshot?.maxPriorityFeePerGas ?? requestPayload.maxPriorityFeePerGas ?? null,
    },
  };
};
