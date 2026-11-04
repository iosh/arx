import { createFileRoute } from "@tanstack/react-router";
import { AccountDetailsPage } from "@/ui/pages/accounts/AccountDetailsPage";

export const Route = createFileRoute("/wallet/accounts/$accountGroupId")({
  component: AccountDetailsRoute,
  remountDeps: ({ params }) => params.accountGroupId,
});

function AccountDetailsRoute() {
  const { accountGroupId } = Route.useParams();
  return <AccountDetailsPage accountGroupId={accountGroupId} />;
}
