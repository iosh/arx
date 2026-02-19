import type { ApprovalSummary } from "@arx/core/ui";
import { Card, Paragraph, XStack, YStack } from "tamagui";

type SendTransactionApproval = Extract<ApprovalSummary, { type: "sendTransaction" }>;

export function SendTransactionPayload({ approval }: { approval: SendTransactionApproval }) {
  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Send Transaction</Paragraph>
      <YStack gap="$1">
        <DetailRow label="From" value={approval.payload.from} mono />
        <DetailRow label="To" value={approval.payload.to ?? "Contract Creation"} mono />
        {approval.payload.value && <DetailRow label="Value" value={approval.payload.value} />}
        {approval.payload.gas && <DetailRow label="Gas Limit" value={approval.payload.gas} />}
        {approval.payload.data && (
          <YStack marginTop="$2">
            <Paragraph fontSize="$2" color="$color10">
              Data:
            </Paragraph>
            <Paragraph fontFamily="$mono" fontSize="$1" numberOfLines={3}>
              {approval.payload.data}
            </Paragraph>
          </YStack>
        )}
      </YStack>
      {approval.payload.warnings && approval.payload.warnings.length > 0 && (
        <YStack marginTop="$2" gap="$1">
          {approval.payload.warnings.map((w) => (
            <Paragraph key={`${w.code}:${w.message}`} color="$orange10" fontSize="$2">
              ⚠ {w.message}
            </Paragraph>
          ))}
        </YStack>
      )}
      {approval.payload.issues && approval.payload.issues.length > 0 && (
        <YStack marginTop="$2" gap="$1">
          {approval.payload.issues.map((issue) => (
            <Paragraph key={`${issue.code}:${issue.message}`} color="$red10" fontSize="$2">
              ✕ {issue.message}
            </Paragraph>
          ))}
        </YStack>
      )}
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <XStack justifyContent="space-between" gap="$2">
      <Paragraph color="$color10" fontSize="$2">
        {label}:
      </Paragraph>
      <Paragraph fontSize="$2" fontFamily={mono ? "$mono" : undefined} numberOfLines={1} flex={1} textAlign="right">
        {value}
      </Paragraph>
    </XStack>
  );
}
