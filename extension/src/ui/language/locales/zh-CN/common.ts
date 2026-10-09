import type { CommonMessages } from "../en/common";

export const common = {
  language: "语言",
  reload: "重新加载",
  showPassword: "显示{{field}}",
  hidePassword: "隐藏{{field}}",
  starting: "正在启动 ARX",
  pageUnavailable: "无法显示此页面",
} as const satisfies CommonMessages;
