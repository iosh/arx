import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletFlow } from "@/ui/pages/create-wallet/CreateWalletFlow";

export const Route = createFileRoute("/onboarding/create")({
  component: CreateWalletFlow,
});
