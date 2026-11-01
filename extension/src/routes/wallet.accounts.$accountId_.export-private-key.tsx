import { createFileRoute } from "@tanstack/react-router";
import { ExportPrivateKeyPage } from "@/ui/pages/accounts/ExportPrivateKeyPage";

export const Route = createFileRoute("/wallet/accounts/$accountId_/export-private-key")({
  component: ExportPrivateKeyRoute,
  remountDeps: ({ params }) => params.accountId,
});

function ExportPrivateKeyRoute() {
  const { accountId } = Route.useParams();
  return <ExportPrivateKeyPage accountId={accountId} />;
}
