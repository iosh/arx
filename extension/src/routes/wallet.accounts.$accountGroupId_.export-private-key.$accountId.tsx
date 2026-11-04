import { createFileRoute } from "@tanstack/react-router";
import { ExportPrivateKeyPage } from "@/ui/pages/accounts/ExportPrivateKeyPage";

export const Route = createFileRoute("/wallet/accounts/$accountGroupId_/export-private-key/$accountId")({
  component: ExportPrivateKeyRoute,
  remountDeps: ({ params }) => [params.accountGroupId, params.accountId],
});

function ExportPrivateKeyRoute() {
  const { accountGroupId, accountId } = Route.useParams();
  return <ExportPrivateKeyPage accountGroupId={accountGroupId} accountId={accountId} />;
}
