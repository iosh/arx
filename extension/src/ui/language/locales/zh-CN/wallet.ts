import type { WalletMessages } from "../en/wallet";

export const wallet = {
  unlockPassword: "解锁密码",
  unlock: "解锁",
  incorrectPassword: "解锁密码不正确。",
  defaultWalletName: "钱包 {{number}}",
  accountName: "账户 {{number}}",
  loadingAccount: "正在读取账户",
  accountUnavailable: "账户信息不可用",
  accounts: "账户",
  manageAccounts: "管理账户",
  backToWallet: "返回钱包首页",
  loadingAccounts: "正在读取账户列表",
  accountsUnavailable: "账户列表不可用",
  accountSourcesUnavailable: "钱包分组信息不可用",
  currentAccount: "当前",
  privateKey: "私钥",
  recoveryPhrase: "恢复短语",
  moreMenu: "更多选项",
  lockWallet: "锁定钱包",
  backupNotice: "恢复短语尚未备份",
  backupStatusUnavailable: "备份状态不可用",
} as const satisfies WalletMessages;
