import type { EntryIntent } from "./entryIntent";
import { isOnboardingPath } from "./onboardingPaths";
import { ROUTES } from "./routes";

type SnapshotLike = {
  vault: { initialized: boolean };
  accounts: { totalCount: number };
};

export function needsOnboarding(snapshot: SnapshotLike): boolean {
  return !snapshot.vault.initialized || (snapshot.accounts.totalCount ?? 0) === 0;
}

export type RootBeforeLoadDecision =
  | { type: "allow" }
  | { type: "close" }
  | { type: "openOnboardingAndClose"; reason: "manual_open" }
  | { type: "redirect"; to: string; replace: true };

export function decideRootBeforeLoad(params: {
  entryIntent: EntryIntent;
  pathname: string;
  snapshot?: SnapshotLike | null;
}): RootBeforeLoadDecision {
  const { entryIntent, pathname, snapshot } = params;

  if (isOnboardingPath(pathname)) {
    if (entryIntent === "onboarding_tab") return { type: "allow" };
    if (entryIntent === "manual_open") return { type: "openOnboardingAndClose", reason: "manual_open" };
    return { type: "close" };
  }

  // Fail-safe: onboarding_tab should never land on non-onboarding surfaces under unknown state.
  if (!snapshot) {
    if (entryIntent === "onboarding_tab") {
      return { type: "redirect", to: ROUTES.WELCOME, replace: true };
    }
    return { type: "allow" };
  }

  const onboardingNeeded = needsOnboarding(snapshot);
  const hasAccounts = (snapshot.accounts.totalCount ?? 0) > 0;

  if (entryIntent === "onboarding_tab") {
    const target = !snapshot.vault.initialized
      ? ROUTES.WELCOME
      : hasAccounts
        ? ROUTES.SETUP_COMPLETE
        : ROUTES.SETUP_GENERATE;

    return { type: "redirect", to: target, replace: true };
  }

  if (entryIntent === "manual_open" && onboardingNeeded) {
    return { type: "openOnboardingAndClose", reason: "manual_open" };
  }

  if (entryIntent === "attention_open" && !snapshot.vault.initialized) {
    return { type: "close" };
  }

  if (snapshot.vault.initialized) return { type: "allow" };

  if (entryIntent === "manual_open") return { type: "openOnboardingAndClose", reason: "manual_open" };
  return { type: "close" };
}
