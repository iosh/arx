import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { isOnboardingPath } from "./onboardingPaths";
import { ROUTES } from "./routes";

type SnapshotLike = {
  vault: { initialized: boolean };
  accounts: { totalCount: number };
  session: { isUnlocked: boolean };
};

export function needsOnboarding(snapshot: SnapshotLike): boolean {
  if (!snapshot.vault.initialized) return true;
  return (snapshot.accounts.totalCount ?? 0) === 0;
}

export type RootBeforeLoadDecision =
  | { type: "allow" }
  | { type: "close" }
  | { type: "openOnboardingAndClose"; reason: "onboarding_required" }
  | { type: "redirect"; to: string; replace: true };

export function decideRootBeforeLoad(params: {
  entry: UiEntryMetadata;
  pathname: string;
  snapshot?: SnapshotLike | null;
}): RootBeforeLoadDecision {
  const { entry, pathname, snapshot } = params;

  if (isOnboardingPath(pathname)) {
    if (entry.environment === "onboarding") return { type: "allow" };
    if (entry.environment === "popup") return { type: "openOnboardingAndClose", reason: "onboarding_required" };
    return { type: "close" };
  }

  if (entry.environment === "notification" && entry.reason === "manual_open" && pathname === ROUTES.HOME) {
    return { type: "redirect", to: ROUTES.APPROVALS, replace: true };
  }

  // Fail-safe: onboarding should never land on non-onboarding surfaces under unknown state.
  if (!snapshot) {
    if (entry.environment === "onboarding") {
      return { type: "redirect", to: ROUTES.ONBOARDING_WELCOME, replace: true };
    }
    return { type: "allow" };
  }

  const onboardingNeeded = needsOnboarding(snapshot);
  const hasAccounts = (snapshot.accounts.totalCount ?? 0) > 0;

  if (entry.environment === "onboarding") {
    const target = hasAccounts ? ROUTES.ONBOARDING_COMPLETE : ROUTES.ONBOARDING_WELCOME;

    if (pathname === target) return { type: "allow" };
    return { type: "redirect", to: target, replace: true };
  }

  if (entry.environment === "popup" && onboardingNeeded) {
    return { type: "openOnboardingAndClose", reason: "onboarding_required" };
  }

  if (entry.environment === "notification" && !snapshot.vault.initialized) {
    return { type: "close" };
  }

  if (snapshot.vault.initialized) return { type: "allow" };

  if (entry.environment === "popup") return { type: "openOnboardingAndClose", reason: "onboarding_required" };
  return { type: "close" };
}
