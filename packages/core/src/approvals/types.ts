import type { AccountSelectionService } from "../accounts/runtime/types.js";
import type {
  ApprovalDecision,
  ApprovalQueueKind,
  ApprovalRecord,
  ApprovalResult,
  ApprovalTerminalReason,
} from "../approvals/queue/types.js";
import type { ChainDefinitionsService } from "../chains/runtime/chainDefinitions/types.js";
import type { NamespaceRuntimeServices } from "../namespaces/index.js";
import type { PermissionsWriter } from "../permissions/service/types.js";
import type { ChainActivationService } from "../services/runtime/chainActivation/types.js";
import type { ChainRpcDefaultEndpointsService } from "../services/store/chainRpcDefaultEndpoints/types.js";

export type ApprovalFlowDeps = {
  accounts: Pick<AccountSelectionService, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  permissions: Pick<PermissionsWriter, "grantAuthorization">;
  chainActivation: Pick<ChainActivationService, "activateNamespaceChain" | "selectProviderChain">;
  chainDefinitions: Pick<ChainDefinitionsService, "getChain" | "upsertCustomChain">;
  chainRpcDefaultEndpoints: Pick<ChainRpcDefaultEndpointsService, "setDefaultEndpoints">;
  namespaceRuntime: NamespaceRuntimeServices;
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

export type ApprovalExecutor = {
  approve(record: ApprovalRecord, decision: unknown): Promise<ApprovalResult>;
  reject(record: ApprovalRecord, input: ApprovalRejectInput): Promise<void>;
  cancel(record: ApprovalRecord, reason: ApprovalTerminalReason, error: Error): Promise<void>;
};
