import { createFileRoute } from "@tanstack/react-router";
import { AccountSelectionApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/request-accounts/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveRequestAccountsByIdPage,
});

function ApproveRequestAccountsByIdPage() {
  const { id } = Route.useParams();
  return <AccountSelectionApprovalRoutePage approvalId={id} expectedType="requestAccounts" />;
}
