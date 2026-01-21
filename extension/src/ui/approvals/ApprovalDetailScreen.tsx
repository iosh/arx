import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, ScrollView, XStack, YStack } from "tamagui";
import { Button, Screen } from "@/ui/components";
import { ApprovalPayload } from "./ApprovalPayload";
import { getApprovalTypeLabel } from "./labels";

export type ApprovalDetailScreenProps = {
  approval: ApprovalSummary;
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
  pending: "approve" | "reject" | null;
  errorMessage: string | null;
};

export function ApprovalDetailScreen({
  approval,
  onApprove,
  onReject,
  onBack,
  pending,
  errorMessage,
}: ApprovalDetailScreenProps) {
  const footer = (
    <YStack gap="$2">
      {errorMessage ? (
        <Card padded bordered borderColor="$danger" backgroundColor="$surface">
          <Paragraph color="$danger" fontSize="$2">
            {errorMessage}
          </Paragraph>
        </Card>
      ) : null}

      <XStack gap="$3">
        <Button flex={1} onPress={onReject} disabled={pending !== null} backgroundColor="$danger" color="$dangerText">
          {pending === "reject" ? "Rejecting..." : "Reject"}
        </Button>
        <Button flex={1} onPress={onApprove} disabled={pending !== null} backgroundColor="$accent" color="$accentText">
          {pending === "approve" ? "Approving..." : "Approve"}
        </Button>
      </XStack>
    </YStack>
  );

  return (
    <Screen scroll={false} footer={footer}>
      <Button onPress={onBack} disabled={pending !== null}>
        Back
      </Button>

      <Card padded bordered gap="$2">
        <Paragraph fontSize="$6" fontWeight="600">
          {getApprovalTypeLabel(approval.type)}
        </Paragraph>
        <Paragraph color="$mutedText" fontSize="$2">
          {approval.origin}
        </Paragraph>
        <Paragraph color="$mutedText" fontSize="$2">
          Chain: {approval.chainRef}
        </Paragraph>
      </Card>

      <ScrollView flex={1} minHeight={0}>
        <ApprovalPayload approval={approval} />
      </ScrollView>
    </Screen>
  );
}
