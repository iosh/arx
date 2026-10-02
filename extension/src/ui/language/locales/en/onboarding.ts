export const onboarding = {
  welcomeTitle: "Get started with ARX",
  createWallet: "Create a new wallet",
  createWalletDescription: "Generate a new recovery phrase",
  passwordTitle: "Create a password",
  passwordDescription: "Unlock ARX in this browser. This password cannot recover your wallet.",
  password: "Password",
  passwordPlaceholder: "Enter a password",
  confirmPassword: "Confirm password",
  confirmPasswordPlaceholder: "Enter the password again",
  passwordMinimum: "At least {{count}} characters",
  passwordRemaining_one: "{{count}} more character needed",
  passwordRemaining_other: "{{count}} more characters needed",
  passwordMismatch: "Passwords do not match",
  continue: "Continue",
  back: "Back",
  progress: "Step {{current}} of {{total}}",
  createFailed: "Could not create the wallet. Please try again.",
} as const;

export type OnboardingMessages = { [Key in keyof typeof onboarding]: string };
