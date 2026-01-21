import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type RequestPermissionsApproval = Extract<ApprovalSummary, { type: "requestPermissions" }>;

export function RequestPermissionsPayload({ approval }: { approval: RequestPermissionsApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Permission Request</Paragraph>
      <YStack gap="$2" marginTop="$2">
        {approval.payload.permissions.map((perm, index) => (
          <Card key={`${perm.capability}-${index}`} padded bordered>
            <Paragraph fontWeight="600">{perm.capability}</Paragraph>
            <Paragraph color="$color10" fontSize="$2">
              Scope: {perm.scope}
            </Paragraph>
            <Paragraph color="$color10" fontSize="$2">
              Chains: {perm.chains.join(", ")}
            </Paragraph>
          </Card>
        ))}
      </YStack>
    </Card>
  );
}
