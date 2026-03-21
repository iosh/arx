import { createFileRoute } from "@tanstack/react-router";
import { SimpleApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/send-transaction/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveSendTransactionByIdPage,
});

function ApproveSendTransactionByIdPage() {
  const { id } = Route.useParams();
  return <SimpleApprovalRoutePage approvalId={id} expectedType="sendTransaction" />;
}
