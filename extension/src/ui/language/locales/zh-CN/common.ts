import type { CommonMessages } from "../en/common";

export const common = {
  language: "语言",
  retry: "重试",
  starting: "正在启动 ARX",
  startupFailed: "ARX 未能启动",
  startupFailedDescription: "如多次重试仍无法启动，请重启浏览器。",
} as const satisfies CommonMessages;
