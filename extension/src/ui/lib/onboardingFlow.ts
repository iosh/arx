import { ROUTES } from "./routes";
import { isWalletReady, type WalletAvailability } from "./walletAvailability";

type OnboardingSetupStatusLike = {
  onboarding: { availability: WalletAvailability };
};

type OnboardingIntent = "create" | "import";

/**
 * Chooses the next onboarding route from Welcome.
 * The only branch here is whether the compatibility boundary can skip password setup.
 */
export function buildWelcomeIntentNavigation(params: {
  setupStatus?: OnboardingSetupStatusLike | null;
  intent: OnboardingIntent;
}): { to: string; search?: { intent: OnboardingIntent } } {
  const shouldSkipPassword = params.setupStatus?.onboarding.availability === "empty";

  if (params.intent === "create") {
    return shouldSkipPassword
      ? { to: ROUTES.ONBOARDING_CREATE }
      : { to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "create" } };
  }

  return shouldSkipPassword
    ? { to: ROUTES.ONBOARDING_IMPORT }
    : { to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "import" } };
}

/**
 * Returns a deterministic redirect for direct entry into Create when required state is missing.
 * A null result means the page can keep rendering its normal flow.
 */
export function buildCreateEntryRedirect(params: {
  setupStatus?: OnboardingSetupStatusLike | null;
  password: string | null;
  mnemonicWords: string[] | null;
  mnemonicKeyringId: string | null;
}): { to: string; replace: true; search?: { intent: "create" } } | null {
  if (!params.setupStatus) {
    return null;
  }

  const hasPendingBackupHandoff = !!params.mnemonicKeyringId && (params.mnemonicWords?.length ?? 0) > 0;
  if (hasPendingBackupHandoff) {
    return null;
  }

  if (isWalletReady(params.setupStatus.onboarding.availability) && !params.mnemonicWords?.length) {
    return { to: ROUTES.ONBOARDING_COMPLETE, replace: true };
  }

  if (params.setupStatus.onboarding.availability === "uninitialized" && !params.password) {
    return { to: ROUTES.ONBOARDING_PASSWORD, search: { intent: "create" }, replace: true };
  }

  return null;
}

/**
 * Returns a deterministic redirect for Backup based on wallet creation state
 * and whether the generated mnemonic still exists in the onboarding store.
 */
export function buildBackupEntryRedirect(params: {
  setupStatus?: OnboardingSetupStatusLike | null;
  mnemonicWords: string[] | null;
  mnemonicKeyringId: string | null;
}): { to: string; replace: true } | null {
  if (!params.setupStatus) {
    return null;
  }

  const hasPendingBackupHandoff = !!params.mnemonicKeyringId && (params.mnemonicWords?.length ?? 0) > 0;
  if (hasPendingBackupHandoff) {
    return null;
  }

  if (!isWalletReady(params.setupStatus.onboarding.availability)) {
    return { to: ROUTES.ONBOARDING_CREATE, replace: true };
  }

  if (!params.mnemonicWords || params.mnemonicWords.length === 0) {
    return { to: ROUTES.ONBOARDING_COMPLETE, replace: true };
  }

  return null;
}
