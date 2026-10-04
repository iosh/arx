export const wallet = {
  unlockPassword: "Password",
  unlock: "Unlock",
  incorrectPassword: "Incorrect password.",
  unlockFailed: "Could not unlock the wallet. Please try again.",
  accountName: "Account {{number}}",
  moreMenu: "More options",
  lockWallet: "Lock wallet",
  lockFailed: "Could not lock the wallet. Please try again.",
  backupNotice: "Recovery phrase not backed up",
} as const;

export type WalletMessages = { [Key in keyof typeof wallet]: string };
