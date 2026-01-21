import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type RequestAccountsApproval = Extract<ApprovalSummary, { type: "requestAccounts" }>;

export function RequestAccountsPayload({ approval }: { approval: RequestAccountsApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Connect Account</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        This site wants to view your account address.
      </Paragraph>
      {approval.payload.suggestedAccounts.length > 0 && (
        <YStack gap="$1" marginTop="$2">
          <Paragraph fontSize="$2">Accounts:</Paragraph>
          {approval.payload.suggestedAccounts.map((addr) => (
            <Paragraph key={addr} fontFamily="$mono" fontSize="$2">
              {addr}
            </Paragraph>
          ))}
        </YStack>
      )}
    </Card>
  );
}
