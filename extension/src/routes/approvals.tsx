import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Card, Paragraph, YStack } from "tamagui";
import { getApprovalRoutePath, getApprovalTypeLabel } from "@/ui/approvals";
import { Button, ListItem, LoadingScreen, Screen } from "@/ui/components";
import { useUiApprovalsList } from "@/ui/hooks/useUiApprovals";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/approvals")({
  beforeLoad: requireVaultInitialized,
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const router = useRouter();
  const { approvals, isLoading } = useUiApprovalsList();

  if (isLoading || !approvals) {
    return <LoadingScreen />;
  }

  return (
    <Screen>
      <Button
        onPress={() => {
          router.navigate({ to: ROUTES.HOME });
        }}
      >
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          Pending Approvals
        </Paragraph>
        <Paragraph color="$color10" fontSize="$2">
          {approvals.length} pending
        </Paragraph>
      </Card>

      {approvals.length === 0 ? (
        <Card padded bordered>
          <Paragraph color="$color10">No pending approvals</Paragraph>
        </Card>
      ) : (
        <YStack gap="$2">
          {approvals.map((approval) => (
            <ApprovalListItem
              key={approval.approvalId}
              approval={approval}
              onSelect={() => router.navigate({ to: getApprovalRoutePath(approval.approvalId) })}
            />
          ))}
        </YStack>
      )}
    </Screen>
  );
}

function ApprovalListItem({
  approval,
  onSelect,
}: {
  approval: import("@arx/core/ui").ApprovalListEntry;
  onSelect: () => void;
}) {
  const typeLabel = getApprovalTypeLabel(approval.kind);

  return (
    <ListItem
      title={typeLabel}
      subtitle={approval.origin}
      onPress={onSelect}
      right={
        <Paragraph color="$mutedText" fontSize="$2" numberOfLines={1}>
          {approval.chainRef}
        </Paragraph>
      }
    />
  );
}
