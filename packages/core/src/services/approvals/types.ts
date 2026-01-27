import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalType,
  FinalStatusReason,
  RequestContextRecord,
} from "../../db/records.js";

export type ApprovalsChangedHandler = () => void;

export type CreateApprovalParams = {
  type: ApprovalType;
  origin: string;
  namespace?: string;
  chainRef?: string;
  payload: unknown;
  requestContext: RequestContextRecord;
  expiresAt: number;
};

export type FinalizeApprovalParams = {
  id: ApprovalRecord["id"];
  status: Exclude<ApprovalStatus, "pending">;
  result?: unknown;
  finalStatusReason: FinalStatusReason;
};

export type ApprovalsService = {
  on(event: "changed", handler: ApprovalsChangedHandler): void;
  off(event: "changed", handler: ApprovalsChangedHandler): void;

  get(id: ApprovalRecord["id"]): Promise<ApprovalRecord | null>;
  listPending(): Promise<ApprovalRecord[]>;

  create(params: CreateApprovalParams): Promise<ApprovalRecord>;
  finalize(params: FinalizeApprovalParams): Promise<ApprovalRecord | null>;

  /**
   * Used on lifecycle initialize() to clean up unrecoverable pending approvals.
   */
  expireAllPending(params: { finalStatusReason: FinalStatusReason }): Promise<number>;
};
