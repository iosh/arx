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
 * check if snapshot has accounts

 */
const hasAccounts = (snapshot?: UiSnapshot) => (snapshot?.accounts.totalCount ?? 0) > 0;

/**
 * Requires vault to be initialized.
 * Does not enforce unlocked state (handled by SessionGate).
 */
export const requireVaultInitialized = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient);
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.WELCOME });
  }
};
export const requireVaultUninitialized = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient);
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
  const snapshot = await getOrFetchUiSnapshot(context.queryClient);
  if (!snapshot) return;
  if (!snapshot.vault.initialized) return;
  if (!snapshot.session.isUnlocked) return;
  if (hasAccounts(snapshot)) return;

  throw redirect({ to: ROUTES.ONBOARDING_GENERATE, replace: true });
};

export const requireSetupIncomplete = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient);
  if (!snapshot) {
    throw redirect({ to: ROUTES.HOME });
  }
  if (!snapshot.vault.initialized) {
    throw redirect({ to: ROUTES.WELCOME });
  }
  if (hasAccounts(snapshot)) {
    throw redirect({ to: ROUTES.ONBOARDING_COMPLETE });
  }
};
export const requireSetupComplete = async ({ context }: { context: RouterContext }) => {
  const snapshot = await getOrFetchUiSnapshot(context.queryClient);
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
