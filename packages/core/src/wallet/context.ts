import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type {
  WalletAccounts,
  WalletApprovals,
  WalletNetworks,
  WalletSession,
  WalletSetupServices,
} from "../engine/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../namespaces/index.js";
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
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  createId: () => string;
  caller: {
    origin: string;
  };
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi">;
  transactions: WalletTransactionAccess;
  setup: WalletSetupServices;
};
