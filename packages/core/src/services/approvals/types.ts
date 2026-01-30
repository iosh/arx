import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalType,
  FinalStatusReason,
  RequestContextRecord,
} from "../../db/records.js";

export type ApprovalsChangedHandler = () => void;

export type CreateApprovalParams = {
  /**
   * Optional caller-provided id to keep controller-level ids stable (e.g. tx approval id === tx id).
   * Must be a UUID when provided.
   */
  id?: ApprovalRecord["id"];
  type: ApprovalType;
  origin: string;
  namespace?: string;
  chainRef?: string;
  payload: unknown;
  requestContext: RequestContextRecord;
  expiresAt: number;
  /**
   * Optional caller-provided createdAt for deterministic timestamps in tests.
   */
  createdAt?: number;
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
