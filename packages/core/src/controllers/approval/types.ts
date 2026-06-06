import type { ChainRef } from "../../chains/ids.js";
import type { ChainMetadata } from "../../chains/metadata.js";
import type { ChainNamespace } from "../../controllers/account/types.js";
import type { AccountKey } from "../../storage/records.js";
import type { RequestPermissionsApprovalPayload, RequestPermissionsApprovalResult } from "../permission/types.js";
import {
  type ApprovalKind,
  ApprovalKinds,
  type ApprovalType,
  ApprovalTypes,
  type ControllerApprovalKind,
} from "./constants.js";

export { getApprovalKind, getApprovalType } from "./constants.js";
export type { ApprovalKind, ApprovalType, ControllerApprovalKind };
export { ApprovalKinds, ApprovalTypes };

export type ApprovalTerminalReason =
  | "user_approve"
  | "user_reject"
  | "timeout"
  | "locked"
  | "caller_disconnected"
  | "user_dismissed"
  | "superseded"
  | "runtime_shutdown"
  | "internal_error";

export type ApprovalFinalStatus = "approved" | "rejected" | "cancelled" | "expired" | "failed";

export type ApprovalRequester = {
  origin: string;
  initiator: "dapp" | "wallet_ui";
  requestId?: string | undefined;
};

export type ApprovalQueueItem = {
  approvalId: string;
  kind: ControllerApprovalKind;
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  createdAt: number;
};

export type ApprovalRequestByKind = {
  [ApprovalKinds.RequestAccounts]: {
    chainRef: ChainRef;
    suggestedAccounts?: string[] | undefined;
  };
  [ApprovalKinds.RequestPermissions]: RequestPermissionsApprovalPayload;
  [ApprovalKinds.SignMessage]: {
    chainRef: ChainRef;
    from: string;
    message: string;
  };
  [ApprovalKinds.SignTypedData]: {
    chainRef: ChainRef;
    from: string;
    typedData: string;
  };
  [ApprovalKinds.SwitchChain]: { chainRef: ChainRef };
  [ApprovalKinds.AddChain]: { metadata: ChainMetadata; isUpdate: boolean };
};

export type ApprovalAccountSelectionDecision = {
  accountKeys: [AccountKey, ...AccountKey[]];
};

export type ApprovalDecisionByKind = {
  [ApprovalKinds.RequestAccounts]: ApprovalAccountSelectionDecision;
  [ApprovalKinds.RequestPermissions]: ApprovalAccountSelectionDecision;
  [ApprovalKinds.SignMessage]: undefined;
  [ApprovalKinds.SignTypedData]: undefined;
  [ApprovalKinds.SwitchChain]: undefined;
  [ApprovalKinds.AddChain]: undefined;
};

export type ApprovalResultByKind = {
  [ApprovalKinds.RequestAccounts]: string[];
  [ApprovalKinds.RequestPermissions]: RequestPermissionsApprovalResult;
  [ApprovalKinds.SignMessage]: string;
  [ApprovalKinds.SignTypedData]: string;
  [ApprovalKinds.SwitchChain]: null;
  [ApprovalKinds.AddChain]: null;
};

export type ApprovalRequest<K extends ControllerApprovalKind = ControllerApprovalKind> = ApprovalRequestByKind[K];

export type ApprovalDecision<K extends ControllerApprovalKind = ControllerApprovalKind> = ApprovalDecisionByKind[K];

export type ApprovalResult<K extends ControllerApprovalKind = ControllerApprovalKind> = ApprovalResultByKind[K];

export type ApprovalCreateParams<K extends ControllerApprovalKind = ControllerApprovalKind> = {
  approvalId: string;
  kind: K;
  origin: string;
  namespace: ChainNamespace;
  chainRef: ChainRef;
  request: ApprovalRequest<K>;
  createdAt: number;
};

export type ApprovalRecord<K extends ControllerApprovalKind = ControllerApprovalKind> = ApprovalCreateParams<K> & {
  requester: ApprovalRequester;
};

export type ApprovalHandle<K extends ControllerApprovalKind = ControllerApprovalKind> = {
  approvalId: string;
  settled: Promise<ApprovalResult<K>>;
};

export type ApprovalCreatedEvent = {
  record: ApprovalRecord;
};

export type ApprovalFinishedEvent<T = unknown> = {
  approvalId: string;
  status: ApprovalFinalStatus;
  terminalReason: ApprovalTerminalReason;

  kind?: ControllerApprovalKind | undefined;
  origin?: string | undefined;
  namespace?: ChainNamespace | undefined;
  chainRef?: ChainRef | undefined;

  value?: T | undefined;
  error?: { name: string; message: string } | undefined;
};

export type ApprovalState = {
  pending: ApprovalQueueItem[];
};

export type ApprovalResolveInput =
  | {
      approvalId: string;
      action: "approve";
      decision?: unknown;
    }
  | {
      approvalId: string;
      action: "reject";
      reason?: string;
      error?: Error;
    };

export type ApprovalResolveResult<T = unknown> =
  | {
      approvalId: string;
      status: "approved";
      terminalReason: "user_approve";
      value: T;
    }
  | {
      approvalId: string;
      status: "rejected";
      terminalReason: "user_reject";
    };

export type PendingApprovalSettlement =
  | {
      kind: "handle";
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: "internal";
    };

export type PendingApproval<K extends ControllerApprovalKind = ControllerApprovalKind> = {
  record: ApprovalRecord<K>;
  settlement: PendingApprovalSettlement;
};

export type ApprovalController = {
  getState(): ApprovalState;
  get(approvalId: string): ApprovalRecord | undefined;
  create<K extends ControllerApprovalKind>(
    request: ApprovalCreateParams<K>,
    requester: ApprovalRequester,
  ): ApprovalHandle<K>;
  createPending<K extends ControllerApprovalKind>(request: ApprovalCreateParams<K>, requester: ApprovalRequester): void;
  onStateChanged(handler: (state: ApprovalState) => void): () => void;
  onCreated(handler: (event: ApprovalCreatedEvent) => void): () => void;
  onFinished(handler: (event: ApprovalFinishedEvent<unknown>) => void): () => void;

  has(approvalId: string): boolean;

  resolve(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;

  cancel(input: { approvalId: string; reason: ApprovalTerminalReason; error?: Error }): Promise<void>;
};
