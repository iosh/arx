import type { CommonMessages } from "../en/common";

export const common = {
  language: "语言",
  close: "关闭",
  undo: "撤销",
  notifications: "操作提示",
  evmNetworks: "EVM 网络",
  loadingNetwork: "正在读取网络",
  reload: "重新加载",
  showPassword: "显示{{field}}",
  hidePassword: "隐藏{{field}}",
  starting: "正在启动 ARX",
  pageUnavailable: "无法显示此页面",
} as const satisfies CommonMessages;
