import { ArxReasons, arxError } from "@arx/errors";
import { ApprovalKinds } from "../../controllers/approval/types.js";
import { createApprovalSummaryBase, toUiIssue, toUiWarning } from "../presentation.js";
import { ApprovalChainDerivationFallbacks, parseNoDecision } from "../shared.js";
import type { ApprovalFlow } from "../types.js";

export const sendTransactionApprovalFlow: ApprovalFlow<typeof ApprovalKinds.SendTransaction> = {
  kind: ApprovalKinds.SendTransaction,
  parseDecision: (input) => parseNoDecision(ApprovalKinds.SendTransaction, input),
  present(record, deps) {
    const payload = record.request;
    const txMeta = deps.transactions.getMeta(record.id);
    const txPayload =
      (txMeta?.request?.payload as Record<string, unknown> | undefined) ?? payload.request?.payload ?? {};
    const prepared =
      txMeta?.prepared && typeof txMeta.prepared === "object" ? (txMeta.prepared as Record<string, unknown>) : null;
    const warningsSource = txMeta?.warnings ?? payload.warnings ?? [];
    const issuesSource = txMeta?.issues ?? payload.issues ?? [];

    return {
      ...createApprovalSummaryBase(record, deps, {
        request: payload,
        fallback: ApprovalChainDerivationFallbacks.None,
      }),
      type: "sendTransaction",
      payload: {
        from: String(txMeta?.from ?? payload.from ?? ""),
        to: typeof txPayload.to === "string" || txPayload.to === null ? (txPayload.to as string | null) : null,
        value: typeof txPayload.value === "string" ? txPayload.value : undefined,
        data: typeof txPayload.data === "string" ? txPayload.data : undefined,
        gas:
          prepared && typeof prepared.gas === "string"
            ? prepared.gas
            : typeof txPayload.gas === "string"
              ? txPayload.gas
              : undefined,
        fee: {
          gasPrice:
            prepared && typeof prepared.gasPrice === "string"
              ? prepared.gasPrice
              : typeof txPayload.gasPrice === "string"
                ? txPayload.gasPrice
                : undefined,
          maxFeePerGas:
            prepared && typeof prepared.maxFeePerGas === "string"
              ? prepared.maxFeePerGas
              : typeof txPayload.maxFeePerGas === "string"
                ? txPayload.maxFeePerGas
                : undefined,
          maxPriorityFeePerGas:
            prepared && typeof prepared.maxPriorityFeePerGas === "string"
              ? prepared.maxPriorityFeePerGas
              : typeof txPayload.maxPriorityFeePerGas === "string"
                ? txPayload.maxPriorityFeePerGas
                : undefined,
        },
        warnings: warningsSource.map(toUiWarning),
        issues: issuesSource.map(toUiIssue),
      },
    };
  },
  async approve(record, _decision, deps) {
    const approved = await deps.transactions.approveTransaction(record.id);
    if (!approved) {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "Transaction not found",
        data: { id: record.id },
      });
    }

    return approved;
  },
  async onReject(record, input, deps) {
    await deps.transactions.rejectTransaction(record.id, input.error);
  },
  async onCancel(record, _reason, error, deps) {
    await deps.transactions.rejectTransaction(record.id, error);
  },
};
