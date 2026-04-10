import type { UiSnapshot } from "@arx/core/ui";
import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "@/routes/__root";
import { getOrFetchUiSnapshot } from "@/ui/lib/getOrFetchUiSnapshot";
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
    throw redirect({ to: ROUTES.ONBOARDING_WELCOME });
  }
};
export const requireOnboardingPasswordAllowed = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }
  if (snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.ONBOARDING_WELCOME });
  }
};

/**
 * Redirects to onboarding if the vault exists but setup is still incomplete.
 * Used on home page to ensure user completes onboarding.
 */
export const redirectToSetupIfNoAccounts = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) return;
  if (!snapshot.vault.initialized) return;
  if (hasAccounts(snapshot)) return;

  throw redirect({ to: ROUTES.ONBOARDING_WELCOME, replace: true });
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

export const requireSetupComplete = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient, { fresh: true });
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized || !hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.ONBOARDING_WELCOME });
  }
};
