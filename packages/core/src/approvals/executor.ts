import type { ApprovalQueueKind, ApprovalRecord } from "../approvals/queue/types.js";
import { RpcUnsupportedMethodError } from "../rpc/errors.js";
import { addChainApprovalFlow } from "./flows/addChain.js";
import { requestAccountsApprovalFlow } from "./flows/requestAccounts.js";
import { requestPermissionsApprovalFlow } from "./flows/requestPermissions.js";
import { signMessageApprovalFlow } from "./flows/signMessage.js";
import { signTypedDataApprovalFlow } from "./flows/signTypedData.js";
import { switchChainApprovalFlow } from "./flows/switchChain.js";
import type { ApprovalExecutor, ApprovalFlow, ApprovalFlowDeps } from "./types.js";

const APPROVAL_FLOWS = [
  requestAccountsApprovalFlow,
  requestPermissionsApprovalFlow,
  signMessageApprovalFlow,
  signTypedDataApprovalFlow,
  switchChainApprovalFlow,
  addChainApprovalFlow,
] as const satisfies readonly ApprovalFlow[];

const approvalFlowForRecord = <K extends ApprovalQueueKind>(
  flowsByKind: ReadonlyMap<ApprovalQueueKind, ApprovalFlow>,
  record: Pick<ApprovalRecord<K>, "approvalId" | "kind">,
) => {
  const flow = flowsByKind.get(record.kind);
  if (!flow) {
    throw new RpcUnsupportedMethodError({
      message: `Unsupported approval kind: ${record.kind}`,
    });
  }

  return flow;
};

export const createApprovalExecutor = (params: {
  flows?: readonly ApprovalFlow[];
  getDeps: () => ApprovalFlowDeps;
}): ApprovalExecutor => {
  const flows = params.flows ?? APPROVAL_FLOWS;
  const flowsByKind = new Map<ApprovalQueueKind, ApprovalFlow>(flows.map((flow) => [flow.kind, flow]));

  return {
    async approve(record, decision) {
      const flow = approvalFlowForRecord(flowsByKind, record);
      const parsedDecision = flow.parseDecision(decision);
      return await flow.approve(record as never, parsedDecision as never, params.getDeps());
    },
    async reject(record, input) {
      const flow = approvalFlowForRecord(flowsByKind, record);
      if (!flow.onReject) {
        return;
      }
      await flow.onReject(record as never, input, params.getDeps());
    },
    async cancel(record, reason, error) {
      const flow = approvalFlowForRecord(flowsByKind, record);
      if (!flow.onCancel) {
        return;
      }
      await flow.onCancel(record as never, reason, error, params.getDeps());
    },
  };
};
