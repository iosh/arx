export { APPROVAL_TIMEOUT_MS, Approvals, type ApprovalsOptions } from "./Approvals.js";
export {
  ApprovalCancelledError,
  ApprovalNotFoundError,
  ApprovalRejectedError,
  ApprovalTimeoutError,
} from "./errors.js";
export type {
  AccountAccessApproval,
  AddNetworkApproval,
  Approval,
  ApprovalBase,
  ApprovalDecision,
  ApprovalDraft,
  ApprovalHandle,
  ApprovalId,
  ApprovalsApi,
  ApprovalsChanged,
  ApprovalsReader,
  Eip155SignApproval,
  SendTransactionApproval,
  SwitchNetworkApproval,
} from "./types.js";
