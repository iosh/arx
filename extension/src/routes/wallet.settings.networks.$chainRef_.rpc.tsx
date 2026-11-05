import { createFileRoute } from "@tanstack/react-router";
import { NetworkRpcPage } from "@/ui/pages/settings/NetworkRpcPage";

export const Route = createFileRoute("/wallet/settings/networks/$chainRef_/rpc")({
  component: NetworkRpcRoute,
  remountDeps: ({ params }) => params.chainRef,
});

function NetworkRpcRoute() {
  const { chainRef } = Route.useParams();
  return <NetworkRpcPage chainRef={chainRef} />;
}
