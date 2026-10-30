import { createFileRoute } from "@tanstack/react-router";
import { HiddenAccountsPage } from "@/ui/pages/accounts/HiddenAccountsPage";

export const Route = createFileRoute("/wallet/wallets/$keySourceId_/hidden-accounts")({
  component: HiddenAccountsRoute,
  remountDeps: ({ params }) => params.keySourceId,
});

function HiddenAccountsRoute() {
  const { keySourceId } = Route.useParams();
  return <HiddenAccountsPage keySourceId={keySourceId} />;
}
