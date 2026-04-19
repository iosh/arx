import { createFileRoute, redirect } from "@tanstack/react-router";
import { AccountSelectionApprovalRoutePage, SimpleApprovalRoutePage } from "@/ui/approvals";
import { useUiApprovalDetail } from "@/ui/hooks/useUiApprovals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";
import { loadUiApprovalDetailIntoCache } from "@/ui/lib/uiApprovalQueries";

export const Route = createFileRoute("/approve/$approvalId")({
  beforeLoad: requireVaultInitialized,
  loader: async ({ context, params }) => {
    const detail = await loadUiApprovalDetailIntoCache(context.queryClient, params.approvalId);
    if (!detail) {
      throw redirect({ to: ROUTES.APPROVALS, replace: true });
    }
    return { detail };
  },
  component: ApproveByIdPage,
});

function ApproveByIdPage() {
  const { approvalId } = Route.useParams();
  const { detail: initialDetail } = Route.useLoaderData();
  const { detail } = useUiApprovalDetail(approvalId);
  const approval = detail ?? initialDetail;

  switch (approval.kind) {
    case "requestAccounts":
    case "requestPermissions":
      return <AccountSelectionApprovalRoutePage approvalId={approvalId} approval={approval} />;
    case "signMessage":
    case "signTypedData":
    case "sendTransaction":
    case "switchChain":
    case "addChain":
      return <SimpleApprovalRoutePage approvalId={approvalId} approval={approval} />;
  }
}
