export const ONBOARDING_PATHS = ["/onboarding"] as const;

export function isOnboardingPath(pathname: string) {
  return ONBOARDING_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
