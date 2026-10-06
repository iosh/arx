import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: ({ context }) => {
    if (context.surface !== "onboarding") throw redirect({ to: "/wallet", replace: true });
  },
});
