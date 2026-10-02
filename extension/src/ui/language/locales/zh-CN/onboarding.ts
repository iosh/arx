import type { OnboardingMessages } from "../en/onboarding";

export const onboarding = {
  welcomeTitle: "开始使用 ARX",
  createWallet: "创建新钱包",
  createWalletDescription: "生成新的恢复短语",
  passwordTitle: "设置密码",
  passwordDescription: "用于在此浏览器上解锁 ARX，不能用来恢复钱包。",
  password: "密码",
  passwordPlaceholder: "输入密码",
  confirmPassword: "确认密码",
  confirmPasswordPlaceholder: "再次输入密码",
  passwordMinimum: "至少 {{count}} 个字符",
  passwordRemaining_one: "还差 {{count}} 个字符",
  passwordRemaining_other: "还差 {{count}} 个字符",
  passwordMismatch: "两次输入不一致",
  continue: "继续",
  back: "返回",
  progress: "第 {{current}} 步，共 {{total}} 步",
  createFailed: "创建钱包失败。请重试。",
} as const satisfies OnboardingMessages;
