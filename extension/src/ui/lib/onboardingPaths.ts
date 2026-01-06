import { ROUTES } from "@/ui/lib/routes";

export const ONBOARDING_PATHS = [ROUTES.WELCOME, "/onboarding"] as const;

export function isOnboardingPath(pathname: string) {
  return ONBOARDING_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
