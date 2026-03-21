import { createFileRoute } from "@tanstack/react-router";
import { SimpleApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/add-chain/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveAddChainByIdPage,
});

function ApproveAddChainByIdPage() {
  const { id } = Route.useParams();
  return <SimpleApprovalRoutePage approvalId={id} expectedType="addChain" />;
}
