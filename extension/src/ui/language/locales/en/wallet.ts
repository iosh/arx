export const wallet = {
  unlockPassword: "Password",
  unlock: "Unlock",
  incorrectPassword: "Incorrect password.",
  defaultWalletName: "Wallet {{number}}",
  accountName: "Account {{number}}",
  loadingAccount: "Loading account",
  accountUnavailable: "Account information unavailable",
  accounts: "Accounts",
  manageAccounts: "Manage accounts",
  backToWallet: "Back to wallet",
  loadingAccounts: "Loading accounts",
  accountsUnavailable: "Account list unavailable",
  accountSourcesUnavailable: "Wallet groups unavailable",
  currentAccount: "Current",
  privateKey: "Private key",
  recoveryPhrase: "Recovery phrase",
  moreMenu: "More options",
  lockWallet: "Lock wallet",
  backupNotice: "Recovery phrase not backed up",
  backupStatusUnavailable: "Backup status unavailable",
} as const;

export type WalletMessages = { [Key in keyof typeof wallet]: string };
