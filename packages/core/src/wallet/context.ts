import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { WalletAccounts, WalletApprovals, WalletNetworks, WalletSession } from "../engine/types.js";
import type { NamespaceRuntimeBindingsRegistry } from "../namespaces/index.js";
import type { WalletTransactionAccess } from "../transactions/TransactionsService.js";

export type WalletApiContext = {
  session: WalletSession;
  accounts: WalletAccounts;
  networks: WalletNetworks;
  approvals: WalletApprovals;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  createId: () => string;
  surface: {
    origin: string;
  };
  namespaceBindings: Pick<NamespaceRuntimeBindingsRegistry, "getUi">;
  transactions: WalletTransactionAccess;
};
