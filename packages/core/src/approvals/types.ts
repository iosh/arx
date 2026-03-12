import type { AccountController } from "../controllers/account/types.js";
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
  ApprovalResult,
  ApprovalTerminalReason,
} from "../controllers/approval/types.js";
import type { ChainDefinitionsController } from "../controllers/chainDefinitions/types.js";
import type { PermissionController } from "../controllers/permission/types.js";
import type { TransactionController } from "../controllers/transaction/types.js";
import type { ChainActivationService } from "../services/runtime/chainActivation/types.js";
import type { ChainViewsService } from "../services/runtime/chainViews/types.js";
import type { Eip155Signer } from "../transactions/adapters/eip155/signer.js";
import type { ApprovalSummary } from "../ui/protocol/schemas.js";

export type ApprovalFlowDeps = {
  accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  permissions: Pick<PermissionController, "getAuthorization" | "upsertAuthorization">;
  transactions: Pick<TransactionController, "approveTransaction" | "rejectTransaction" | "getMeta">;
  chainActivation: Pick<ChainActivationService, "activateProviderChain">;
  chainDefinitions: Pick<ChainDefinitionsController, "getChain" | "upsertCustomChain">;
  signers: {
    eip155: Pick<Eip155Signer, "signPersonalMessage" | "signTypedData">;
  };
};

export type ApprovalFlowPresenterDeps = {
  chainViews: Pick<ChainViewsService, "getApprovalReviewChainView" | "findAvailableChainView">;
  transactions: Pick<ApprovalFlowDeps["transactions"], "getMeta">;
};

export type ApprovalSummaryBaseOptions = {
  request?: { chainRef?: string | undefined };
};

export type ApprovalRejectInput = {
  reason?: string;
  error: Error;
};

export type ApprovalFlow<K extends ApprovalKind = ApprovalKind> = {
  kind: K;
  parseDecision(input: unknown): ApprovalDecision<K>;
  present(record: ApprovalRecord<K>, deps: ApprovalFlowPresenterDeps): ApprovalSummary;
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
  get<K extends ApprovalKind>(kind: K): ApprovalFlow<K> | undefined;
  present(record: ApprovalRecord, deps: ApprovalFlowPresenterDeps): ApprovalSummary;
};

export type ApprovalExecutor = {
  approve(record: ApprovalRecord, decision: unknown): Promise<ApprovalResult>;
  reject(record: ApprovalRecord, input: ApprovalRejectInput): Promise<void>;
  cancel(record: ApprovalRecord, reason: ApprovalTerminalReason, error: Error): Promise<void>;
};
