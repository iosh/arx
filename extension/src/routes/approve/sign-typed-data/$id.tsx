import { createFileRoute } from "@tanstack/react-router";
import { SimpleApprovalRoutePage } from "@/ui/approvals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";

export const Route = createFileRoute("/approve/sign-typed-data/$id")({
  beforeLoad: requireVaultInitialized,
  component: ApproveSignTypedDataByIdPage,
});

function ApproveSignTypedDataByIdPage() {
  const { id } = Route.useParams();
  return <SimpleApprovalRoutePage approvalId={id} expectedType="signTypedData" />;
}
