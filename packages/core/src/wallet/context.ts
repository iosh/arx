import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type {
  WalletAccounts,
  WalletApprovals,
  WalletNetworks,
  WalletSession,
  WalletSnapshots,
} from "../engine/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../namespaces/index.js";
import type { WalletTransactionAccess } from "../transactions/TransactionsService.js";
import type { WalletApiApprovalDetailResult, WalletApiPendingApprovalsResult } from "./types.js";

export type WalletApiSnapshotChangeSource = (listener: () => void) => () => void;

export type WalletApiContext = {
  snapshots: WalletSnapshots;
  snapshotChangeSources: readonly WalletApiSnapshotChangeSource[];
  session: WalletSession;
  accounts: WalletAccounts;
  networks: WalletNetworks;
  approvals: WalletApprovals;
  approvalDetails: Readonly<{
    listPending(): Promise<WalletApiPendingApprovalsResult> | WalletApiPendingApprovalsResult;
    getDetail(approvalId: string): Promise<WalletApiApprovalDetailResult> | WalletApiApprovalDetailResult;
  }>;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress" | "toCanonicalAddressFromAccountKey">;
  createId: () => string;
  surface: {
    origin: string;
  };
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi">;
  transactions: WalletTransactionAccess;
};
