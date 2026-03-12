import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph } from "tamagui";

type RequestAccountsApproval = Extract<ApprovalSummary, { type: "requestAccounts" }>;

export function RequestAccountsPayload({ approval }: { approval: RequestAccountsApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Connect Account</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        This site wants to view your account address on {approval.chainRef}. Choose an account to continue.
      </Paragraph>
    </Card>
  );
}
