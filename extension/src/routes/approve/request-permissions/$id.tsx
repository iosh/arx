import { createFileRoute } from "@tanstack/react-router";
import { AccountSelectionApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/request-permissions/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveRequestPermissionsByIdPage,
});

function ApproveRequestPermissionsByIdPage() {
  const { id } = Route.useParams();
  return <AccountSelectionApprovalRoutePage approvalId={id} expectedType="requestPermissions" />;
}
