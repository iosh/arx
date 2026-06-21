import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { isOnboardingPath } from "./onboardingPaths";
import { ROUTES } from "./routes";
import { isWalletInitialized, isWalletReady, type WalletAvailability } from "./walletAvailability";

type SetupStatusLike = {
  onboarding: { availability: WalletAvailability };
};

export function needsOnboarding(setupStatus: SetupStatusLike): boolean {
  return !isWalletReady(setupStatus.onboarding.availability);
}

export type RootBeforeLoadDecision =
  | { type: "allow" }
  | { type: "close" }
  | { type: "openOnboardingAndClose"; reason: "onboarding_required" }
  | { type: "redirect"; to: string; replace: true };

export function decideRootBeforeLoad(params: {
  entry: UiEntryMetadata;
  pathname: string;
  setupStatus?: SetupStatusLike | null;
}): RootBeforeLoadDecision {
  const { entry, pathname, setupStatus } = params;

  if (isOnboardingPath(pathname)) {
    if (entry.environment === "onboarding") return { type: "allow" };
    if (entry.environment === "popup") return { type: "openOnboardingAndClose", reason: "onboarding_required" };
    return { type: "close" };
  }

  if (entry.environment === "notification" && entry.reason === "idle") {
    return { type: "close" };
  }

  // Fail-safe: onboarding should never land on non-onboarding surfaces under unknown state.
  if (!setupStatus) {
    if (entry.environment === "onboarding") {
      return { type: "redirect", to: ROUTES.ONBOARDING_WELCOME, replace: true };
    }
    return { type: "allow" };
  }

  const onboardingNeeded = needsOnboarding(setupStatus);
  const hasAccounts = isWalletReady(setupStatus.onboarding.availability);
  const hasVault = isWalletInitialized(setupStatus.onboarding.availability);

  if (entry.environment === "onboarding") {
    const target = hasAccounts ? ROUTES.ONBOARDING_COMPLETE : ROUTES.ONBOARDING_WELCOME;

    if (pathname === target) return { type: "allow" };
    return { type: "redirect", to: target, replace: true };
  }

  if (entry.environment === "popup" && onboardingNeeded) {
    return { type: "openOnboardingAndClose", reason: "onboarding_required" };
  }

  if (entry.environment === "notification" && !hasVault) {
    return { type: "close" };
  }

  if (hasVault) return { type: "allow" };

  if (entry.environment === "popup") return { type: "openOnboardingAndClose", reason: "onboarding_required" };
  return { type: "close" };
}
