import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type RequestPermissionsApproval = Extract<ApprovalSummary, { type: "requestPermissions" }>;

const GRANT_KIND_LABELS: Record<string, string> = {
  eth_accounts: "View accounts",
};

const getGrantKindLabel = (grantKind: string) => GRANT_KIND_LABELS[grantKind] ?? grantKind;

export function RequestPermissionsPayload({ approval }: { approval: RequestPermissionsApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Account Access Request</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        This site wants connection access on the following chains. Choose the account to expose for this connection.
      </Paragraph>
      <YStack gap="$2" marginTop="$2">
        {approval.payload.requestedGrants.map((request, index) => (
          <Card key={`${request.grantKind}-${request.chainRef}-${index}`} padded bordered>
            <Paragraph fontWeight="600">{getGrantKindLabel(request.grantKind)}</Paragraph>
            <Paragraph color="$color10" fontSize="$2">
              Chain: {request.chainRef}
            </Paragraph>
          </Card>
        ))}
      </YStack>
    </Card>
  );
}
