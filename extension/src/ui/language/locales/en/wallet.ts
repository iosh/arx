export const wallet = {
  unlockPassword: "Password",
  unlock: "Unlock",
  incorrectPassword: "Incorrect password.",
  accountName: "Account {{number}}",
  loadingAccount: "Loading account",
  accountUnavailable: "Account information unavailable",
  moreMenu: "More options",
  lockWallet: "Lock wallet",
  backupNotice: "Recovery phrase not backed up",
} as const;

export type WalletMessages = { [Key in keyof typeof wallet]: string };
