import type { AccountId } from "../accounts/accountId.js";
import type { AccountAddress } from "../accounts/types.js";
import type { Eip155SignRequest } from "../namespaces/eip155/signingRequest.js";
import type { Namespace } from "../namespaces/types.js";
import type { CustomNetworkInput, Network } from "../networks/types.js";
import type { PreparedTransaction } from "../transactions/preparedTransaction.js";

export type ApprovalId = string;

export type ApprovalBase<TType extends string, TNamespace extends Namespace, TRequest> = Readonly<{
  approvalId: ApprovalId;
  type: TType;
  namespace: TNamespace;
  origin: string;
  createdAt: number;
  request: TRequest;
}>;

export type AccountAccessApproval = ApprovalBase<
  "accountAccess",
  Namespace,
  Readonly<{
    selectableAccounts: readonly [AccountAddress, ...AccountAddress[]];
  }>
>;

export type Eip155SignApproval = ApprovalBase<"sign", "eip155", Eip155SignRequest>;

export type SendTransactionApproval = ApprovalBase<
  "sendTransaction",
  PreparedTransaction["namespace"],
  PreparedTransaction
>;

export type SwitchNetworkApproval = ApprovalBase<
  "switchNetwork",
  Namespace,
  Readonly<{
    currentNetwork: Network;
    targetNetwork: Network;
  }>
>;

export type AddNetworkApproval = ApprovalBase<"addNetwork", Namespace, CustomNetworkInput>;

export type Approval =
  | AccountAccessApproval
  | Eip155SignApproval
  | SendTransactionApproval
  | SwitchNetworkApproval
  | AddNetworkApproval;

export type ApprovalDraft<TApproval extends Approval = Approval> = TApproval extends Approval
  ? Omit<TApproval, "approvalId" | "createdAt">
  : never;

export type ApprovalDecision =
  | Readonly<{
      approvalId: ApprovalId;
      type: "accountAccess";
      accountIds: readonly [AccountId, ...AccountId[]];
    }>
  | Readonly<{ approvalId: ApprovalId; type: "sign" }>
  | Readonly<{ approvalId: ApprovalId; type: "sendTransaction" }>
  | Readonly<{ approvalId: ApprovalId; type: "switchNetwork" }>
  | Readonly<{ approvalId: ApprovalId; type: "addNetwork" }>;

export type ApprovalHandle<TDecision extends ApprovalDecision = ApprovalDecision> = Readonly<{
  approvalId: ApprovalId;
  decision: Promise<TDecision>;
  cancel(): void;
}>;

export type ApprovalsReader = Readonly<{
  get(approvalId: ApprovalId): Approval;
  list(): readonly Approval[];
}>;

export type ApprovalsApi = ApprovalsReader &
  Readonly<{
    approve(decision: ApprovalDecision): void;
    reject(approvalId: ApprovalId): void;
  }>;

export type ApprovalsChanged = Readonly<{
  type: "approvalsChanged";
  approvalIds: readonly ApprovalId[];
}>;
