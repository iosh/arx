import type { ApprovalKinds, ApprovalRequestByKind } from "../../../controllers/approval/types.js";
import type { NamespaceTransactionReview } from "../../../controllers/transaction/review/types.js";
import type { TransactionMeta } from "../../../controllers/transaction/types.js";
import type { Eip155TransactionPayload } from "../../types.js";
import type { Eip155PreparedTransaction } from "./types.js";

const getApprovalPayload = (args: {
  transaction: TransactionMeta | undefined;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
}): Eip155TransactionPayload => {
  const transactionPayload = args.transaction?.request?.payload;
  if (args.transaction?.request?.namespace === "eip155") {
    return transactionPayload as Eip155TransactionPayload;
  }

  if (args.request.request.namespace !== "eip155") {
    throw new Error(`EIP-155 approval review received namespace "${args.request.request.namespace}"`);
  }

  return args.request.request.payload as Eip155TransactionPayload;
};

export const buildEip155ApprovalReview = (args: {
  transaction: TransactionMeta | undefined;
  request: ApprovalRequestByKind[typeof ApprovalKinds.SendTransaction];
}): NamespaceTransactionReview => {
  const requestPayload = getApprovalPayload(args);
  const prepared = args.transaction?.prepared as Partial<Eip155PreparedTransaction> | null;
  const sourceRequest = args.transaction?.request?.namespace === "eip155" ? args.transaction.request : null;
  const sourcePayload: Eip155TransactionPayload = sourceRequest
    ? (sourceRequest.payload as Eip155TransactionPayload)
    : requestPayload;

  return {
    namespace: "eip155",
    summary: {
      from: args.transaction?.from ?? args.request.from ?? "",
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
