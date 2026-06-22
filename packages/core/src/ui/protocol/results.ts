import type { NativeCurrency } from "../../chains/definition.js";
import type { ChainRef } from "../../chains/ids.js";
import type { SessionLockState } from "../../runtime/session/unlock/types.js";
import type { AccountKey } from "../../storage/records.js";
import type {
  WalletApiAccountsForCurrentChainResult,
  WalletApiAutoLockResult,
  WalletApiCreationResult,
  WalletApiExportMnemonicResult,
  WalletApiExportPrivateKeyResult,
  WalletApiGenerateMnemonicResult,
  WalletApiImportPrivateKeyResult,
  WalletApiKeyringAccount,
  WalletApiNetworksResult,
  WalletApiRequestSendTransactionApprovalResult,
  WalletApiSessionStatusResult,
  WalletApiSetupStatusResult,
} from "../../wallet/types.js";
import type {
  UI_EVENT_APPROVAL_DETAIL_CHANGED,
  UI_EVENT_APPROVALS_CHANGED,
  UI_EVENT_ENTRY_CHANGED,
  UI_EVENT_READY,
  UI_EVENT_SESSION_CHANGED,
  UI_EVENT_TRANSACTIONS_CHANGED,
} from "./events.js";
import type { UiEntryBootstrap, UiEntryLaunchContext } from "./methods/entry.js";
import type { ApprovalDetail, ApprovalListEntry, ApprovalResolveResult } from "./models/approvals.js";
import type { UiTransaction } from "./models/transactions.js";
import type { ChainSnapshot, UiAccountMeta, UiBackupStatus, UiKeyringMeta, UiOwnedAccountSummary } from "./schemas.js";

export type UiNativeBalanceResult = {
  accountKey: AccountKey;
  chainRef: ChainRef;
  amount: string;
  currency: NativeCurrency;
};

export type UiSetAutoLockDurationResult = WalletApiAutoLockResult;

export type UiOnboardingOpenTabResult = {
  activationPath: "focus" | "create" | "debounced";
  tabId?: number | undefined;
};

export type UiGenerateMnemonicResult = WalletApiGenerateMnemonicResult;

export type UiKeyringAccount = WalletApiKeyringAccount;

export type UiWalletCreationResult = WalletApiCreationResult;

export type UiImportPrivateKeyResult = WalletApiImportPrivateKeyResult;

export type UiExportMnemonicResult = WalletApiExportMnemonicResult;

export type UiExportPrivateKeyResult = WalletApiExportPrivateKeyResult;

export type UiRequestSendTransactionApprovalResult = WalletApiRequestSendTransactionApprovalResult;

export type UiMethodResultMap = {
  "ui.session.getStatus": WalletApiSessionStatusResult;
  "ui.entry.getLaunchContext": UiEntryLaunchContext;
  "ui.entry.getBootstrap": UiEntryBootstrap;
  "ui.balances.getNative": UiNativeBalanceResult;
  "ui.session.unlock": SessionLockState;
  "ui.session.lock": SessionLockState;
  "ui.session.resetAutoLockTimer": SessionLockState;
  "ui.session.setAutoLockDuration": UiSetAutoLockDurationResult;
  "ui.onboarding.openTab": UiOnboardingOpenTabResult;
  "ui.onboarding.getStatus": WalletApiSetupStatusResult;
  "ui.onboarding.generateMnemonic": UiGenerateMnemonicResult;
  "ui.onboarding.createWalletFromMnemonic": UiWalletCreationResult;
  "ui.onboarding.importWalletFromMnemonic": UiWalletCreationResult;
  "ui.onboarding.importWalletFromPrivateKey": UiImportPrivateKeyResult;
  "ui.accounts.listCurrentChain": WalletApiAccountsForCurrentChainResult;
  "ui.accounts.switchActive": UiOwnedAccountSummary | null;
  "ui.networks.getSelectedChain": ChainSnapshot;
  "ui.networks.list": WalletApiNetworksResult;
  "ui.networks.switchActive": ChainSnapshot;
  "ui.approvals.listPending": ApprovalListEntry[];
  "ui.approvals.getDetail": ApprovalDetail | null;
  "ui.approvals.resolve": ApprovalResolveResult;
  "ui.keyrings.confirmNewMnemonic": UiWalletCreationResult;
  "ui.keyrings.importMnemonic": UiWalletCreationResult;
  "ui.keyrings.importPrivateKey": UiImportPrivateKeyResult;
  "ui.keyrings.deriveAccount": UiKeyringAccount;
  "ui.keyrings.list": UiKeyringMeta[];
  "ui.keyrings.getAccountsByKeyring": UiAccountMeta[];
  "ui.keyrings.getBackupStatus": UiBackupStatus;
  "ui.keyrings.renameKeyring": null;
  "ui.keyrings.renameAccount": null;
  "ui.keyrings.markBackedUp": null;
  "ui.keyrings.hideHdAccount": null;
  "ui.keyrings.unhideHdAccount": null;
  "ui.keyrings.removePrivateKeyKeyring": null;
  "ui.keyrings.exportMnemonic": UiExportMnemonicResult;
  "ui.keyrings.exportPrivateKey": UiExportPrivateKeyResult;
  "ui.transactions.listHistory": UiTransaction[];
  "ui.transactions.getDetail": UiTransaction | null;
  "ui.transactions.requestSendTransactionApproval": UiRequestSendTransactionApprovalResult;
  "ui.transactions.rerunPrepare": null;
  "ui.transactions.applyDraftEdit": null;
};

export type UiEventPayloadMap = {
  [UI_EVENT_READY]: { ready: true };
  [UI_EVENT_SESSION_CHANGED]: { reason: "changed" };
  [UI_EVENT_ENTRY_CHANGED]: UiEntryLaunchContext;
  [UI_EVENT_APPROVALS_CHANGED]: { reason: "changed" };
  [UI_EVENT_APPROVAL_DETAIL_CHANGED]: { approvalId: string };
  [UI_EVENT_TRANSACTIONS_CHANGED]: { transactionIds: string[] };
};
