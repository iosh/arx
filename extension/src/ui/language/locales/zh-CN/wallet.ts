import type { WalletMessages } from "../en/wallet";

export const wallet = {
  unlockPassword: "解锁密码",
  unlock: "解锁",
  incorrectPassword: "解锁密码不正确。",
  accountName: "账户 {{number}}",
  loadingAccount: "正在读取账户",
  accountUnavailable: "账户信息不可用",
  moreMenu: "更多选项",
  lockWallet: "锁定钱包",
  backupNotice: "恢复短语尚未备份",
} as const satisfies WalletMessages;
