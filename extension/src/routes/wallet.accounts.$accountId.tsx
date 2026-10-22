import { createFileRoute } from "@tanstack/react-router";
import { AccountDetailsPage } from "@/ui/pages/accounts/AccountDetailsPage";

export const Route = createFileRoute("/wallet/accounts/$accountId")({
  component: AccountDetailsRoute,
  remountDeps: ({ params }) => params.accountId,
});

function AccountDetailsRoute() {
  const { accountId } = Route.useParams();
  return <AccountDetailsPage accountId={accountId} />;
}
