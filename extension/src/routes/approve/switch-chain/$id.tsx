import { createFileRoute } from "@tanstack/react-router";
import { SimpleApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/switch-chain/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveSwitchChainByIdPage,
});

function ApproveSwitchChainByIdPage() {
  const { id } = Route.useParams();
  return <SimpleApprovalRoutePage approvalId={id} expectedType="switchChain" />;
}
