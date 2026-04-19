import type { ApprovalDetail } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";

type SignMessageApproval = Extract<ApprovalDetail, { kind: "signMessage" }>;

export function SignMessagePayload({ approval }: { approval: SignMessageApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Sign Message</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        From: {approval.request.from}
      </Paragraph>
      <YStack marginTop="$2" padding="$2" backgroundColor="$backgroundFocus" borderRadius="$2">
        <Paragraph fontFamily="$mono" fontSize="$2">
          {approval.request.message}
        </Paragraph>
      </YStack>
    </Card>
  );
}
