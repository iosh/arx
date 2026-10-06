import { createFileRoute, redirect } from "@tanstack/react-router";
import { WalletHomePage } from "@/ui/pages/wallet-home/WalletHomePage";

export const Route = createFileRoute("/wallet")({
  beforeLoad: ({ context }) => {
    if (context.surface !== "popup") throw redirect({ to: "/onboarding", replace: true });
  },
  component: WalletHomePage,
});
