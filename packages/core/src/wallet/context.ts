import type { AccountAddressingByNamespace } from "../accounts/addressing/addressing.js";
import type {
  WalletAccounts,
  WalletApprovals,
  WalletNetworks,
  WalletSession,
  WalletSetupServices,
} from "../engine/types.js";
import type { NamespaceRuntimeServices } from "../namespaces/index.js";
import type { WalletTransactionAccess } from "../transactions/TransactionsService.js";
import type {
  WalletApiApprovalDetailResult,
  WalletApiAttentionSnapshotResult,
  WalletApiPendingApprovalsResult,
} from "./types.js";

export type WalletApiContext = {
  session: WalletSession;
  accounts: WalletAccounts;
  networks: WalletNetworks;
  approvals: WalletApprovals;
  attention: Readonly<{
    getSnapshot(): WalletApiAttentionSnapshotResult;
  }>;
  approvalDetails: Readonly<{
    listPending(): Promise<WalletApiPendingApprovalsResult>;
    getDetail(approvalId: string): Promise<WalletApiApprovalDetailResult>;
  }>;
  accountAddressing: AccountAddressingByNamespace;
  createId: () => string;
  caller: {
    origin: string;
  };
  namespaceRuntime: NamespaceRuntimeServices;
  transactions: WalletTransactionAccess;
  setup: WalletSetupServices;
};
