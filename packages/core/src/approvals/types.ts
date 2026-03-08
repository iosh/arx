import type { AccountController } from "../controllers/account/types.js";
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
  ApprovalResult,
  ApprovalTerminalReason,
} from "../controllers/approval/types.js";
import type { ChainDefinitionsController } from "../controllers/chainDefinitions/types.js";
import type { NetworkController } from "../controllers/network/types.js";
import type { PermissionController } from "../controllers/permission/types.js";
import type { TransactionController } from "../controllers/transaction/types.js";
import type { NetworkPreferencesService } from "../services/store/networkPreferences/types.js";
import type { Eip155Signer } from "../transactions/adapters/eip155/signer.js";

export type ApprovalFlowDeps = {
  accounts: Pick<AccountController, "getActiveAccountForNamespace" | "listOwnedForNamespace">;
  permissions: Pick<PermissionController, "grant" | "setPermittedAccounts">;
  transactions: Pick<TransactionController, "approveTransaction" | "rejectTransaction">;
  network: Pick<NetworkController, "getState" | "switchChain">;
  networkPreferences: Pick<NetworkPreferencesService, "setActiveChainRef">;
  chainDefinitions: Pick<ChainDefinitionsController, "getChain" | "upsertChain">;
  signers: {
    eip155: Pick<Eip155Signer, "signPersonalMessage" | "signTypedData">;
  };
};

export type ApprovalRejectInput = {
  reason?: string;
  error: Error;
};

export type ApprovalFlow<K extends ApprovalKind = ApprovalKind> = {
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
  get<K extends ApprovalKind>(kind: K): ApprovalFlow<K> | undefined;
};

export type ApprovalExecutor = {
  approve(record: ApprovalRecord, decision: unknown): Promise<ApprovalResult>;
  reject(record: ApprovalRecord, input: ApprovalRejectInput): Promise<void>;
  cancel(record: ApprovalRecord, reason: ApprovalTerminalReason, error: Error): Promise<void>;
};
