import type { UiSnapshot } from "@arx/core/ui";
import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "@/routes/__root";
import { getOrFetchUiSnapshot } from "@/ui/lib/getOrFetchUiSnapshot";
import { useOnboardingStore } from "@/ui/stores/onboardingStore";
import { ROUTES } from "./routes";

/**
 * Route guard responsibilities:
 * - SessionGate (root UI) owns "locked vs unlocked" rendering (shows UnlockScreen when locked).
 * - routeGuards only enforce business routing constraints (vault initialized, setup flow, etc).
 *
 * Naming:
 * - require*  => must satisfy condition, otherwise redirect
 * - redirect* => if condition matches, redirect (non-error control flow)
 */

/**
 * Check if snapshot has accounts.
 */
const hasAccounts = (snapshot?: UiSnapshot) => (snapshot?.accounts.totalCount ?? 0) > 0;

/**
 * Requires vault to be initialized.
 * Does not enforce unlocked state (handled by SessionGate).
 */
export const requireVaultInitialized = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.WELCOME });
  }
};
export const requireVaultUninitialized = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized) {
    return;
  }
  if (hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }
  throw redirect({ to: ROUTES.HOME });
};

/**
 * Redirects to setup if vault is initialized, unlocked, but has no accounts.
 * Used on home page to ensure user completes onboarding.
 */
export const redirectToSetupIfNoAccounts = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) return;
  if (!snapshot.vault.initialized) return;
  if (!snapshot.session.isUnlocked) return;
  if (hasAccounts(snapshot)) return;

  throw redirect({ to: ROUTES.ONBOARDING_GENERATE, replace: true });
};

export const requireSetupIncomplete = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }

  // Setup is considered "complete" once we have at least one account.
  if (hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }

  // Allow:
  // - vault not initialized yet (atomic onboarding)
  // - vault initialized but no accounts (legacy/edge state)
};

export const requireSetupIncompleteOrMnemonicReview = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }

  // Allow entering the phrase screen during the same in-memory onboarding session,
  // even if the account has already been created (atomic onboarding).
  if (hasAccounts(snapshot)) {
    // NOTE: This guard intentionally peeks into an in-memory UI store to support "Back to Phrase"
    // during onboarding. This is extension-only code (no SSR), and the store is not persisted.
    const words = useOnboardingStore.getState().mnemonicWords;
    if (!words || words.length === 0) {
      throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
    }
  }

  // Allow:
  // - vault not initialized yet
  // - vault initialized but no accounts
  // - vault initialized and accounts exist, as long as mnemonic is still in memory for review
};

export const requireSetupComplete = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.WELCOME });
  }
  if (!hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.HOME });
  }
};
