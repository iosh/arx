import type { ApprovalSummary } from "@arx/core/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Paragraph, YStack } from "tamagui";
import { ApprovalDetailScreen, getApprovalTypeLabel, useApprovalSnooze } from "@/ui/approvals";
import { Button, ListItem, LoadingScreen, Screen } from "@/ui/components";
import { useUiSnapshot } from "@/ui/hooks/useUiSnapshot";
import { getErrorMessage } from "@/ui/lib/errorUtils";
import { requireVaultInitialized } from "@/ui/lib/routeGuards";
import { ROUTES } from "@/ui/lib/routes";

export const Route = createFileRoute("/approvals")({
  beforeLoad: requireVaultInitialized,
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const router = useRouter();
  const { snoozeHeadId } = useApprovalSnooze();
  const { snapshot, isLoading, approveApproval, rejectApproval } = useUiSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isLoading || !snapshot) {
    return <LoadingScreen />;
  }

  const selected = snapshot.approvals.find((a) => a.id === selectedId);

  const handleApprove = async (id: string) => {
    setPending("approve");
    setErrorMessage(null);
    try {
      await approveApproval(id);
      setSelectedId(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const handleReject = async (id: string) => {
    setPending("reject");
    setErrorMessage(null);
    try {
      await rejectApproval({ id, reason: "User rejected" });
      setSelectedId(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  if (selected) {
    return (
      <ApprovalDetailScreen
        approval={selected}
        onApprove={() => void handleApprove(selected.id)}
        onReject={() => void handleReject(selected.id)}
        onBack={() => setSelectedId(null)}
        pending={pending}
        errorMessage={errorMessage}
      />
    );
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
            <ApprovalListItem key={approval.id} approval={approval} onSelect={() => setSelectedId(approval.id)} />
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
