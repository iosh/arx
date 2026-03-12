import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type RequestPermissionsApproval = Extract<ApprovalSummary, { type: "requestPermissions" }>;

const CAPABILITY_LABELS: Record<string, string> = {
  eth_accounts: "View accounts",
};

const getCapabilityLabel = (capability: string) => CAPABILITY_LABELS[capability] ?? capability;

export function RequestPermissionsPayload({ approval }: { approval: RequestPermissionsApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Account Access Request</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        This site wants account access on the following chains.
      </Paragraph>
      <YStack gap="$2" marginTop="$2">
        {approval.payload.requestedAccesses.map((request, index) => (
          <Card key={`${request.capability}-${request.chainRef}-${index}`} padded bordered>
            <Paragraph fontWeight="600">{getCapabilityLabel(request.capability)}</Paragraph>
            <Paragraph color="$color10" fontSize="$2">
              Chain: {request.chainRef}
            </Paragraph>
          </Card>
        ))}
      </YStack>
    </Card>
  );
}
