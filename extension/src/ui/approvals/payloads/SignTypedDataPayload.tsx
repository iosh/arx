import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, YStack } from "tamagui";
import { formatTypedData } from "../format";

type SignTypedDataApproval = Extract<ApprovalSummary, { type: "signTypedData" }>;

export function SignTypedDataPayload({ approval }: { approval: SignTypedDataApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Sign Typed Data</Paragraph>
      <Paragraph color="$color10" fontSize="$2">
        From: {approval.payload.from}
      </Paragraph>
      <YStack marginTop="$2" padding="$2" backgroundColor="$backgroundFocus" borderRadius="$2">
        <Paragraph fontFamily="$mono" fontSize="$2">
          {formatTypedData(approval.payload.typedData)}
        </Paragraph>
      </YStack>
    </Card>
  );
}
