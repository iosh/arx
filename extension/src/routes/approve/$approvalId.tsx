import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { AccountSelectionApprovalRoutePage, SimpleApprovalRoutePage } from "@/ui/approvals";
import { readApprovalDetailForRoute } from "@/ui/approvals/detailRoute";
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
  const router = useRouter();
  const { approvalId } = Route.useParams();
  const { detail: initialDetail } = Route.useLoaderData();
  const { detail: currentDetail } = useUiApprovalDetail(approvalId);
  const approval = readApprovalDetailForRoute({
    initialDetail,
    currentDetail,
  });

  useEffect(() => {
    if (approval !== null) {
      return;
    }

    void router.navigate({ to: ROUTES.APPROVALS, replace: true });
  }, [approval, router]);

  if (!approval) {
    return null;
  }

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
