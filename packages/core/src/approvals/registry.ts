import { ArxReasons, arxError } from "@arx/errors";
import type { ApprovalKind, ApprovalRecord } from "../controllers/approval/types.js";
import { addChainApprovalFlow } from "./flows/addChain.js";
import { requestAccountsApprovalFlow } from "./flows/requestAccounts.js";
import { requestPermissionsApprovalFlow } from "./flows/requestPermissions.js";
import { sendTransactionApprovalFlow } from "./flows/sendTransaction.js";
import { signMessageApprovalFlow } from "./flows/signMessage.js";
import { signTypedDataApprovalFlow } from "./flows/signTypedData.js";
import { switchChainApprovalFlow } from "./flows/switchChain.js";
import type { ApprovalExecutor, ApprovalFlow, ApprovalFlowDeps, ApprovalFlowRegistry } from "./types.js";

const APPROVAL_FLOWS = [
  requestAccountsApprovalFlow,
  requestPermissionsApprovalFlow,
  signMessageApprovalFlow,
  signTypedDataApprovalFlow,
  sendTransactionApprovalFlow,
  switchChainApprovalFlow,
  addChainApprovalFlow,
] as const satisfies readonly ApprovalFlow[];

const getRequiredFlow = <K extends ApprovalKind>(
  registry: ApprovalFlowRegistry,
  record: Pick<ApprovalRecord<K>, "approvalId" | "kind">,
) => {
  const flow = registry.get(record.kind);
  if (!flow) {
    throw arxError({
      reason: ArxReasons.RpcUnsupportedMethod,
      message: `Unsupported approval kind: ${record.kind}`,
      data: { approvalId: record.approvalId, kind: record.kind },
    });
  }

  return flow;
};

export const createApprovalFlowRegistry = (options?: { flows?: readonly ApprovalFlow[] }): ApprovalFlowRegistry => {
  const flows = options?.flows ?? APPROVAL_FLOWS;
  const byKind = new Map<ApprovalKind, ApprovalFlow>(flows.map((flow) => [flow.kind, flow]));

  return {
    get: (kind) => byKind.get(kind) as ApprovalFlow<typeof kind> | undefined,
  };
};

export const createApprovalExecutor = (params: {
  registry: ApprovalFlowRegistry;
  getDeps: () => ApprovalFlowDeps;
}): ApprovalExecutor => {
  return {
    async approve(record, decision) {
      const flow = getRequiredFlow(params.registry, record);
      const parsedDecision = flow.parseDecision(decision);
      return await flow.approve(record as never, parsedDecision as never, params.getDeps());
    },
    async reject(record, input) {
      const flow = getRequiredFlow(params.registry, record);
      if (!flow.onReject) {
        return;
      }
      await flow.onReject(record as never, input, params.getDeps());
    },
    async cancel(record, reason, error) {
      const flow = getRequiredFlow(params.registry, record);
      if (!flow.onCancel) {
        return;
      }
      await flow.onCancel(record as never, reason, error, params.getDeps());
    },
  };
};
