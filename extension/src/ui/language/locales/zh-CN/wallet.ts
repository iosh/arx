import type { WalletMessages } from "../en/wallet";

export const wallet = {
  unlockPassword: "解锁密码",
  unlock: "解锁",
  incorrectPassword: "解锁密码不正确。",
  unlockFailed: "解锁失败。请重试。",
  accountName: "账户 {{number}}",
  moreMenu: "更多选项",
  lockWallet: "锁定钱包",
  lockFailed: "锁定失败。请重试。",
  backupNotice: "恢复短语尚未备份",
} as const satisfies WalletMessages;
