import type { ChainView } from "../services/runtime/chainViews/types.js";
import type { AccountKey } from "../storage/records.js";

export type WalletApiAutoLockResult = {
  autoLockDurationMs: number;
  nextAutoLockAt: number | null;
};

export type WalletApiGenerateMnemonicResult = {
  words: string[];
};

export type WalletApiKeyringAccount = {
  address: string;
  derivationPath: string | null;
  derivationIndex: number | null;
  source: "derived" | "imported";
};

export type WalletApiCreationResult = {
  keyringId: string;
  address: string;
};

export type WalletApiImportPrivateKeyResult = {
  keyringId: string;
  account: WalletApiKeyringAccount;
};

export type WalletApiExportMnemonicResult = {
  words: string[];
};

export type WalletApiExportPrivateKeyResult = {
  privateKey: string;
};

export type WalletApiRequestSendTransactionApprovalResult = {
  approvalId: string;
};

export type WalletApiOwnedAccountSummary = {
  accountKey: AccountKey;
  canonicalAddress: string;
  displayAddress: string;
};

export type WalletApiChainSnapshot = ChainView;
export type WalletApiResolveApprovalResult = null;
