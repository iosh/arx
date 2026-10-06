import { createFileRoute } from "@tanstack/react-router";
import { CreateWalletFlow } from "@/ui/pages/create-wallet/CreateWalletFlow";
import { useSuspenseWalletStatus } from "@/ui/wallet/useWalletStatus";

export const Route = createFileRoute("/onboarding/create")({
  component: CreateWalletRoute,
});

function CreateWalletRoute() {
  const status = useSuspenseWalletStatus();
  const navigate = Route.useNavigate();

  return <CreateWalletFlow walletStatus={status} onExit={() => navigate({ to: "/onboarding", replace: true })} />;
}
