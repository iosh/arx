import { createFileRoute } from "@tanstack/react-router";
import { SimpleApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/sign-message/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveSignMessageByIdPage,
});

function ApproveSignMessageByIdPage() {
  const { id } = Route.useParams();
  return <SimpleApprovalRoutePage approvalId={id} expectedType="signMessage" />;
}
