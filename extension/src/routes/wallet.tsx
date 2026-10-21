import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/wallet")({
  beforeLoad: ({ context }) => {
    if (context.surface !== "popup") throw redirect({ to: "/onboarding", replace: true });
  },
  component: Outlet,
});
