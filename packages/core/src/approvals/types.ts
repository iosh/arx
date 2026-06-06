import type { AccountSelectionService } from "../accounts/runtime/types.js";
import type {
  ApprovalDecision,
  ApprovalQueueKind,
  ApprovalRecord,
  ApprovalResult,
  ApprovalTerminalReason,
} from "../approvals/queue/types.js";
import type { SupportedChainsService } from "../chains/runtime/supportedChains/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../namespaces/index.js";
import type { PermissionsWriter } from "../permissions/service/types.js";
import type { ChainActivationService } from "../services/runtime/chainActivation/types.js";

export type ApprovalFlowDeps = {
  accounts: Pick<AccountSelectionService, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  permissions: Pick<PermissionsWriter, "grantAuthorization">;
  chainActivation: Pick<ChainActivationService, "activateNamespaceChain">;
  supportedChains: Pick<SupportedChainsService, "getChain" | "addChain">;
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getApproval">;
};

export type ApprovalRejectInput = {
  reason?: string;
  error: Error;
};

export type ApprovalFlow<K extends ApprovalQueueKind = ApprovalQueueKind> = {
  kind: K;
  parseDecision(input: unknown): ApprovalDecision<K>;
  approve(record: ApprovalRecord<K>, decision: ApprovalDecision<K>, deps: ApprovalFlowDeps): Promise<ApprovalResult<K>>;
  onReject?(record: ApprovalRecord<K>, input: ApprovalRejectInput, deps: ApprovalFlowDeps): Promise<void>;
  onCancel?(
    record: ApprovalRecord<K>,
    reason: ApprovalTerminalReason,
    error: Error,
    deps: ApprovalFlowDeps,
  ): Promise<void>;
};

export type ApprovalFlowRegistry = {
  get<K extends ApprovalQueueKind>(kind: K): ApprovalFlow<K> | undefined;
};

export type ApprovalExecutor = {
  approve(record: ApprovalRecord, decision: unknown): Promise<ApprovalResult>;
  reject(record: ApprovalRecord, input: ApprovalRejectInput): Promise<void>;
  cancel(record: ApprovalRecord, reason: ApprovalTerminalReason, error: Error): Promise<void>;
};
