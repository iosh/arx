import type { ApprovalSummary } from "@arx/core/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Card, Paragraph, YStack } from "tamagui";
import { getApprovalRoutePath, getApprovalTypeLabel, useApprovalSnooze } from "@/ui/approvals";
import { Button, ListItem, LoadingScreen, Screen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/approvals")({
  beforeLoad: requireVaultInitialized,
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const router = useRouter();
  const { snoozeHeadId } = useApprovalSnooze();
  const { snapshot, isLoading } = useUiSnapshot();

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  return (
    <Screen>
      <Button
        onPress={() => {
          snoozeHeadId(snapshot.approvals[0]?.id ?? null);
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
          {snapshot.approvals.length} pending
        </Paragraph>
      </Card>

      {snapshot.approvals.length === 0 ? (
        <Card padded bordered>
          <Paragraph color="$color10">No pending approvals</Paragraph>
        </Card>
      ) : (
        <YStack gap="$2">
          {snapshot.approvals.map((approval) => (
            <ApprovalListItem
              key={approval.id}
              approval={approval}
              onSelect={() => router.navigate({ to: getApprovalRoutePath(approval) })}
            />
          ))}
        </YStack>
      )}
    </Screen>
  );
}

function ApprovalListItem({ approval, onSelect }: { approval: ApprovalSummary; onSelect: () => void }) {
  const typeLabel = getApprovalTypeLabel(approval.type);

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
