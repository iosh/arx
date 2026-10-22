import { createFileRoute } from "@tanstack/react-router";
import { WalletDetailsPage } from "@/ui/pages/accounts/WalletDetailsPage";

export const Route = createFileRoute("/wallet/wallets/$keySourceId")({
  component: WalletDetailsRoute,
  remountDeps: ({ params }) => params.keySourceId,
});

function WalletDetailsRoute() {
  const { keySourceId } = Route.useParams();
  return <WalletDetailsPage keySourceId={keySourceId} />;
}
