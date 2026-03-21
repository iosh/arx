import { createFileRoute } from "@tanstack/react-router";
import { RejectOnlyApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/unsupported/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveUnsupportedByIdPage,
});

function ApproveUnsupportedByIdPage() {
  const { id } = Route.useParams();
  return <RejectOnlyApprovalRoutePage approvalId={id} expectedType="unsupported" rejectReason="Unsupported request" />;
}
