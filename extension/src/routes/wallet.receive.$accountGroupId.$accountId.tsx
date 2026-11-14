import { createFileRoute } from "@tanstack/react-router";
import { ReceivePage } from "@/ui/pages/receive/ReceivePage";

export const Route = createFileRoute("/wallet/receive/$accountGroupId/$accountId")({
  component: ReceiveRoute,
  remountDeps: ({ params }) => [params.accountGroupId, params.accountId],
});

function ReceiveRoute() {
  const { accountGroupId, accountId } = Route.useParams();
  return <ReceivePage accountGroupId={accountGroupId} accountId={accountId} from="home" />;
}
