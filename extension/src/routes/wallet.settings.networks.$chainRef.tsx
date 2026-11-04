import { createFileRoute } from "@tanstack/react-router";
import { NetworkDetailsPage } from "@/ui/pages/settings/NetworkDetailsPage";

export const Route = createFileRoute("/wallet/settings/networks/$chainRef")({
  component: NetworkDetailsRoute,
  remountDeps: ({ params }) => params.chainRef,
});

function NetworkDetailsRoute() {
  const { chainRef } = Route.useParams();
  return <NetworkDetailsPage chainRef={chainRef} />;
}
