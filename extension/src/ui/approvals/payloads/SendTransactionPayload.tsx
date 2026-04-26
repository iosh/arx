import type { ApprovalDetail } from "@arx/core/ui";
import { Card, Paragraph, XStack, YStack } from "tamagui";

type SendTransactionApproval = Extract<ApprovalDetail, { kind: "sendTransaction" }>;

export function SendTransactionPayload({ approval }: { approval: SendTransactionApproval }) {
  const review = approval.review.namespaceReview;
  const prepare = approval.review.prepare;
  const summary = review?.namespace === "eip155" ? review.summary : null;
  const execution = review?.namespace === "eip155" ? review.execution : null;

  return (
    <Card padded bordered gap="$2">
      <Paragraph fontWeight="600">Send Transaction</Paragraph>
      <YStack gap="$1">
        <DetailRow label="From" value={summary?.from ?? ""} mono />
        <DetailRow label="To" value={summary?.to ?? "Contract Creation"} mono />
        {summary?.value && <DetailRow label="Value" value={summary.value} />}
        {execution?.gas && <DetailRow label="Gas Limit" value={execution.gas} />}
        {summary?.data && (
          <YStack marginTop="$2">
            <Paragraph fontSize="$2" color="$color10">
              Data:
            </Paragraph>
            <Paragraph fontFamily="$mono" fontSize="$1" numberOfLines={3}>
              {summary.data}
            </Paragraph>
          </YStack>
        )}
      </YStack>
      {prepare.state === "preparing" ? (
        <Paragraph color="$color10" fontSize="$2">
          Checking gas and balance...
        </Paragraph>
      ) : null}
      {prepare.state === "failed" ? (
        <Paragraph color="$red10" fontSize="$2">
          {prepare.error.message}
        </Paragraph>
      ) : null}
      {prepare.state === "blocked" ? (
        <Paragraph color="$red10" fontSize="$2">
          {prepare.blocker.message}
        </Paragraph>
      ) : null}
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
