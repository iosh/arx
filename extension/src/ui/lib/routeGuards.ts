import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "@/routes/__root";
import type { UiSetupStatus } from "@/ui/lib/uiSetupStatusQuery";
import { getOrFetchUiSetupStatus } from "@/ui/lib/uiSetupStatusQuery";
import { ROUTES } from "./routes";
import { isWalletReady } from "./walletAvailability";

/**
 * Route guard responsibilities:
 * - SessionGate (root UI) owns "locked vs unlocked" rendering (shows UnlockScreen when locked).
 * - routeGuards only enforce business routing constraints (vault initialized, setup flow, etc).
 *
 * Naming:
 * - require*  => must satisfy condition, otherwise redirect
 * - redirect* => if condition matches, redirect (non-error control flow)
 */

const hasAccounts = (status?: UiSetupStatus) => isWalletReady(status?.onboarding.availability);

/**
 * Requires vault to be initialized.
 * Does not enforce unlocked state (handled by SessionGate).
 */
export const requireVaultInitialized = async ({ context }: { context: RouterContext }) => {
  const status = await getOrFetchUiSetupStatus(context.queryClient, { fresh: true });
  if (!status) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!hasAccounts(status)) {
    throw redirect({ to: ROUTES.ONBOARDING_WELCOME });
  }
};
export const requireOnboardingPasswordAllowed = async ({ context }: { context: RouterContext }) => {
  const status = await getOrFetchUiSetupStatus(context.queryClient, { fresh: true });
  if (!status) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (hasAccounts(status)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }
};

/**
 * Redirects to onboarding if the vault exists but setup is still incomplete.
 * Used on home page to ensure user completes onboarding.
 */
export const redirectToSetupIfNoAccounts = async ({ context }: { context: RouterContext }) => {
  const status = await getOrFetchUiSetupStatus(context.queryClient, { fresh: true });
  if (!status) return;
  if (hasAccounts(status)) return;

  throw redirect({ to: ROUTES.ONBOARDING_WELCOME, replace: true });
};

export const requireSetupIncomplete = async ({ context }: { context: RouterContext }) => {
  const status = await getOrFetchUiSetupStatus(context.queryClient, { fresh: true });
  if (!status) {
    throw redirect({ to: ROUTES.HOME });
  }

  // The wallet is usable once it has at least one account.
  if (hasAccounts(status)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }

  // Allow:
  // - no vault yet
  // - vault initialized but no accounts
};

export const requireSetupComplete = async ({ context }: { context: RouterContext }) => {
  const status = await getOrFetchUiSetupStatus(context.queryClient, { fresh: true });
  if (!status) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!hasAccounts(status)) {
    throw redirect({ to: ROUTES.ONBOARDING_WELCOME });
  }
};
